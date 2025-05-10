// src/vscode/debugSessionManager.ts
import * as vscode from 'vscode';
import { DebugStateProvider } from './debugStateProvider';
import { 
    ContinueDebuggingParams, 
    StartDebuggingResponsePayload, 
    StopEventData, 
    StepExecutionParams, 
    StepExecutionResult 
} from '../types';
import { 
    IPC_STATUS_SUCCESS, 
    IPC_STATUS_ERROR, 
    IPC_STATUS_STOPPED, 
    IPC_STATUS_COMPLETED, 
    IPC_STATUS_TIMEOUT, 
    IPC_STATUS_INTERRUPTED 
} from '../constants';

interface PendingRequest {
    configurationName: string;
    resolve: (value: StartDebuggingResponsePayload) => void;
    // reject: (reason?: any) => void; // Not used for start/continue as per current structure, handled by resolve with error status
    timeoutHandle: NodeJS.Timeout; // Renamed from timeoutTimer to match task plan
    listeners: vscode.Disposable[];
    trackerDisposable?: vscode.Disposable;
    currentMonitoringSessionId?: string; // Core field for session tracking
    isResolved: boolean;
    isExtensionHostCase?: boolean; // Renamed from isExtensionHostDebug
    initialSessionId?: string;
    requestId: string;
    // configName is configurationName
}

interface PendingStepRequest {
    resolve: (result: StepExecutionResult) => void;
    reject: (reason?: any) => void;
    timeoutHandle: NodeJS.Timeout; // Renamed from timer
    threadId: number;
    stepType: 'over' | 'into' | 'out';
    currentMonitoringSessionId: string; // Renamed from sessionId for consistency
    isResolved: boolean;
    requestId: string;
}

export class DebugSessionManager {
    private pendingStartRequests = new Map<string, PendingRequest>(); // Key is requestId
    private pendingContinueRequests = new Map<string, PendingRequest>(); // Key is requestId, uses PendingRequest for now
    private pendingStepRequests = new Map<string, PendingStepRequest>();
    private sessionListeners = new Map<string, vscode.Disposable[]>();
    private activeSessions = new Map<string, vscode.DebugSession>(); 
    private requestCounter = 0;

    constructor(private debugStateProvider: DebugStateProvider) {
        this.initializeDebugListeners();
        console.log("[DebugSessionManager] Initialized.");
    }

