// src/vscode/debugSessionManager.ts
import * as vscode from 'vscode';
import { DebugStateProvider } from './debugStateProvider'; // 引入依赖
import { ContinueDebuggingParams, StartDebuggingResponsePayload, StopEventData, VariableInfo } from '../types'; // 确认路径和类型
import { IPC_STATUS_SUCCESS, IPC_STATUS_ERROR, IPC_STATUS_STOPPED, IPC_STATUS_COMPLETED, IPC_STATUS_TIMEOUT, IPC_STATUS_INTERRUPTED } from '../constants'; // 导入所有需要的常量

// PendingRequest 接口定义
interface PendingRequest {
    configurationName: string; // 用于启动时匹配
    resolve: (value: StartDebuggingResponsePayload) => void;
    timeoutTimer: NodeJS.Timeout;
    listeners: vscode.Disposable[]; // 用于管理 session 生命周期监听器
    trackerDisposable?: vscode.Disposable; // 用于管理 tracker factory
    sessionId?: string; // 在 onDidStartDebugSession 中设置
    isResolved: boolean; // 标记是否已被解决，防止重复处理
}

export class DebugSessionManager {
    private pendingStartRequests = new Map<string, PendingRequest>(); // key 是 requestId
    private pendingContinueRequests = new Map<string, PendingRequest>(); // 新增 Map 管理 continue 请求
    private sessionListeners = new Map<string, vscode.Disposable[]>(); // key 是 sessionId
    private requestCounter = 0; // 用于生成唯一的请求 ID

    constructor(private debugStateProvider: DebugStateProvider) {
        this.initializeDebugListeners();
        console.log("DebugSessionManager initialized.");
    }

    public async continueDebuggingAndWait(params: ContinueDebuggingParams): Promise<StartDebuggingResponsePayload> {
        const { sessionId, threadId } = params;
        const requestId = `continue-${this.requestCounter++}`;
        console.log(`[DebugSessionManager] Starting continue request: ${requestId} for session ${sessionId}, thread ${threadId}`);

        return new Promise<StartDebuggingResponsePayload>(async (resolve) => {
            const session = vscode.debug.activeDebugSession?.id === sessionId ? vscode.debug.activeDebugSession : undefined; // 确保是活动会话

            if (!session) {
                resolve({ status: IPC_STATUS_ERROR, message: `找不到活动的调试会话 ID: ${sessionId}` });
                return;
            }

            // --- 设置超时和 PendingRequest ---
            const timeout = 60000; // 超时时间 (例如 60 秒)
            const timeoutTimer = setTimeout(() => {
                console.log(`[DebugSessionManager] Continue request ${requestId} timed out.`);
                this.resolveContinueRequest(requestId, { status: IPC_STATUS_TIMEOUT, message: `等待调试器再次停止或结束超时 (${timeout}ms)。` });
            }, timeout);

            const pendingRequest: PendingRequest = {
                configurationName: session.configuration.name, // 用于日志或匹配，非关键
                resolve: resolve,
                timeoutTimer,
                listeners: [], // continue 操作通常不需要新的 session 监听器
                sessionId: sessionId, // 明确关联 sessionId
                isResolved: false,
            };
            this.pendingContinueRequests.set(requestId, pendingRequest); // 存入新的 Map

            // --- 发送 DAP 命令 ---
            try {
                console.log(`[DebugSessionManager] Sending 'continue' DAP request for session ${sessionId}, thread ${threadId}. Request ID: ${requestId}`);
                await session.customRequest('continue', { threadId: threadId });
                console.log(`[DebugSessionManager] 'continue' DAP request sent for ${requestId}. Waiting for events...`);
                // 等待 DebugAdapterTracker 的 onDidSendMessage 处理 stopped 或 onDidTerminateDebugSession 处理 terminated
            } catch (error: any) {
                console.error(`[DebugSessionManager] Error sending 'continue' DAP request for ${requestId}:`, error);
                this.resolveContinueRequest(requestId, { status: IPC_STATUS_ERROR, message: `发送 'continue' 请求失败: ${error.message}` });
            }
        });
    }

    // --- 修改事件处理逻辑以支持 continue 请求 ---

