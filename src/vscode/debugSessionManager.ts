// src/vscode/debugSessionManager.ts
import * as vscode from 'vscode';
import { DebugStateProvider } from './debugStateProvider'; // 引入依赖
import { StartDebuggingResponsePayload, StopEventData } from '../types'; // 确认路径
import { IPC_STATUS_SUCCESS, IPC_STATUS_ERROR, IPC_STATUS_STOPPED, IPC_STATUS_COMPLETED, IPC_STATUS_TIMEOUT, IPC_STATUS_INTERRUPTED } from '../constants'; // 导入所有需要的常量
import { VariableInfo } from '../types'; // 引入 VariableInfo

// PendingRequest 接口定义 (从 debuggerApiWrapper.ts 迁移)
// 考虑后续移到 types.ts
interface PendingRequest {
    configurationName: string; // 用于启动时匹配
    resolve: (value: StartDebuggingResponsePayload) => void;
    // reject 不再直接使用，通过 resolve 返回 error status
    timeoutTimer: NodeJS.Timeout;
    listeners: vscode.Disposable[]; // 用于管理 session 生命周期监听器
    trackerDisposable?: vscode.Disposable; // 用于管理 tracker factory
    sessionId?: string; // 在 onDidStartDebugSession 中设置
    isResolved: boolean; // 标记是否已被解决，防止重复处理
}


export class DebugSessionManager {
    private pendingStartRequests = new Map<string, PendingRequest>(); // key 是 requestId (从 debuggerApiWrapper.ts 迁移)
    private sessionListeners = new Map<string, vscode.Disposable[]>(); // key 是 sessionId (用于管理每个会话的监听器)
    private requestCounter = 0; // 用于生成唯一的请求 ID (替代 nextRequestId)
    // private debugAdapters = new Map<string, vscode.DebugAdapterTracker>(); // 暂时不用，Tracker 在 Factory 中创建

    constructor(private debugStateProvider: DebugStateProvider) { // 注入 DebugStateProvider
        this.initializeDebugListeners(); // 启用监听器
        console.log("DebugSessionManager initialized.");
    }