    private initializeDebugListeners(): void {
        vscode.debug.onDidStartDebugSession(session => this.handleDebugSessionStarted(session));
        vscode.debug.onDidTerminateDebugSession(session => this.handleDebugSessionTerminatedInternal(session));

        vscode.debug.registerDebugAdapterTrackerFactory('*', {
            createDebugAdapterTracker: (session: vscode.DebugSession) => {
                console.log(`[DSM] Creating DebugAdapterTracker for session: id=${session.id}, type=${session.type}, name=${session.name}, parentId=${session.parentSession?.id}`);
                // mainRequestId will be determined within each event handler based on currentMonitoringSessionId matching
                
                return {
                    onDidSendMessage: async (message: any) => {
                        if (message.type === 'event' && message.event === 'stopped') {
                            const eventSessionId = session.id;
                            const requestEntry = this.findPendingRequestByCurrentMonitoringSessionIdInternal(eventSessionId);
                            const reqIdForLog = requestEntry ? requestEntry[0] : 'unknown-request';
                            console.log(`[DSM][Tracker][${reqIdForLog}] Received 'stopped' event for session ${eventSessionId}. Searching for pending request monitoring this session ID. Found: ${requestEntry ? requestEntry[0] : 'NO'}.`);

                            if (requestEntry) {
                                const [requestId, pendingReqGeneric] = requestEntry;
                                if (pendingReqGeneric.isResolved) return;

                                try {
                                    const stopEventData = await this.debugStateProvider.buildStopEventData(session, message.body);
                                    console.log(`[DSM][Tracker][${requestId}] Stop event data built. Resolving promise.`);
                                    const stoppedResponse: StartDebuggingResponsePayload = { status: IPC_STATUS_STOPPED, data: stopEventData };

                                    this.resolveAnyRequestByType(requestId, stoppedResponse, eventSessionId);
                                } catch (error: any) {
                                    console.error(`[DSM][Tracker][${requestId}] Error building stop event data:`, error);
                                    const errorResult: StartDebuggingResponsePayload = { status: IPC_STATUS_ERROR, message: `构建停止事件数据时出错: ${error.message}` };
                                    this.resolveAnyRequestByType(requestId, errorResult, eventSessionId);
                                }
                            } else {
                                console.warn(`[DSM][Tracker] Received 'stopped' event for session ${eventSessionId}, but no pending request was actively monitoring this session ID.`);
                            }
                        } else if (message.type === 'event' && message.event === 'terminated') {
                            // Terminated event is primarily handled by onDidTerminateDebugSession
                            // console.log(`[DSM][Tracker][${session.id}] Received 'terminated' event via tracker.`);
                        }
                    },
                    onError: (error: Error) => {
                        const eventSessionId = session.id;
                        const requestEntry = this.findPendingRequestByCurrentMonitoringSessionIdInternal(eventSessionId, true); // checkInitialIdForStart = true
                        const reqIdForLog = requestEntry ? requestEntry[0] : 'unknown-request';
                        console.error(`[DSM][Tracker][${reqIdForLog}] Debug adapter error for session ${eventSessionId}:`, error);
                        console.log(`[DSM][Tracker][${eventSessionId}] Received 'error' event. Searching for pending request monitoring this session ID (or initial for start). Found: ${requestEntry ? requestEntry[0] : 'NO'}.`);
                        
                        if (requestEntry) {
                            const [requestId, pendingReqGenericUntyped] = requestEntry;
                            if (pendingReqGenericUntyped.isResolved) return;

                            // Only PendingStartRequest has isExtensionHostCase and initialSessionId
                            if (requestId.startsWith('start-')) {
                                const pendingStartReq = pendingReqGenericUntyped as PendingRequest;
                                if (pendingStartReq.isExtensionHostCase &&
                                    eventSessionId === pendingStartReq.initialSessionId &&
                                    pendingStartReq.currentMonitoringSessionId === pendingStartReq.initialSessionId && // Critical: only if we are still waiting for child
                                    error.message.includes('connection closed')) {
                                    console.warn(`[DSM][${requestId}] Error/Closed event for initial PARENT session ${eventSessionId} while still monitoring it (currentMonitoringId is also ${pendingStartReq.currentMonitoringSessionId}). Waiting for child or timeout.`);
                                    this.logPendingRequestsStateInternal(eventSessionId, requestId);
                                    return;
                                }
                                if (eventSessionId === pendingStartReq.currentMonitoringSessionId) {
                                    console.error(`[DSM][${requestId}] Error/Closed event for CURRENTLY MONITORED session ${eventSessionId}. Rejecting request.`);
                                    const errorResult: StartDebuggingResponsePayload = { status: IPC_STATUS_ERROR, message: `调试适配器错误 (监控会话 ${eventSessionId}): ${error.message}` };
                                    this.resolveRequestInternal(requestId, errorResult);
                                    this.logPendingRequestsStateInternal(eventSessionId, requestId);
                                    return;
                                }
                            } else if (eventSessionId === (pendingReqGenericUntyped as PendingRequest | PendingStepRequest).currentMonitoringSessionId) {
                                // For continue or step requests
                                console.error(`[DSM][${requestId}] Error/Closed event for CURRENTLY MONITORED session ${eventSessionId} (Continue/Step). Rejecting request.`);
                                const errorResult: StartDebuggingResponsePayload = { status: IPC_STATUS_ERROR, message: `调试适配器错误 (监控会话 ${eventSessionId}): ${error.message}` };
                                this.resolveAnyRequestByType(requestId, errorResult, eventSessionId);
                                this.logPendingRequestsStateInternal(eventSessionId, requestId);
                                return;
                            }
                            // If not caught by specific conditions above, log and potentially don't auto-resolve if it's not the current monitoring target
                            console.warn(`[DSM][Tracker][${requestId}] onError for session ${eventSessionId}, but it's not the primary monitored session or specific parent condition not met. CurrentMonID: ${(pendingReqGenericUntyped as PendingRequest).currentMonitoringSessionId}`);
                            this.logPendingRequestsStateInternal(eventSessionId, requestId);

                        } else {
                             console.warn(`[DSM][Tracker] onError for session ${eventSessionId}, but no active pending request found monitoring this session ID.`);
                        }
                    },
                    onExit: (code: number | undefined, signal: string | undefined) => {
                        const eventSessionId = session.id;
                        const requestEntry = this.findPendingRequestByCurrentMonitoringSessionIdInternal(eventSessionId, true); // checkInitialIdForStart = true
                        const reqIdForLog = requestEntry ? requestEntry[0] : 'unknown-request';
                        console.log(`[DSM][Tracker][${reqIdForLog}] Debug adapter exit for session ${eventSessionId}: code=${code}, signal=${signal}.`);
                        console.log(`[DSM][Tracker][${eventSessionId}] Received 'exit' event. Searching for pending request monitoring this session ID (or initial for start). Found: ${requestEntry ? requestEntry[0] : 'NO'}.`);

                        if (requestEntry) {
                            const [requestId, pendingReqGenericUntyped] = requestEntry;
                             if (pendingReqGenericUntyped.isResolved) return;

                            if (requestId.startsWith('start-')) {
                                const pendingStartReq = pendingReqGenericUntyped as PendingRequest;
                                if (pendingStartReq.isExtensionHostCase &&
                                    eventSessionId === pendingStartReq.initialSessionId &&
                                    pendingStartReq.currentMonitoringSessionId === pendingStartReq.initialSessionId) { // Still monitoring parent
                                    console.warn(`[DSM][${requestId}] Initial PARENT session ${eventSessionId} exited (code: ${code}, signal: ${signal}) while still being monitored. Waiting for child or timeout.`);
                                     this.logPendingRequestsStateInternal(eventSessionId, requestId);
                                    return;
                                }
                                if (eventSessionId === pendingStartReq.currentMonitoringSessionId) {
                                     console.error(`[DSM][${requestId}] CURRENTLY MONITORED session ${eventSessionId} exited. Rejecting request.`);
                                     const errorResult: StartDebuggingResponsePayload = { status: IPC_STATUS_ERROR, message: `调试适配器意外退出 (监控会话 ${eventSessionId}, code: ${code}, signal: ${signal})` };
                                     this.resolveRequestInternal(requestId, errorResult);
                                     this.logPendingRequestsStateInternal(eventSessionId, requestId);
                                     return;
                                }
                            } else if (eventSessionId === (pendingReqGenericUntyped as PendingRequest | PendingStepRequest).currentMonitoringSessionId) {
                                console.error(`[DSM][${requestId}] CURRENTLY MONITORED session ${eventSessionId} (Continue/Step) exited. Rejecting request.`);
                                const errorResult: StartDebuggingResponsePayload = { status: IPC_STATUS_ERROR, message: `调试适配器意外退出 (监控会话 ${eventSessionId}, code: ${code}, signal: ${signal})` };
                                this.resolveAnyRequestByType(requestId, errorResult, eventSessionId);
                                this.logPendingRequestsStateInternal(eventSessionId, requestId);
                                return;
                            }
                            console.warn(`[DSM][Tracker][${requestId}] onExit for session ${eventSessionId}, but it's not the primary monitored session or specific parent condition not met. CurrentMonID: ${(pendingReqGenericUntyped as PendingRequest).currentMonitoringSessionId}`);
                            this.logPendingRequestsStateInternal(eventSessionId, requestId);
                        } else {
                            console.log(`[DSM][Tracker] onExit for session ${eventSessionId}, but no active pending request found monitoring this session ID.`);
                        }
                    }
                };
            }
        });
    }