    private initializeDebugListeners(): void {
        // 监听调试会话启动
        vscode.debug.onDidStartDebugSession(session => {
            this.handleDebugSessionStarted(session);
        });

        // 监听调试会话终止
        vscode.debug.onDidTerminateDebugSession(session => {
            this.handleDebugSessionTerminated(session); // 这个函数需要修改
        });

        // 注册 Debug Adapter Tracker Factory (用于拦截 stopped 事件等)
        vscode.debug.registerDebugAdapterTrackerFactory('*', {
            createDebugAdapterTracker: (session: vscode.DebugSession) => {
                console.log(`[DebugSessionManager] createDebugAdapterTracker called for session ${session.id} (name: ${session.name}, type: ${session.type}).`);

                return {
                    onDidSendMessage: async (message: any) => {
                        // 查找与此会话关联的、尚未解决的 *任何* 请求 (start 或 continue)
                        const currentRequestEntry = this.findPendingRequestBySessionId(session.id, true); // 查找 start 或 continue

                        if (!currentRequestEntry) { return; }
                        const [currentRequestId, currentRequest] = currentRequestEntry;
                        if (currentRequest.isResolved) { return; }

                        // 处理停止事件 (对 start 和 continue 都有效)
                        if (message.type === 'event' && message.event === 'stopped') {
                            console.log(`[DebugSessionManager] Tracker for request ${currentRequestId} received 'stopped' event.`);
                            try {
                                const stopEventData = await this.debugStateProvider.buildStopEventData(session, message.body);
                                console.log(`[DebugSessionManager] Stop event data built for ${currentRequestId}. Resolving promise.`);
                                // 根据请求 ID 前缀判断是哪个 Map
                                if (currentRequestId.startsWith('start-')) {
                                    this.resolveRequest(currentRequestId, { status: IPC_STATUS_STOPPED, data: stopEventData });
                                } else if (currentRequestId.startsWith('continue-')) {
                                    this.resolveContinueRequest(currentRequestId, { status: IPC_STATUS_STOPPED, data: stopEventData });
                                }
                            } catch (error: any) {
                                console.error(`[DebugSessionManager] Error building stop event data for ${currentRequestId}:`, error);
                                const errorResult: StartDebuggingResponsePayload = { status: IPC_STATUS_ERROR, message: `构建停止事件数据时出错: ${error.message}` }; // Explicitly type and use constant
                                 if (currentRequestId.startsWith('start-')) {
                                    this.resolveRequest(currentRequestId, errorResult);
                                } else if (currentRequestId.startsWith('continue-')) {
                                    this.resolveContinueRequest(currentRequestId, errorResult);
                                }
                            }
                        }
                    },
                    onError: (error: Error) => { // 对 start 和 continue 都有效
                        const currentRequestEntry = this.findPendingRequestBySessionId(session.id, true);
                        if (!currentRequestEntry) { return; }
                        const [currentRequestId, currentRequest] = currentRequestEntry;
                        if (currentRequest.isResolved) { return; }
                        console.error(`[DebugSessionManager] Debug adapter error for session ${session.id}, request ${currentRequestId}:`, error);
                        const errorResult: StartDebuggingResponsePayload = { status: IPC_STATUS_ERROR, message: `调试适配器错误: ${error.message}` }; // Explicitly type and use constant
                        if (currentRequestId.startsWith('start-')) {
                            this.resolveRequest(currentRequestId, errorResult);
                        } else if (currentRequestId.startsWith('continue-')) {
                            this.resolveContinueRequest(currentRequestId, errorResult);
                        }
                    },
                    onExit: (code: number | undefined, signal: string | undefined) => { // 对 start 和 continue 都有效
                        const currentRequestEntry = this.findPendingRequestBySessionId(session.id, true);
                        if (!currentRequestEntry) { return; }
                        const [currentRequestId, currentRequest] = currentRequestEntry;
                        if (currentRequest.isResolved) { return; }
                        console.log(`[DebugSessionManager] Debug adapter exit for session ${session.id}, request ${currentRequestId}: code=${code}, signal=${signal}`);
                        // 仅在请求未被其他方式解决时，才因 Adapter 退出而标记为错误
                        const errorResult: StartDebuggingResponsePayload = { status: IPC_STATUS_ERROR, message: `调试适配器意外退出 (code: ${code}, signal: ${signal})` }; // Explicitly type and use constant
                         if (currentRequestId.startsWith('start-') && this.pendingStartRequests.has(currentRequestId)) {
                            this.resolveRequest(currentRequestId, errorResult);
                        } else if (currentRequestId.startsWith('continue-') && this.pendingContinueRequests.has(currentRequestId)) {
                            this.resolveContinueRequest(currentRequestId, errorResult);
                        }
                    }
                };
            }
        });
    }

    // --- 迁移过来的方法 ---

