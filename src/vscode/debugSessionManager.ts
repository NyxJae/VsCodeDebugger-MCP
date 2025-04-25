// src/vscode/debugSessionManager.ts
import * as vscode from 'vscode';
import { DebugStateProvider } from './debugStateProvider'; // 引入依赖
import { ContinueDebuggingParams, StartDebuggingResponsePayload, StopEventData, VariableInfo, StepExecutionParams, StepExecutionResult } from '../types'; // 确认路径和类型
import { IPC_STATUS_SUCCESS, IPC_STATUS_ERROR, IPC_STATUS_STOPPED, IPC_STATUS_COMPLETED, IPC_STATUS_TIMEOUT, IPC_STATUS_INTERRUPTED } from '../constants'; // 导入所有需要的常量

// PendingRequest 接口定义 (用于 start 和 continue)
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
    private pendingContinueRequests = new Map<string, PendingRequest>(); // key 是 requestId
    // 新增 Map 管理 step 请求
    private pendingStepRequests = new Map<string, {
        resolve: (result: StepExecutionResult) => void;
        reject: (reason?: any) => void;
        timer: NodeJS.Timeout;
        threadId: number; // 记录请求对应的 threadId
        stepType: 'over' | 'into' | 'out'; // 记录请求的 stepType
        sessionId: string; // 关联 sessionId
        isResolved: boolean; // 标记是否已解决
    }>();
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

    // --- 实现 stepExecutionAndWait 方法 ---
    public async stepExecutionAndWait(sessionId: string, threadId: number, stepType: 'over' | 'into' | 'out', timeoutMs: number = 30000): Promise<StepExecutionResult> {
        const requestId = `step-${this.requestCounter++}`;
        console.log(`[DebugSessionManager] Starting step request: ${requestId} for session ${sessionId}, thread ${threadId}, type ${stepType}`);

        return new Promise<StepExecutionResult>(async (resolve, reject) => {
            const session = vscode.debug.activeDebugSession?.id === sessionId ? vscode.debug.activeDebugSession : undefined;

            if (!session) {
                reject({ status: 'error', message: `未找到匹配的活动调试会话 ID: ${sessionId}` });
                return;
            }

            // 检查会话状态，理论上应该处于 stopped 状态才能单步执行
            // 注意：这里没有直接获取状态的方法，依赖于调用者确保状态正确
            // if (this.getSessionState(session.id) !== 'stopped') { ... }

            let dapCommand: string;
            switch (stepType) {
                case 'over': dapCommand = 'next'; break;
                case 'into': dapCommand = 'stepIn'; break;
                case 'out': dapCommand = 'stepOut'; break;
                default:
                    reject({ status: 'error', message: `无效的 step_type: ${stepType}` });
                    return;
            }

            const timer = setTimeout(() => {
                console.log(`[DebugSessionManager] Step request ${requestId} timed out.`);
                this.resolveStepRequest(requestId, { status: 'timeout', message: `等待调试器在单步执行后停止超时 (${timeoutMs}ms)。` });
            }, timeoutMs);

            this.pendingStepRequests.set(requestId, { resolve, reject, timer, threadId, stepType, sessionId, isResolved: false });

            try {
                console.log(`[DebugSessionManager] Sending '${dapCommand}' DAP request for session ${sessionId}, thread ${threadId}. Request ID: ${requestId}`);
                await session.customRequest(dapCommand, { threadId });
                console.log(`[DebugSessionManager] '${dapCommand}' DAP request sent for ${requestId}. Waiting for events...`);
                // 等待 DebugAdapterTracker 的 onDidSendMessage 处理 stopped 或 onDidTerminateDebugSession 处理 terminated
            } catch (error: any) {
                console.error(`[DebugSessionManager] Error sending '${dapCommand}' DAP request for ${requestId}:`, error);
                this.resolveStepRequest(requestId, { status: 'error', message: `发送 ${dapCommand} 命令失败: ${error.message || error}` });
            }
        });
    }

    // --- 修改事件处理逻辑以支持 continue 和 step 请求 ---

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
                        // 查找与此会话关联的、尚未解决的 *任何* 请求 (start, continue, 或 step)
                        // 优先级：step > continue > start (因为 step/continue 依赖于已启动的会话)
                        const currentRequestEntry = this.findPendingRequestBySessionId(session.id, true, true); // 查找 start, continue, step

                        if (!currentRequestEntry) {
                            // console.log(`[DebugSessionManager] No pending request found for session ${session.id} on message.`);
                            return;
                        }
                        const [currentRequestId, currentRequest] = currentRequestEntry;
                        // 检查 isResolved 属性，它存在于所有三种请求类型中
                        if (currentRequest.isResolved) {
                            // console.log(`[DebugSessionManager] Request ${currentRequestId} already resolved.`);
                            return;
                        }

                        // 处理停止事件 (对 start, continue, step 都有效)
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
                                } else if (currentRequestId.startsWith('step-')) {
                                    // 检查 threadId 是否匹配 (仅对 step 请求)
                                    const stepRequest = this.pendingStepRequests.get(currentRequestId);
                                    if (stepRequest && stepRequest.threadId === message.body.threadId) {
                                        this.resolveStepRequest(currentRequestId, { status: 'stopped', stop_event_data: stopEventData });
                                    } else if (stepRequest) {
                                        console.warn(`[DebugSessionManager] Stopped event threadId (${message.body.threadId}) does not match pending step request threadId (${stepRequest.threadId}) for ${currentRequestId}. Ignoring.`);
                                        // 不解析此 step 请求，等待正确的线程停止或超时
                                    }
                                }
                            } catch (error: any) {
                                console.error(`[DebugSessionManager] Error building stop event data for ${currentRequestId}:`, error);
                                const errorResult: StartDebuggingResponsePayload | StepExecutionResult = { status: 'error', message: `构建停止事件数据时出错: ${error.message}` };
                                 if (currentRequestId.startsWith('start-')) {
                                    this.resolveRequest(currentRequestId, errorResult as StartDebuggingResponsePayload);
                                } else if (currentRequestId.startsWith('continue-')) {
                                    this.resolveContinueRequest(currentRequestId, errorResult as StartDebuggingResponsePayload);
                                } else if (currentRequestId.startsWith('step-')) {
                                    this.resolveStepRequest(currentRequestId, errorResult as StepExecutionResult);
                                }
                            }
                        }
                    },
                    onError: (error: Error) => { // 对 start, continue, step 都有效
                        const currentRequestEntry = this.findPendingRequestBySessionId(session.id, true, true);
                        if (!currentRequestEntry) { return; }
                        const [currentRequestId, currentRequest] = currentRequestEntry;
                        if (currentRequest.isResolved) { return; }
                        console.error(`[DebugSessionManager] Debug adapter error for session ${session.id}, request ${currentRequestId}:`, error);
                        const errorResult: StartDebuggingResponsePayload | StepExecutionResult = { status: 'error', message: `调试适配器错误: ${error.message}` };
                        if (currentRequestId.startsWith('start-')) {
                            this.resolveRequest(currentRequestId, errorResult as StartDebuggingResponsePayload);
                        } else if (currentRequestId.startsWith('continue-')) {
                            this.resolveContinueRequest(currentRequestId, errorResult as StartDebuggingResponsePayload);
                        } else if (currentRequestId.startsWith('step-')) {
                            this.resolveStepRequest(currentRequestId, errorResult as StepExecutionResult);
                        }
                    },
                    onExit: (code: number | undefined, signal: string | undefined) => { // 对 start, continue, step 都有效
                        const currentRequestEntry = this.findPendingRequestBySessionId(session.id, true, true);
                        if (!currentRequestEntry) { return; }
                        const [currentRequestId, currentRequest] = currentRequestEntry;
                        if (currentRequest.isResolved) { return; }
                        console.log(`[DebugSessionManager] Debug adapter exit for session ${session.id}, request ${currentRequestId}: code=${code}, signal=${signal}`);
                        // 仅在请求未被其他方式解决时，才因 Adapter 退出而标记为错误
                        const errorResult: StartDebuggingResponsePayload | StepExecutionResult = { status: 'error', message: `调试适配器意外退出 (code: ${code}, signal: ${signal})` };
                         if (currentRequestId.startsWith('start-') && this.pendingStartRequests.has(currentRequestId)) {
                            this.resolveRequest(currentRequestId, errorResult as StartDebuggingResponsePayload);
                        } else if (currentRequestId.startsWith('continue-') && this.pendingContinueRequests.has(currentRequestId)) {
                            this.resolveContinueRequest(currentRequestId, errorResult as StartDebuggingResponsePayload);
                        } else if (currentRequestId.startsWith('step-') && this.pendingStepRequests.has(currentRequestId)) {
                            this.resolveStepRequest(currentRequestId, errorResult as StepExecutionResult);
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

            // --- 处理 ${file} 变量 ---
            if (typeof targetConfig.program === 'string' && targetConfig.program.includes('${file}')) {
                const activeEditor = vscode.window.activeTextEditor;
                if (activeEditor) {
                    const currentFilePath = activeEditor.document.uri.fsPath;
                    console.log(`[DebugSessionManager] Resolving \${file} in '${configurationName}' to: ${currentFilePath}`);
                    // 确保替换时路径分隔符正确 (VS Code API 返回的 fsPath 通常是平台相关的正确路径)
                    targetConfig.program = targetConfig.program.replace('${file}', currentFilePath);
                } else {
                    // 没有活动编辑器，无法解析 ${file}
                    console.error(`[DebugSessionManager] Cannot resolve \${file} for config '${configurationName}': No active text editor.`);
                    // 直接返回错误，不调用 startDebugging
                    // 注意：这里的 resolveRequest 是 DebugSessionManager 内部方法，用于结束 Promise
                    this.resolveRequest(requestId, {
                        status: IPC_STATUS_ERROR, // 使用常量
                        message: `无法启动调试配置 '${configurationName}'：需要激活一个编辑器以解析 \${file} 变量。`
                    });
                    return; // 提前返回，不继续执行 startDebugging
                }
            }
            // --- ${file} 处理结束 ---

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

        // 检查是否有等待此会话的 start, continue 或 step 请求
        const terminatedRequestEntry = this.findPendingRequestBySessionId(session.id, true, true); // 查找所有类型
        if (terminatedRequestEntry) {
            const [terminatedRequestId, terminatedRequest] = terminatedRequestEntry;
            if (!terminatedRequest.isResolved) {
               console.log(`[DebugSessionManager] Resolving request ${terminatedRequestId} as completed due to session termination.`);
               const completedResult: StartDebuggingResponsePayload | StepExecutionResult = { status: 'completed', message: '调试会话已结束。' };
               if (terminatedRequestId.startsWith('start-')) {
                   this.resolveRequest(terminatedRequestId, completedResult as StartDebuggingResponsePayload);
               } else if (terminatedRequestId.startsWith('continue-')) {
                   this.resolveContinueRequest(terminatedRequestId, completedResult as StartDebuggingResponsePayload);
               } else if (terminatedRequestId.startsWith('step-')) {
                   this.resolveStepRequest(terminatedRequestId, completedResult as StepExecutionResult);
               }
            }
        }
    }

    // --- 新增/修改辅助函数 ---

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

    // 新增：封装的 resolve 函数，用于 step 请求
    private resolveStepRequest(requestId: string, result: StepExecutionResult): void {
        const pendingRequest = this.pendingStepRequests.get(requestId);
        if (pendingRequest && !pendingRequest.isResolved) {
            pendingRequest.isResolved = true;
            clearTimeout(pendingRequest.timer);
            this.pendingStepRequests.delete(requestId);
            console.log(`[DebugSessionManager] Resolving step request ${requestId} with status: ${result.status}`);
            // 根据状态决定调用 resolve 还是 reject
            if (result.status === 'stopped' || result.status === 'completed') {
                pendingRequest.resolve(result);
            } else {
                // 对于 timeout, interrupted, error 状态，调用 reject
                pendingRequest.reject(result);
            }
        } else if (!pendingRequest) {
            console.warn(`[DebugSessionManager] Attempted to resolve already cleaned up or non-existent step request: ${requestId}`);
        } else {
            console.warn(`[DebugSessionManager] Attempted to resolve already resolved step request: ${requestId}`);
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

     // 修改 findPendingRequestBySessionId 以支持查找所有类型请求
     // 返回类型需要更通用，因为 step 请求的 value 类型不同
    private findPendingRequestBySessionId(
        sessionId: string,
        includeContinue: boolean = false,
        includeStep: boolean = false
    ): [string, PendingRequest | { sessionId: string; isResolved: boolean }] | undefined {
        // 优先级: step > continue > start
        if (includeStep) {
            for (const entry of this.pendingStepRequests.entries()) {
                if (entry[1].sessionId === sessionId && !entry[1].isResolved) {
                    // 返回兼容的结构，即使类型不同
                    return entry as [string, { sessionId: string; isResolved: boolean }];
                }
            }
        }
        if (includeContinue) {
             for (const entry of this.pendingContinueRequests.entries()) {
                if (entry[1].sessionId === sessionId && !entry[1].isResolved) {
                    return entry;
                }
            }
        }
        // 最后查找 start 请求
        for (const entry of this.pendingStartRequests.entries()) {
            if (entry[1].sessionId === sessionId && !entry[1].isResolved) {
                return entry;
            }
        }
        return undefined;
    }

    // 新增：专门查找 continue 请求的辅助函数 (保持不变)
    private findPendingContinueRequestBySessionId(sessionId: string): [string, PendingRequest] | undefined {
         for (const entry of this.pendingContinueRequests.entries()) {
            if (entry[1].sessionId === sessionId && !entry[1].isResolved) {
                return entry;
            }
        }
        return undefined;
    }

    // 新增：专门查找 step 请求的辅助函数
    private findPendingStepRequestBySessionId(sessionId: string): [string, typeof this.pendingStepRequests extends Map<string, infer V> ? V : never] | undefined {
        for (const entry of this.pendingStepRequests.entries()) {
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