    public async startDebuggingAndWait(configurationName: string, noDebug: boolean): Promise<StartDebuggingResponsePayload> {
        const requestId = `start-${this.requestCounter++}`;
        console.log(`[DSM][${requestId}] Attempting to start debug session. Config: ${configurationName}, NoDebug: ${noDebug}`);

        return new Promise<StartDebuggingResponsePayload>(async (resolve) => {
            const folder = vscode.workspace.workspaceFolders?.[0];
            if (!folder) {
                console.error(`[DSM][${requestId}] Error: No workspace folder found.`);
                resolve({ status: IPC_STATUS_ERROR, message: '无法确定工作区文件夹。' });
                return;
            }

            const launchConfig = vscode.workspace.getConfiguration('launch', folder.uri);
            const configurations = launchConfig.get<vscode.DebugConfiguration[]>('configurations') || [];
            let targetConfig = configurations.find(conf => conf.name === configurationName);

            if (!targetConfig) {
                console.error(`[DSM][${requestId}] Debug configuration '${configurationName}' not found.`);
                resolve({ status: IPC_STATUS_ERROR, message: `找不到名为 '${configurationName}' 的调试配置。` });
                return;
            }
            if (noDebug) {
                targetConfig = { ...targetConfig, noDebug: true };
            }
            console.log(`[DSM][${requestId}] Resolved targetConfig:`, JSON.stringify(targetConfig));

            const isExtensionHost = targetConfig.type === 'extensionHost' || targetConfig.type === 'pwa-extensionHost';
            console.log(`[DSM][${requestId}] Is extensionHost debug: ${isExtensionHost}`);

            if (typeof targetConfig.program === 'string' && targetConfig.program.includes('${file}')) {
                const activeEditor = vscode.window.activeTextEditor;
                if (activeEditor) {
                    targetConfig.program = targetConfig.program.replace('${file}', activeEditor.document.uri.fsPath);
                } else {
                    this.resolveRequestInternal(requestId, { status: IPC_STATUS_ERROR, message: `无法解析 \${file}，无活动编辑器。` });
                    return;
                }
            }

            const timeout = isExtensionHost ? 120000 : 60000; // TODO: Make configurable
            console.log(`[DSM][${requestId}] Setting timeout to ${timeout}ms.`);
            const timeoutHandle = setTimeout(() => {
                const req = this.pendingStartRequests.get(requestId);
                if (req && !req.isResolved) {
                    let msg = `等待调试器首次停止或结束超时 (${timeout}ms)。`;
                    if (req.isExtensionHostCase) {
                        msg = req.currentMonitoringSessionId
                            ? `等待 extensionHost 主调试会话 (${req.currentMonitoringSessionId}) 停止或完成超时 (${timeout}ms)。`
                            : `等待 extensionHost 主调试会话超时 (${timeout}ms)。初始会话ID: ${req.initialSessionId || '未记录'}, 当前监控ID: ${req.currentMonitoringSessionId || '未设置'}`;
                    }
                    console.warn(`[DSM][${requestId}] TIMEOUT while waiting for event from session: ${req.currentMonitoringSessionId || 'unknown'}. Initial session was: ${req.initialSessionId || 'unknown'}. Message: ${msg}`);
                    this.resolveRequestInternal(requestId, { status: IPC_STATUS_TIMEOUT, message: msg });
                }
            }, timeout);

            const pendingRequest: PendingRequest = {
                requestId,
                configurationName,
                resolve,
                timeoutHandle,
                listeners: [],
                isResolved: false,
                isExtensionHostCase: isExtensionHost,
                initialSessionId: undefined, // Will be set in handleDebugSessionStarted if parent
                currentMonitoringSessionId: undefined, // Will be set in handleDebugSessionStarted
            };
            this.pendingStartRequests.set(requestId, pendingRequest);
            console.log(`[DSM][${requestId}] Created PendingRequest. InitialSessionId: ${pendingRequest.initialSessionId}, CurrentMonitoringSessionId: ${pendingRequest.currentMonitoringSessionId}`);

            try {
                console.log(`[DSM][${requestId}] Calling vscode.debug.startDebugging...`);
                const success = await vscode.debug.startDebugging(folder, targetConfig);
                console.log(`[DSM][${requestId}] vscode.debug.startDebugging returned: ${success}`);
                if (!success && !pendingRequest.isResolved) {
                    this.resolveRequestInternal(requestId, { status: IPC_STATUS_ERROR, message: 'VS Code 报告无法启动调试会话 (startDebugging 返回 false)。' });
                } else if (success) {
                    console.log(`[DSM][${requestId}] vscode.debug.startDebugging call succeeded. Waiting for session events...`);
                }
            } catch (error: any) {
                if (!pendingRequest.isResolved) {
                    console.error(`[DSM][${requestId}] Error calling vscode.debug.startDebugging:`, error);
                    this.resolveRequestInternal(requestId, { status: IPC_STATUS_ERROR, message: `启动调试时出错: ${error.message}` });
                }
            }
        });
    }