    public async startDebuggingAndWait(configurationName: string, noDebug: boolean): Promise<StartDebuggingResponsePayload> {
        const requestId = `start-${this.requestCounter++}`; // 使用内部计数器
        console.log(`[DebugSessionManager] Starting debug request: ${requestId} for ${configurationName}`);

        return new Promise<StartDebuggingResponsePayload>(async (resolve) => {
            let folder: vscode.WorkspaceFolder | undefined;
            try {
                folder = vscode.workspace.workspaceFolders?.[0];
                if (!folder) {
                    throw new Error('无法确定工作区文件夹。');
                }
            } catch (error: any) {
                resolve({ status: IPC_STATUS_ERROR, message: error.message });
                return;
            }
            const launchConfig = vscode.workspace.getConfiguration('launch', folder.uri);
            const configurations = launchConfig.get<vscode.DebugConfiguration[]>('configurations') || [];
            let targetConfig = configurations.find(conf => conf.name === configurationName);
            if (!targetConfig) {
              resolve({ status: IPC_STATUS_ERROR, message: `找不到名为 '${configurationName}' 的调试配置。` });
              return;
            }
            if (noDebug) {
              targetConfig = { ...targetConfig, noDebug: true };
            }

            const listeners: vscode.Disposable[] = [];

            const timeout = 60000; // 超时时间
            const timeoutTimer = setTimeout(() => {
                console.log(`[DebugSessionManager] Request ${requestId} timed out.`);
                this.resolveRequest(requestId, { status: IPC_STATUS_TIMEOUT, message: `等待调试器首次停止或结束超时 (${timeout}ms)。` });
            }, timeout);

            const pendingRequest: PendingRequest = {
                configurationName,
                resolve: resolve,
                timeoutTimer,
                listeners,
                isResolved: false,
            };
            this.pendingStartRequests.set(requestId, pendingRequest);

            // 启动调试
            try {
              console.log(`[DebugSessionManager] Calling vscode.debug.startDebugging for ${configurationName}`);
              const success = await vscode.debug.startDebugging(folder, targetConfig);
              if (!success) {
                console.error(`[DebugSessionManager] vscode.debug.startDebugging returned false for ${configurationName}. Request ID: ${requestId}`);
                this.resolveRequest(requestId, { status: IPC_STATUS_ERROR, message: 'VS Code 报告无法启动调试会话（startDebugging 返回 false）。' });
              } else {
                console.log(`[DebugSessionManager] vscode.debug.startDebugging call succeeded for ${configurationName}. Request ID: ${requestId}. Waiting for events...`);
              }
            } catch (error: any) {
              console.error(`[DebugSessionManager] Error calling vscode.debug.startDebugging for ${configurationName}. Request ID: ${requestId}:`, error);
              this.resolveRequest(requestId, { status: IPC_STATUS_ERROR, message: `启动调试时出错: ${error.message}` });
            }
        });
    }

    private handleDebugSessionStarted(session: vscode.DebugSession): void {
        console.log(`[DebugSessionManager] Debug session started: ${session.id} (${session.name})`);
        // 尝试将此会话与挂起的启动请求关联
        const matchingRequestEntry = Array.from(this.pendingStartRequests.entries())
            .find(([reqId, req]) =>
                req.configurationName === session.configuration.name &&
                !req.sessionId && // 确保只关联一次
                !req.isResolved
            );

        if (matchingRequestEntry) {
            const [reqIdToAssociate, requestToAssociate] = matchingRequestEntry;
            console.log(`[DebugSessionManager] Found matching pending request ${reqIdToAssociate} for session ${session.id}. Associating sessionId.`);
            requestToAssociate.sessionId = session.id; // 关联 sessionId
        } else {
            console.warn(`[DebugSessionManager] No matching pending request found for started session ${session.id} with config name "${session.configuration.name}". This session might not be tracked by a startDebuggingAndWait call.`);
        }
    }

    // 修改 handleDebugSessionTerminated 以处理 continue 请求
    private handleDebugSessionTerminated(session: vscode.DebugSession): void {
        console.log(`[DebugSessionManager] Debug session terminated: ${session.id} (${session.name})`);
        // 清理与此会话相关的特定监听器
        const listeners = this.sessionListeners.get(session.id);
        if (listeners) {
            listeners.forEach(d => d.dispose());
            this.sessionListeners.delete(session.id);
            console.log(`[DebugSessionManager] Disposed specific listeners for terminated session ${session.id}.`);
        }

        // 检查是否有等待此会话的 start 请求
        const terminatedStartRequestEntry = this.findPendingRequestBySessionId(session.id, false); // 只查 start
        if (terminatedStartRequestEntry) {
            const [terminatedRequestId, terminatedRequest] = terminatedStartRequestEntry;
            if (!terminatedRequest.isResolved) {
               console.log(`[DebugSessionManager] Resolving start request ${terminatedRequestId} as completed due to session termination.`);
               this.resolveRequest(terminatedRequestId, { status: IPC_STATUS_COMPLETED, message: '调试会话已结束。' });
            }
        }

        // 检查是否有等待此会话的 continue 请求
        const terminatedContinueRequestEntry = this.findPendingContinueRequestBySessionId(session.id); // 查 continue
         if (terminatedContinueRequestEntry) {
            const [terminatedRequestId, terminatedRequest] = terminatedContinueRequestEntry;
            if (!terminatedRequest.isResolved) {
               console.log(`[DebugSessionManager] Resolving continue request ${terminatedRequestId} as completed due to session termination.`);
               this.resolveContinueRequest(terminatedRequestId, { status: IPC_STATUS_COMPLETED, message: '调试会话已结束。' });
            }
        }
    }