    private initializeDebugListeners(): void {
        // 监听调试会话启动
        vscode.debug.onDidStartDebugSession(session => {
            this.handleDebugSessionStarted(session);
        });

        // 监听调试会话终止
        vscode.debug.onDidTerminateDebugSession(session => {
            this.handleDebugSessionTerminated(session);
        });

        // 注册 Debug Adapter Tracker Factory (用于拦截 stopped 事件等)
        // 注意：此 Factory 会为 *所有* 调试会话创建 Tracker
        vscode.debug.registerDebugAdapterTrackerFactory('*', {
            createDebugAdapterTracker: (session: vscode.DebugSession) => {
                console.log(`[DebugSessionManager] createDebugAdapterTracker called for session ${session.id} (name: ${session.name}, type: ${session.type}).`);

                return {
                    onDidSendMessage: async (message) => {
                        // 查找与此会话关联的、尚未解决的请求
                        const currentRequestEntry = this.findPendingRequestBySessionId(session.id);

                        if (!currentRequestEntry) {
                            // console.warn(`[DebugSessionManager] onDidSendMessage: No active pending request found for session ${session.id}. Ignoring message.`);
                            return;
                        }
                        const [currentRequestId, currentRequest] = currentRequestEntry;

                        if (currentRequest.isResolved) {
                            // console.warn(`[DebugSessionManager] Request ${currentRequestId} already resolved, ignoring 'onDidSendMessage' event.`);
                            return;
                        }

                        // 核心：处理停止事件
                        if (message.type === 'event' && message.event === 'stopped') {
                            console.log(`[DebugSessionManager] Tracker for request ${currentRequestId} received 'stopped' event.`);
                            try {
                                console.log(`[DebugSessionManager] Building stop event data for request ${currentRequestId}...`);
                                // 使用注入的 DebugStateProvider 构建数据
                                const stopEventData = await this.debugStateProvider.buildStopEventData(session, message.body); // TODO: buildStopEventData 待迁移到 DebugStateProvider
                                console.log(`[DebugSessionManager] Stop event data built for ${currentRequestId}. Resolving promise.`);
                                // 使用封装的 resolve 函数
                                this.resolveRequest(currentRequestId, { status: IPC_STATUS_STOPPED, data: stopEventData }); // 使用常量 IPC_STATUS_STOPPED
                            } catch (error: any) {
                                console.error(`[DebugSessionManager] Error building stop event data for ${currentRequestId}:`, error);
                                this.resolveRequest(currentRequestId, { status: IPC_STATUS_ERROR, message: `构建停止事件数据时出错: ${error.message}` });
                            }
                        }
                    },
                    onError: (error) => {
                        const currentRequestEntry = this.findPendingRequestBySessionId(session.id);
                        if (!currentRequestEntry) { return; }
                        const [currentRequestId, currentRequest] = currentRequestEntry;

                        console.error(`[DebugSessionManager] Debug adapter error for session ${session.id}, request ${currentRequestId}:`, error);
                        if (currentRequest.isResolved) { return; }
                        this.resolveRequest(currentRequestId, { status: IPC_STATUS_ERROR, message: `调试适配器错误: ${error.message}` });
                    },
                    onExit: (code, signal) => {
                        const currentRequestEntry = this.findPendingRequestBySessionId(session.id);
                        if (!currentRequestEntry) { return; }
                        const [currentRequestId, currentRequest] = currentRequestEntry;

                        console.log(`[DebugSessionManager] Debug adapter exit for session ${session.id}, request ${currentRequestId}: code=${code}, signal=${signal}`);
                        if (currentRequest.isResolved) { return; }
                        // 仅在请求未被其他方式解决时，才因 Adapter 退出而标记为错误
                        if (this.pendingStartRequests.has(currentRequestId)) {
                           console.log(`[DebugSessionManager] Resolving request ${currentRequestId} as error due to adapter exit.`);
                           this.resolveRequest(currentRequestId, { status: IPC_STATUS_ERROR, message: `调试适配器意外退出 (code: ${code}, signal: ${signal})` }); // 使用已定义的 IPC_STATUS_ERROR
                        }
                    }
                }; // 结束返回 Tracker 实例
            } // 结束 createDebugAdapterTracker
        }); // 结束 registerDebugAdapterTrackerFactory
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
                // 直接 resolve Promise 而不是返回
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

            const listeners: vscode.Disposable[] = []; // 用于会话特定监听器（如果需要的话）

            const timeout = 60000; // 超时时间
            const timeoutTimer = setTimeout(() => {
                console.log(`[DebugSessionManager] Request ${requestId} timed out.`);
                this.resolveRequest(requestId, { status: IPC_STATUS_TIMEOUT, message: `等待调试器首次停止或结束超时 (${timeout}ms)。` }); // 使用常量 IPC_STATUS_TIMEOUT
            }, timeout);

            const pendingRequest: PendingRequest = {
                configurationName,
                resolve: resolve, // 直接使用 Promise 的 resolve
                timeoutTimer,
                listeners, // 初始化为空，由 handleDebugSessionStarted 管理
                // trackerDisposable 不再存储在请求中，它是全局注册的
                isResolved: false,
            };
            this.pendingStartRequests.set(requestId, pendingRequest);

            // 注意：Tracker Factory 已在 initializeDebugListeners 中全局注册，此处无需重复注册

            // 注意：Session 生命周期监听器也已在 initializeDebugListeners 中全局注册

            // 启动调试
            try {
              console.log(`[DebugSessionManager] Calling vscode.debug.startDebugging for ${configurationName}`);
              const success = await vscode.debug.startDebugging(folder, targetConfig);
              if (!success) {
                console.error(`[DebugSessionManager] vscode.debug.startDebugging returned false for ${configurationName}. Request ID: ${requestId}`);
                this.resolveRequest(requestId, { status: IPC_STATUS_ERROR, message: 'VS Code 报告无法启动调试会话（startDebugging 返回 false）。' });
              } else {
                console.log(`[DebugSessionManager] vscode.debug.startDebugging call succeeded for ${configurationName}. Request ID: ${requestId}. Waiting for events...`);
                // 等待 onDidStartDebugSession 关联 sessionId，然后等待 Tracker 的 stopped 事件或 onDidTerminateDebugSession
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

            // 此处可以为特定会话添加额外的监听器（如果需要的话），并存入 this.sessionListeners
            // const sessionSpecificListeners: vscode.Disposable[] = [];
            // sessionSpecificListeners.push(vscode.debug.onDidReceiveDebugSessionCustomEvent(async event => {
            //     if (event.session.id === session.id) {
            //         // 处理特定于此会话的自定义事件
            //     }
            // }));
            // this.sessionListeners.set(session.id, sessionSpecificListeners);

        } else {
            console.warn(`[DebugSessionManager] No matching pending request found for started session ${session.id} with config name "${session.configuration.name}". This session might not be tracked by a startDebuggingAndWait call.`);
        }
    }

    private handleDebugSessionTerminated(session: vscode.DebugSession): void {
        console.log(`[DebugSessionManager] Debug session terminated: ${session.id} (${session.name})`);

        // 清理与此会话相关的特定监听器（如果创建了的话）
        const listeners = this.sessionListeners.get(session.id);
        if (listeners) {
            listeners.forEach(d => d.dispose());
            this.sessionListeners.delete(session.id);
            console.log(`[DebugSessionManager] Disposed specific listeners for terminated session ${session.id}.`);
        }

        // 检查是否有等待此会话的请求，并将其标记为 "completed"
        const terminatedRequestEntry = this.findPendingRequestBySessionId(session.id);
        if (terminatedRequestEntry) {
            const [terminatedRequestId, terminatedRequest] = terminatedRequestEntry;
            console.log(`[DebugSessionManager] Found matching request ${terminatedRequestId} for terminated session ${session.id}.`);
            // 仅当请求未被 stopped 或 error 解决时，才标记为 completed
            if (!terminatedRequest.isResolved) {
               console.log(`[DebugSessionManager] Resolving request ${terminatedRequestId} as completed due to session termination.`);
               this.resolveRequest(terminatedRequestId, { status: IPC_STATUS_COMPLETED, message: '调试会话已结束。' }); // 使用常量 IPC_STATUS_COMPLETED
            }
        } else {
            // console.warn(`[DebugSessionManager] No pending request found for terminated session ${session.id}.`);
        }
    }

    // --- 辅助函数 ---

    // 封装的 resolve 函数，确保清理
    private resolveRequest(requestId: string, result: StartDebuggingResponsePayload): void {
        const pendingRequest = this.pendingStartRequests.get(requestId);
        if (pendingRequest && !pendingRequest.isResolved) {
            pendingRequest.isResolved = true; // 标记为已解决
            clearTimeout(pendingRequest.timeoutTimer);
            // 清理 sessionListeners (如果为该请求创建了特定监听器)
            // const specificListeners = this.sessionListeners.get(pendingRequest.sessionId || '');
            // if (specificListeners) {
            //     specificListeners.forEach(d => d.dispose());
            //     this.sessionListeners.delete(pendingRequest.sessionId || '');
            // }
            // trackerDisposable 是全局的，不在这里清理
            this.pendingStartRequests.delete(requestId);
            console.log(`[DebugSessionManager] Resolving request ${requestId} with status: ${result.status}`);
            pendingRequest.resolve(result); // 调用原始 Promise 的 resolve
        } else if (!pendingRequest) {
            console.warn(`[DebugSessionManager] Attempted to resolve already cleaned up or non-existent request: ${requestId}`);
        } else { // pendingRequest.isResolved === true
            console.warn(`[DebugSessionManager] Attempted to resolve already resolved request: ${requestId}`);
        }
    }

    // 通过 sessionId 查找挂起的请求
    private findPendingRequestBySessionId(sessionId: string): [string, PendingRequest] | undefined {
        for (const entry of this.pendingStartRequests.entries()) {
            if (entry[1].sessionId === sessionId && !entry[1].isResolved) { // 确保请求未解决
                return entry;
            }
        }
        return undefined;
    }

    // 可能需要添加停止调试的方法 (从规划示例添加)
    public stopDebugging(sessionId?: string): void {
        let sessionToStop: vscode.DebugSession | undefined;
        if (sessionId) {
            // 查找具有给定 ID 的活动会话
            sessionToStop = vscode.debug.activeDebugSession?.id === sessionId ? vscode.debug.activeDebugSession : undefined;
            // 如果活动会话不是目标，可以遍历所有会话（如果 API 支持）
            // 但 vscode.debug.activeDebugSession 通常足够
            if (!sessionToStop) {
                 console.warn(`[DebugSessionManager] Session ${sessionId} not found or not active.`);
                 // 尝试查找非活动会话？API 可能不支持直接停止非活动会话
            }
        } else {
            // 停止当前活动的会话
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