    private handleDebugSessionStarted(session: vscode.DebugSession): void {
        console.log(`[DSM] Event: onDidStartDebugSession. Session: id=${session.id}, type=${session.type}, name=${session.name}, parentId=${session.parentSession?.id}, configName=${session.configuration.name}`);
        this.activeSessions.set(session.id, session);
    
        let associatedRequestId: string | undefined;
    
        // --- Handling Child Sessions (extensionHost specific) ---
        if (session.parentSession) {
            const parentId = session.parentSession.id;
            for (const [reqId, pendingReq] of this.pendingStartRequests.entries()) {
                if (pendingReq.isExtensionHostCase && pendingReq.initialSessionId === parentId && !pendingReq.isResolved) {
                    associatedRequestId = reqId;
                    console.log(`[DSM][${reqId}] Child session ${session.id} started, its parent ${parentId} matches initialSessionId of this pending request.`);
                    
                    // Heuristic to identify the "main" child session
                    const isPrimaryChild = session.type === 'pwa-chrome' &&
                                           (session.name.includes('Extension Host') ||
                                            session.name.includes(pendingReq.configurationName) || // Check against original config name
                                            session.name.startsWith(pendingReq.configurationName)); // Check prefix
    
                    if (isPrimaryChild) {
                        const oldMonitoringId = pendingReq.currentMonitoringSessionId;
                        pendingReq.currentMonitoringSessionId = session.id; // Switch monitoring to the child
                        console.log(`[DSM][${reqId}] Identified primary CHILD session: ${session.id} (parent: ${parentId}). UPDATED pending request to monitor CHILD session. Old monitoring ID: ${oldMonitoringId}, New monitoring ID: ${session.id}.`);
                        // Optionally reset timeout here if needed
                    } else {
                        console.log(`[DSM][${reqId}] Ignoring non-primary extensionHost child: ${session.id} (type: ${session.type}, name: ${session.name}, parent: ${parentId})`);
                    }
                    break; // Found the relevant pending request for this child's parent
                }
            }
            if (!associatedRequestId) {
                console.log(`[DSM] Child session ${session.id} (parent: ${parentId}) started, but no matching pendingStartRequest found for its parent (isExtensionHostCase and initialSessionId match).`);
            }
        }
        // --- Handling Parent Sessions or Non-ExtensionHost Sessions ---
        else {
            for (const [reqId, pendingReq] of this.pendingStartRequests.entries()) {
                // Match by configuration name, ensure it's not resolved, and either not yet associated or it's the first association for an extension host parent
                if (pendingReq.configurationName === session.configuration.name && !pendingReq.isResolved) {
                    if (pendingReq.isExtensionHostCase) {
                        if (!pendingReq.initialSessionId && (session.type === 'extensionHost' || session.type === 'pwa-extensionHost')) {
                            associatedRequestId = reqId;
                            pendingReq.initialSessionId = session.id;
                            pendingReq.currentMonitoringSessionId = session.id; // Start by monitoring the parent
                            console.log(`[DSM][${reqId}] Associated with initial PARENT session: ${session.id} (type: ${session.type}). Monitoring this session for events. currentMonitoringSessionId set to ${session.id}.`);
                            break;
                        }
                    } else { // Not an extensionHost case
                        if (!pendingReq.currentMonitoringSessionId) { // First association for this non-EH request
                            associatedRequestId = reqId;
                            pendingReq.currentMonitoringSessionId = session.id;
                            console.log(`[DSM][${reqId}] Associated non-extensionHost session ${session.id} with pending request. currentMonitoringSessionId set to ${session.id}.`);
                            break;
                        } else if (pendingReq.currentMonitoringSessionId === session.id) {
                            // Already tracking this session for this request, likely a re-entrant call or duplicate event, log and ignore.
                            associatedRequestId = reqId; // Still the relevant request
                            console.log(`[DSM][${reqId}] Session ${session.id} (non-EH) started, already monitoring this session for this request. No change.`);
                            break;
                        } else {
                            console.warn(`[DSM][${reqId}] Non-extensionHost pending request already associated with ${pendingReq.currentMonitoringSessionId}, but new session ${session.id} started with same config name. This is unexpected.`);
                        }
                    }
                }
            }
            if (!associatedRequestId) {
                 console.log(`[DSM] No PENDING START request found to associate with (parent/non-EH) session ${session.id} (name: "${session.configuration.name}", type: ${session.type}).`);
            }
        }
    
        if (associatedRequestId) {
            this.logPendingRequestsStateInternal(session.id, associatedRequestId);
        } else {
            // Log for sessions that didn't match any pending start request logic above
            // This can happen for user-initiated debug sessions, or subsequent child sessions we don't explicitly track for a single start request.
            console.log(`[DSM] Session ${session.id} (name: "${session.configuration.name}", type: ${session.type}) started, but did not match specific logic to update a pending start request's monitoring target. This may be normal for unrelated sessions or secondary children.`);
        }
    }
    