    // --- 新增辅助函数 ---

    // 封装的 resolve 函数，用于 continue 请求
    private resolveContinueRequest(requestId: string, result: StartDebuggingResponsePayload): void {
        const pendingRequest = this.pendingContinueRequests.get(requestId);
        if (pendingRequest && !pendingRequest.isResolved) {
            pendingRequest.isResolved = true;
            clearTimeout(pendingRequest.timeoutTimer);
            this.pendingContinueRequests.delete(requestId);
            console.log(`[DebugSessionManager] Resolving continue request ${requestId} with status: ${result.status}`);
            pendingRequest.resolve(result);
        } else if (!pendingRequest) {
            console.warn(`[DebugSessionManager] Attempted to resolve already cleaned up or non-existent continue request: ${requestId}`);
        } else {
            console.warn(`[DebugSessionManager] Attempted to resolve already resolved continue request: ${requestId}`);
        }
    }

    // --- 辅助函数 ---

    // 封装的 resolve 函数，确保清理 (用于 start 请求)
    private resolveRequest(requestId: string, result: StartDebuggingResponsePayload): void {
        const pendingRequest = this.pendingStartRequests.get(requestId);
        if (pendingRequest && !pendingRequest.isResolved) {
            pendingRequest.isResolved = true; // 标记为已解决
            clearTimeout(pendingRequest.timeoutTimer);
            this.pendingStartRequests.delete(requestId);
            console.log(`[DebugSessionManager] Resolving request ${requestId} with status: ${result.status}`);
            pendingRequest.resolve(result); // 调用原始 Promise 的 resolve
        } else if (!pendingRequest) {
            console.warn(`[DebugSessionManager] Attempted to resolve already cleaned up or non-existent request: ${requestId}`);
        } else { // pendingRequest.isResolved === true
            console.warn(`[DebugSessionManager] Attempted to resolve already resolved request: ${requestId}`);
        }
    }

     // 修改 findPendingRequestBySessionId 以支持查找两种请求
    private findPendingRequestBySessionId(sessionId: string, includeContinue: boolean = false): [string, PendingRequest] | undefined {
        // 优先查找 start 请求
        for (const entry of this.pendingStartRequests.entries()) {
            if (entry[1].sessionId === sessionId && !entry[1].isResolved) {
                return entry;
            }
        }
        // 如果允许，再查找 continue 请求
        if (includeContinue) {
             for (const entry of this.pendingContinueRequests.entries()) {
                if (entry[1].sessionId === sessionId && !entry[1].isResolved) {
                    return entry;
                }
            }
        }
        return undefined;
    }

    // 新增：专门查找 continue 请求的辅助函数
    private findPendingContinueRequestBySessionId(sessionId: string): [string, PendingRequest] | undefined {
         for (const entry of this.pendingContinueRequests.entries()) {
            if (entry[1].sessionId === sessionId && !entry[1].isResolved) {
                return entry;
            }
        }
        return undefined;
    }

    // 可能需要添加停止调试的方法 (从规划示例添加)
    public stopDebugging(sessionId?: string): void {
        let sessionToStop: vscode.DebugSession | undefined;
        if (sessionId) {
            sessionToStop = vscode.debug.activeDebugSession?.id === sessionId ? vscode.debug.activeDebugSession : undefined;
            if (!sessionToStop) {
                 console.warn(`[DebugSessionManager] Session ${sessionId} not found or not active.`);
            }
        } else {
            sessionToStop = vscode.debug.activeDebugSession;
        }

        if (sessionToStop) {
            console.log(`[DebugSessionManager] Requesting stop for debug session: ${sessionToStop.id}`);
            vscode.debug.stopDebugging(sessionToStop);
        } else {
            console.log("[DebugSessionManager] No active debug session to stop.");
        }
    }
}