    private handleDebugSessionTerminatedInternal(session: vscode.DebugSession): void {
        const eventSessionId = session.id;
        console.log(`[DSM] Event: onDidTerminateDebugSession. Session: id=${eventSessionId}, type=${session.type}, name=${session.name}`);
        this.activeSessions.delete(eventSessionId);
        this.cleanupSessionListeners(eventSessionId);

        // Check if this terminated session was an initial parent of an extensionHost debug
        const pendingStartReqEntryForInitial = Array.from(this.pendingStartRequests.entries())
            .find(([, req]) => req.isExtensionHostCase && req.initialSessionId === eventSessionId && !req.isResolved);

        if (pendingStartReqEntryForInitial) {
            const [reqId, pendingReq] = pendingStartReqEntryForInitial;
            // If the parent terminates AND we are still monitoring it (meaning no child took over, or child also terminated and we reverted to parent)
            // OR if we were monitoring a child that now terminated, but the parent is this one.
            if (pendingReq.currentMonitoringSessionId === eventSessionId) {
                 console.warn(`[DSM][${reqId}] Monitored session (which was initial parent) ${eventSessionId} terminated. If no child was identified or child also terminated, this might lead to timeout/error.`);
                 // Don't resolve here directly, let timeout or tracker's onExit/onError for the *currentMonitoringSessionId* handle it.
                 // Or, if we are sure no child will come, resolve as error.
                 // For now, let existing logic in tracker.onError/onExit or timeout handle it.
            } else if (pendingReq.currentMonitoringSessionId && pendingReq.currentMonitoringSessionId !== eventSessionId) {
                 console.log(`[DSM][${reqId}] Initial extensionHost parent session ${eventSessionId} terminated. This is usually expected as child ${pendingReq.currentMonitoringSessionId} is/was tracked.`);
            } else { // No currentMonitoringSessionId, means child was never identified
                 console.warn(`[DSM][${reqId}] Initial extensionHost parent session ${eventSessionId} terminated, but no primary child session was identified or being monitored. Resolving as error.`);
                 this.resolveRequestInternal(reqId, { status: IPC_STATUS_ERROR, message: `extensionHost 初始父会话 ${eventSessionId} 已终止，但未识别或监控到关键子会话。` });
            }
            this.logPendingRequestsStateInternal(eventSessionId, reqId);
            return; // Handled this case.
        }

        // For all other cases (non-initial parent, or non-start requests)
        const requestEntry = this.findPendingRequestByCurrentMonitoringSessionIdInternal(eventSessionId);
        const reqIdForLog = requestEntry ? requestEntry[0] : 'unknown-request';
        console.log(`[DSM][${eventSessionId}] Received 'terminated' event. Searching for pending request monitoring this session ID. Found: ${requestEntry ? requestEntry[0] : 'NO'}.`);

        if (requestEntry) {
            const [requestId, pendingReqGeneric] = requestEntry;
            if (!pendingReqGeneric.isResolved) {
                console.log(`[DSM][${requestId}] Resolving request as 'completed' due to tracked session ${eventSessionId} termination.`);
                const completedResult: StartDebuggingResponsePayload = { status: IPC_STATUS_COMPLETED, message: `调试会话 ${eventSessionId} 已结束。` };
                this.resolveAnyRequestByType(requestId, completedResult, eventSessionId);
            } else {
                console.log(`[DSM][${requestId}] Request for session ${eventSessionId} was already resolved.`);
            }
        } else {
            console.log(`[DSM] No active pending request found monitoring terminated session ${eventSessionId}. Might be user-initiated or already handled.`);
        }
    }

    public async continueDebuggingAndWait(params: ContinueDebuggingParams): Promise<StartDebuggingResponsePayload> {
        const { sessionId: currentSessionId, threadId } = params; // Renamed sessionId to currentSessionId for clarity
        const requestId = `continue-${this.requestCounter++}`;
        console.log(`[DSM][${requestId}] Starting continue request for session ${currentSessionId}, thread ${threadId}`);

        return new Promise<StartDebuggingResponsePayload>(async (resolve) => {
            if (!currentSessionId) {
                resolve({ status: IPC_STATUS_ERROR, message: 'Continue中止：未提供 sessionId。' });
                return;
            }
            const session = this.activeSessions.get(currentSessionId);
            if (!session) {
                resolve({ status: IPC_STATUS_ERROR, message: `找不到活动的调试会话 ID: ${currentSessionId}` });
                return;
            }

            const timeout = 60000; // TODO: Make configurable
            const timeoutHandle = setTimeout(() => {
                this.resolveContinueRequestInternal(requestId, { status: IPC_STATUS_TIMEOUT, message: `等待调试器再次停止或结束超时 (${timeout}ms)。` });
            }, timeout);

            const pendingRequest: PendingRequest = {
                requestId,
                configurationName: session.configuration.name,
                resolve,
                timeoutHandle,
                listeners: [],
                currentMonitoringSessionId: currentSessionId, // Explicitly set the session being monitored
                isResolved: false,
                // isExtensionHostCase and initialSessionId are not typically relevant for continue
            };
            this.pendingContinueRequests.set(requestId, pendingRequest);
            console.log(`[DSM][${requestId}] Created PendingRequest for continue. CurrentMonitoringSessionId: ${pendingRequest.currentMonitoringSessionId}`);

            try {
                await session.customRequest('continue', { threadId });
                console.log(`[DSM][${requestId}] 'continue' DAP request sent. Waiting for events...`);
            } catch (error: any) {
                this.resolveContinueRequestInternal(requestId, { status: IPC_STATUS_ERROR, message: `发送 'continue' 请求失败: ${error.message}` });
            }
        });
    }

    public async stepExecutionAndWait(sessionIdParam: string | undefined, threadId: number, stepType: 'over' | 'into' | 'out', timeoutMs: number = 30000): Promise<StepExecutionResult> {
        const requestId = `step-${this.requestCounter++}`;
        const activeSessionId = sessionIdParam ?? vscode.debug.activeDebugSession?.id;

        console.log(`[DSM][${requestId}] Starting step request for session ${activeSessionId}, thread ${threadId}, type ${stepType}`);

        return new Promise<StepExecutionResult>(async (resolve, reject) => {
            if (!activeSessionId) {
                reject({ status: IPC_STATUS_ERROR, message: 'Step中止：无法确定有效的 sessionId。' } as StepExecutionResult);
                return;
            }
            const session = this.activeSessions.get(activeSessionId);
            if (!session) {
                reject({ status: IPC_STATUS_ERROR, message: `未找到匹配的活动调试会话 ID: ${activeSessionId}` } as StepExecutionResult);
                return;
            }

            const dapCommand = stepType === 'over' ? 'next' : stepType === 'into' ? 'stepIn' : 'stepOut';
            const timeoutHandle = setTimeout(() => {
                this.resolveStepRequestInternal(requestId, { status: IPC_STATUS_TIMEOUT, message: `等待调试器在单步执行后停止超时 (${timeoutMs}ms)。` } as StepExecutionResult);
            }, timeoutMs);

            this.pendingStepRequests.set(requestId, { requestId, resolve, reject, timeoutHandle, threadId, stepType, currentMonitoringSessionId: activeSessionId, isResolved: false });
            console.log(`[DSM][${requestId}] Created PendingStepRequest. CurrentMonitoringSessionId: ${activeSessionId}`);
            
            try {
                await session.customRequest(dapCommand, { threadId });
                console.log(`[DSM][${requestId}] '${dapCommand}' DAP request sent. Waiting for events...`);
            } catch (error: any) {
                this.resolveStepRequestInternal(requestId, { status: IPC_STATUS_ERROR, message: `发送 ${dapCommand} 命令失败: ${error.message || error}` } as StepExecutionResult);
            }
        });
    }

    private resolveRequestInternal(requestId: string, result: StartDebuggingResponsePayload): void {
        const pendingRequest = this.pendingStartRequests.get(requestId);
        if (pendingRequest && !pendingRequest.isResolved) {
            pendingRequest.isResolved = true;
            clearTimeout(pendingRequest.timeoutHandle);
            this.pendingStartRequests.delete(requestId);
            console.log(`[DSM][${requestId}] Resolving start request with status: ${result.status}`);
            pendingRequest.resolve(result);
        } else if (pendingRequest?.isResolved) {
            console.warn(`[DSM][${requestId}] Attempted to resolve already resolved start request.`);
        } else {
            console.warn(`[DSM][${requestId}] Attempted to resolve non-existent or cleaned up start request.`);
        }
    }

    private resolveContinueRequestInternal(requestId: string, result: StartDebuggingResponsePayload): void {
        const pendingRequest = this.pendingContinueRequests.get(requestId);
        if (pendingRequest && !pendingRequest.isResolved) {
            pendingRequest.isResolved = true;
            clearTimeout(pendingRequest.timeoutHandle);
            this.pendingContinueRequests.delete(requestId);
            console.log(`[DSM][${requestId}] Resolving continue request with status: ${result.status}`);
            pendingRequest.resolve(result);
        } else if (pendingRequest?.isResolved) {
            console.warn(`[DSM][${requestId}] Attempted to resolve already resolved continue request.`);
        } else {
            console.warn(`[DSM][${requestId}] Attempted to resolve non-existent or cleaned up continue request.`);
        }
    }

    private resolveStepRequestInternal(requestId: string, result: StepExecutionResult): void {
        const pendingRequest = this.pendingStepRequests.get(requestId);
        if (pendingRequest && !pendingRequest.isResolved) {
            pendingRequest.isResolved = true;
            clearTimeout(pendingRequest.timeoutHandle);
            this.pendingStepRequests.delete(requestId);
            console.log(`[DSM][${requestId}] Resolving step request with status: ${result.status}`);
            if (result.status === IPC_STATUS_STOPPED || result.status === IPC_STATUS_COMPLETED) {
                pendingRequest.resolve(result);
            } else {
                pendingRequest.reject(result); // Errors or timeout for step are rejected
            }
        } else if (pendingRequest?.isResolved) {
            console.warn(`[DSM][${requestId}] Attempted to resolve already resolved step request.`);
        } else {
            console.warn(`[DSM][${requestId}] Attempted to resolve non-existent or cleaned up step request.`);
        }
    }
    
    private resolveAnyRequestByType(requestId: string, result: StartDebuggingResponsePayload | StepExecutionResult, eventSessionId: string) {
            console.log(`[DSM][${requestId}] Attempting to resolve request of type derived from prefix, due to event from session ${eventSessionId}. Status: ${result.status}`);
            if (requestId.startsWith('start-')) {
                const req = this.pendingStartRequests.get(requestId);
                if (req && req.currentMonitoringSessionId === eventSessionId) {
                     this.resolveRequestInternal(requestId, result as StartDebuggingResponsePayload);
                } else if (req) {
                    console.warn(`[DSM][${requestId}] 'start-' request resolution skipped: event session ${eventSessionId} does not match current monitoring session ${req.currentMonitoringSessionId}.`);
                }
            } else if (requestId.startsWith('continue-')) {
                const req = this.pendingContinueRequests.get(requestId);
                if (req && req.currentMonitoringSessionId === eventSessionId) {
                    this.resolveContinueRequestInternal(requestId, result as StartDebuggingResponsePayload);
                } else if (req) {
                    console.warn(`[DSM][${requestId}] 'continue-' request resolution skipped: event session ${eventSessionId} does not match current monitoring session ${req.currentMonitoringSessionId}.`);
                }
            } else if (requestId.startsWith('step-')) {
                const req = this.pendingStepRequests.get(requestId);
                if (req && req.currentMonitoringSessionId === eventSessionId) {
                    this.resolveStepRequestInternal(requestId, result as StepExecutionResult);
                } else if (req) {
                     console.warn(`[DSM][${requestId}] 'step-' request resolution skipped: event session ${eventSessionId} does not match current monitoring session ${req.currentMonitoringSessionId}.`);
                }
            } else {
                console.warn(`[DSM][${requestId}] Could not determine request type from prefix to resolve.`);
            }
        }
    
        /**
         * Finds a pending request (start, continue, or step) whose currentMonitoringSessionId matches the given sessionId.
         * For start requests, if checkInitialIdForStart is true, it will also check initialSessionId.
         */
        private findPendingRequestByCurrentMonitoringSessionIdInternal(
            eventSessionId: string,
            checkInitialIdForStart: boolean = false
        ): [string, PendingRequest | PendingStepRequest] | undefined {
            for (const entry of this.pendingStartRequests.entries()) {
                const req = entry[1];
                if (!req.isResolved) {
                    if (req.currentMonitoringSessionId === eventSessionId) return entry;
                    // Special case for extensionHost parent session errors/exits before child is identified
                    if (checkInitialIdForStart && req.isExtensionHostCase && req.initialSessionId === eventSessionId && req.currentMonitoringSessionId === req.initialSessionId) {
                        return entry;
                    }
                }
            }
            for (const entry of this.pendingContinueRequests.entries()) {
                const req = entry[1];
                if (req.currentMonitoringSessionId === eventSessionId && !req.isResolved) return entry;
            }
            for (const entry of this.pendingStepRequests.entries()) {
                const req = entry[1];
                if (req.currentMonitoringSessionId === eventSessionId && !req.isResolved) return entry;
            }
            return undefined;
        }
    
        // findPendingContinueRequestBySessionIdInternal and findPendingStepRequestBySessionIdInternal
        // are effectively replaced by the logic within findPendingRequestByCurrentMonitoringSessionIdInternal
        // or by directly checking currentMonitoringSessionId on the specific request map if needed.
        // Keeping them for now if specific non-monitoring ID based lookup is ever needed, but they seem redundant.
    
        private cleanupSessionListeners(sessionId: string): void {
            const listeners = this.sessionListeners.get(sessionId);
            if (listeners) {
                listeners.forEach(d => d.dispose());
                this.sessionListeners.delete(sessionId);
                console.log(`[DSM] Disposed listeners for session ${sessionId}.`);
            }
        }
    
        private logPendingRequestsStateInternal(eventSessionId: string | undefined, currentRequestIdContext: string): void {
            console.error(`[DSM][Tracker] Logging Pending Requests State (Context: eventSessionId=${eventSessionId}, currentReqId=${currentRequestIdContext}):`);
            this.pendingStartRequests.forEach((req, id) => {
                // Log if related to the event session or the specific request ID in context
                if (req.initialSessionId === eventSessionId || req.currentMonitoringSessionId === eventSessionId || id === currentRequestIdContext) {
                    console.error(`  - StartReq ID: ${id}, Resolved: ${req.isResolved}, Cfg: ${req.configurationName}, InitSessId: ${req.initialSessionId}, CurrMonSessId: ${req.currentMonitoringSessionId}, IsExtHost: ${req.isExtensionHostCase}`);
                }
            });
            this.pendingContinueRequests.forEach((req, id) => {
                if (req.currentMonitoringSessionId === eventSessionId || id === currentRequestIdContext) {
                    console.error(`  - ContReq ID: ${id}, Resolved: ${req.isResolved}, CurrMonSessId: ${req.currentMonitoringSessionId}`);
                }
            });
            this.pendingStepRequests.forEach((req, id) => {
                if (req.currentMonitoringSessionId === eventSessionId || id === currentRequestIdContext) {
                    console.error(`  - StepReq ID: ${id}, Resolved: ${req.isResolved}, CurrMonSessId: ${req.currentMonitoringSessionId}, TID: ${req.threadId}, Type: ${req.stepType}`);
                }
        });
    }

    public stopDebugging(sessionId?: string): void {
        let sessionToStop: vscode.DebugSession | undefined;
        if (sessionId) {
            sessionToStop = this.activeSessions.get(sessionId);
            if (!sessionToStop) {
                if (vscode.debug.activeDebugSession && vscode.debug.activeDebugSession.id === sessionId) {
                    sessionToStop = vscode.debug.activeDebugSession;
                } else {
                    console.warn(`[DSM] stopDebugging: Session ${sessionId} not found in activeSessions or as activeDebugSession.`);
                }
            }
        } else {
            sessionToStop = vscode.debug.activeDebugSession;
        }
    
        if (sessionToStop) {
            console.log(`[DSM] Requesting stop for debug session: ${sessionToStop.id} (name: ${sessionToStop.name})`);
            vscode.debug.stopDebugging(sessionToStop).then(
                () => console.log(`[DSM] Stop request for ${sessionToStop!.id} completed.`),
                (err) => console.error(`[DSM] Error stopping session ${sessionToStop!.id}:`, err)
            );
        } else {
            console.log("[DSM] stopDebugging: No active debug session to stop, or specified session not found.");
        }
    }
}