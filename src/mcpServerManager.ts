import * as vscode from 'vscode';
import { StatusBarManager, McpServerStatus } from './statusBarManager';
import { getStoredPort, storePort } from './configManager';
import { isPortInUse, isValidPort } from './utils/portUtils';
import { ProcessManager, ProcessStatus } from './managers/processManager';
import { IpcHandler } from './managers/ipcHandler';
import { DebuggerApiWrapper } from './vscode/debuggerApiWrapper';
import { PluginRequest, PluginResponse, ContinueDebuggingParams, StepExecutionParams, StepExecutionResult } from './types'; // 从共享文件导入, 导入新类型
import * as Constants from './constants'; // 修正导入路径

/**
 * 协调 MCP 服务器的启动、停止、状态管理和与 VS Code 的交互。
 * 作为各个管理器的中心协调者。
 */
export class McpServerManager implements vscode.Disposable {
    private readonly outputChannel: vscode.OutputChannel;
    private disposables: vscode.Disposable[] = [];

    /**
     * 创建一个新的 McpServerManager 实例。
     * @param context VS Code 扩展上下文。
     * @param statusBarManager 状态栏管理器实例。
     * @param processManager 进程管理器实例。
     * @param ipcHandler IPC 处理器实例。
     * @param debuggerApiWrapper VS Code Debug API 包装器实例。
     */
    constructor(
        private context: vscode.ExtensionContext,
        private statusBarManager: StatusBarManager,
        private processManager: ProcessManager,
        private ipcHandler: IpcHandler,
        private debuggerApiWrapper: DebuggerApiWrapper
    ) {
        this.outputChannel = vscode.window.createOutputChannel(Constants.OUTPUT_CHANNEL_COORDINATOR);
        this.disposables.push(this.outputChannel);

        // 将 DebuggerApiWrapper 注入 IpcHandler
        this.ipcHandler.setDebuggerApiWrapper(this.debuggerApiWrapper);

        // 连接 ProcessManager 事件到 StatusBarManager 和 IpcHandler
        this.processManager.on('statusChange', (status: ProcessStatus, port: number | null) => {
            // 将 ProcessStatus 映射到 McpServerStatus
            let mcpStatus: McpServerStatus;
            switch (status) { // 使用字符串字面量进行比较
                case 'running':
                    mcpStatus = 'running';
                    break;
                case 'starting':
                    mcpStatus = 'starting';
                    break;
                case 'error':
                    mcpStatus = 'error';
                    break;
                case 'stopped':
                default:
                    mcpStatus = 'stopped';
                    break;
            }
            this.statusBarManager.setStatus(mcpStatus, port);
        });
        this.processManager.on('message', (message: any) => {
            // 将从子进程收到的消息传递给 IpcHandler 处理
            // 注意：IpcHandler 内部会处理消息并调用 DebuggerApiWrapper (如果需要)
            // IpcHandler 内部也负责发送响应回子进程
            // McpServerManager 在这里不需要直接处理 IPC 消息内容
            this.outputChannel.appendLine(`[Coordinator] Forwarding message from process to IpcHandler: ${JSON.stringify(message)}`);
            // !! 将消息实际传递给 IpcHandler !!
            // this.ipcHandler.handleIncomingMessage(message); // 旧逻辑，改为直接处理请求
            if (message && message.type === Constants.IPC_MESSAGE_TYPE_REQUEST) {
                this.handleRequestFromMCP(message as PluginRequest)
                    .then(response => {
                        this.processManager.send(response); // 发送响应回服务器
                    })
                    .catch(error => {
                        // 理论上 handleRequestFromMCP 内部会捕获错误并返回 error response
                        // 但以防万一，这里也记录一下
                        this.outputChannel.appendLine(`[Coordinator] Error processing MCP request after promise: ${error}`);
                        // 可以考虑发送一个通用的错误响应
                        if (message.requestId) {
                            this.processManager.send({
                                type: Constants.IPC_MESSAGE_TYPE_RESPONSE,
                                requestId: message.requestId,
                                status: Constants.IPC_STATUS_ERROR,
                                error: { message: `处理请求时发生意外错误: ${error.message}` }
                            });
                        }
                    });
            } else {
                this.outputChannel.appendLine(`[Coordinator] Received non-request message from process: ${JSON.stringify(message)}`);
                // 可以选择忽略或记录其他类型的消息
            }
        });

        this.processManager.on('error', (err: Error) => {
            this.outputChannel.appendLine(`[Coordinator] Received error event from ProcessManager: ${err.message}`);
            vscode.window.showErrorMessage(`MCP 服务器进程错误: ${err.message}`);
            // StatusBarManager 的状态已由 ProcessManager 的 statusChange 事件更新为 'error'
        });

        this.processManager.on('close', (code: number | null, signal: NodeJS.Signals | null, unexpected: boolean) => {
            this.outputChannel.appendLine(`[Coordinator] Received close event from ProcessManager. Code: ${code}, Signal: ${signal}, Unexpected: ${unexpected}`);
            // 如果是意外关闭，显示错误信息
            if (unexpected) {
                vscode.window.showErrorMessage(`MCP 服务器进程意外退出 (Code: ${code}, Signal: ${signal})`);
            }
            // IpcHandler 不再直接持有进程引用，无需清理
            // StatusBarManager 的状态已由 ProcessManager 的 statusChange 事件更新
        });
        // 监听 IpcHandler 发出的需要 Debug API 的请求事件 (如果采用事件驱动方式)
        // this.ipcHandler.on('debugApiRequest', async (command, payload, requestId) => {
        //     try {
        //         let result;
        //         if (command === 'setBreakpoint') {
        //             result = await this.debuggerApiWrapper.addBreakpoint(payload);
        //         } else if (command === 'getBreakpoints') {
        //             const breakpoints = this.debuggerApiWrapper.getBreakpoints();
        //             result = { timestamp: new Date().toISOString(), breakpoints: breakpoints };
        //         } else {
        //             throw new Error(`Unsupported debug command: ${command}`);
        //         }
        //         this.ipcHandler.sendResponseToServer(requestId, 'success', result);
        //     } catch (error: any) {
        //         this.ipcHandler.sendResponseToServer(requestId, 'error', undefined, { message: error.message });
        //     }
        // });

        this.disposables.push(
            this.processManager,
            this.ipcHandler,
            // DebuggerApiWrapper 通常不需要 dispose
            this.statusBarManager // StatusBarManager 实现了 Disposable
        );
    }

    // --- 新增：处理来自 MCP Server 的请求 ---
    private async handleRequestFromMCP(request: PluginRequest): Promise<PluginResponse> {
        const { command, requestId, payload } = request;
        let responsePayload: any = null;
        let status: typeof Constants.IPC_STATUS_SUCCESS | typeof Constants.IPC_STATUS_ERROR = Constants.IPC_STATUS_SUCCESS;
        let errorMessage: string | undefined = undefined;

        this.outputChannel.appendLine(`[Coordinator] Handling MCP request: ${requestId} - Command: ${command}`);

        try {
            switch (command) {
                case Constants.IPC_COMMAND_GET_CONFIGURATIONS:
                    responsePayload = { configurations: this.debuggerApiWrapper.getDebuggerConfigurations() };
                    break;
                case Constants.IPC_COMMAND_SET_BREAKPOINT:
                    responsePayload = await this.debuggerApiWrapper.addBreakpoint(payload);
                    break;
                case Constants.IPC_COMMAND_GET_BREAKPOINTS:
                    responsePayload = { breakpoints: this.debuggerApiWrapper.getBreakpoints(), timestamp: new Date().toISOString() };
                    break;
                case Constants.IPC_COMMAND_REMOVE_BREAKPOINT:
                    responsePayload = await this.debuggerApiWrapper.removeBreakpoint(payload);
                    break;
                case Constants.IPC_COMMAND_START_DEBUGGING_REQUEST: // 注意常量名称
                    responsePayload = await this.debuggerApiWrapper.startDebuggingAndWait(payload.configurationName, payload.noDebug ?? false);
                    break;
                case Constants.IPC_COMMAND_CONTINUE_DEBUGGING: { // 使用块作用域
                    this.outputChannel.appendLine(`[Coordinator] Handling 'continue_debugging' request: ${requestId}`);
                    const continueParams = payload as ContinueDebuggingParams;
                    let sessionIdToUse = continueParams.sessionId;

                    if (!sessionIdToUse) {
                        const activeSession = vscode.debug.activeDebugSession;
                        if (activeSession) {
                            sessionIdToUse = activeSession.id;
                            this.outputChannel.appendLine(`[Coordinator] No sessionId provided for continue, using active session: ${sessionIdToUse}`);
                        } else {
                            throw new Error('无法继续执行：未提供 session_id 且当前没有活动的调试会话。');
                        }
                    }
                    // 调用 DebuggerApiWrapper，此时 sessionIdToUse 必为 string
                    responsePayload = await this.debuggerApiWrapper.continueDebuggingAndWait(sessionIdToUse, continueParams.threadId);
                    this.outputChannel.appendLine(`[Coordinator] 'continue_debugging' result for ${requestId}: ${JSON.stringify(responsePayload)}`);
                    break;
                }
                case Constants.IPC_COMMAND_STEP_EXECUTION: { // 使用块作用域
                    this.outputChannel.appendLine(`[Coordinator] Handling '${Constants.IPC_COMMAND_STEP_EXECUTION}' request: ${requestId}`);
                    const stepParams = payload as StepExecutionParams;
                    let sessionIdToUse = stepParams.sessionId;

                    if (!sessionIdToUse) {
                        const activeSession = vscode.debug.activeDebugSession;
                        if (activeSession) {
                            sessionIdToUse = activeSession.id;
                            this.outputChannel.appendLine(`[Coordinator] No sessionId provided for step, using active session: ${sessionIdToUse}`);
                        } else {
                            throw new Error('无法执行单步操作：未提供 session_id 且当前没有活动的调试会话。');
                        }
                    }
                    // 调用 DebuggerApiWrapper 处理单步执行，此时 sessionIdToUse 必为 string
                    responsePayload = await this.debuggerApiWrapper.stepExecutionAndWait(sessionIdToUse, stepParams.thread_id, stepParams.step_type);
                    this.outputChannel.appendLine(`[Coordinator] '${Constants.IPC_COMMAND_STEP_EXECUTION}' result for ${requestId}: ${JSON.stringify(responsePayload)}`);
                }
                default:
                    throw new Error(`不支持的命令: ${command}`);
            }
        } catch (error: any) {
            console.error(`[Coordinator] Error handling MCP request ${requestId} (${command}):`, error);
            this.outputChannel.appendLine(`[Coordinator Error] Handling MCP request ${requestId} (${command}): ${error.message}\n${error.stack}`);
            status = Constants.IPC_STATUS_ERROR;
            errorMessage = error.message || '处理请求时发生未知错误';
            // 对于特定错误类型，可以设置不同的 responsePayload
            if (responsePayload && typeof responsePayload === 'object' && responsePayload.status === Constants.IPC_STATUS_ERROR) {
                // 如果 DebuggerApiWrapper 返回的就是错误状态，直接使用它的 message
                errorMessage = responsePayload.message || errorMessage;
            }
            responsePayload = undefined; // 错误时 payload 为 undefined
        }

        return {
            type: Constants.IPC_MESSAGE_TYPE_RESPONSE,
            requestId,
            status,
            payload: status === Constants.IPC_STATUS_SUCCESS ? responsePayload : undefined,
            // 确保 errorMessage 始终是 string
            error: status === Constants.IPC_STATUS_ERROR ? { message: errorMessage || '发生未知错误' } : undefined,
        };
    }
    /**
     * 检查 MCP 服务器是否正在运行。
     * @returns 如果服务器正在运行则返回 true，否则返回 false。
     */
    public isRunning(): boolean {
        // 委托给 ProcessManager
        return this.processManager.isRunning();
    }

    /**
     * 启动 MCP 服务器。
     */
    public async startServer(): Promise<void> {
        // 防止重复启动 (ProcessManager 内部会处理)
        if (this.processManager.getStatus() !== 'stopped') { // 使用字符串字面量
            const status = this.processManager.getStatus();
            const port = this.processManager.getCurrentPort();
            vscode.window.showInformationMessage(`MCP 服务器已在运行或正在启动 (状态: ${status}${port ? `, 端口: ${port}` : ''})。`);
            return;
        }

        let targetPort = getStoredPort(this.context);

        try {
            const inUse = await isPortInUse(targetPort);
            if (inUse) {
                const newPort = await this.handlePortConflict(targetPort);
                if (newPort !== null) {
                    targetPort = newPort; // 更新目标端口
                    const newPortInUse = await isPortInUse(targetPort);
                    if (newPortInUse) {
                        vscode.window.showErrorMessage(`新端口 ${targetPort} 仍然被占用。请检查或尝试其他端口。`);
                        this.statusBarManager.setStatus('error', null); // 使用字符串字面量
                        return; // 无法启动
                    }
                } else {
                    // 用户取消输入新端口
                    this.statusBarManager.setStatus('stopped', null); // 使用字符串字面量
                    return;
                }
            }

            // 获取工作区路径
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showErrorMessage('无法启动 Debug-MCP 服务器：请先打开一个工作区文件夹。');
                this.statusBarManager.setStatus('error', null); // 使用字符串字面量
                return;
            }
            const workspacePath = workspaceFolders[0].uri.fsPath;
            this.outputChannel.appendLine(`[Coordinator] Starting server with Port: ${targetPort}, Workspace: ${workspacePath}`);

            // 启动进程，ProcessManager 会处理状态更新和事件触发
            this.processManager.start(targetPort, workspacePath);

            // 将子进程实例设置给 IpcHandler (在 ProcessManager 内部启动后)
            // 需要一种方式在 ProcessManager 启动成功后获取 ChildProcess 实例
            // 方案1: ProcessManager 暴露 getProcess() 方法 (不太好，破坏封装)
            // 方案2: ProcessManager 在启动成功后发出 'processReady' 事件，携带 process 实例
            // 暂时采用方案2的思路，但 ProcessManager 当前实现没有这个事件，先假设启动后 process 实例可用
            // **修正:** ProcessManager 内部已经监听了 message 事件，不需要在这里再次设置
            // 但是 IpcHandler 需要知道 process 实例来发送消息。
            // 改进 ProcessManager，使其在启动后能提供 process 实例，或者 IpcHandler 直接依赖 ProcessManager.send()
            // **再次修正:** IpcHandler 应该依赖 ProcessManager 来发送消息，而不是直接持有 process 实例。
            // **最终决定:** IpcHandler 依赖 ProcessManager 发送消息。ProcessManager 内部持有 process。
            // McpServerManager 监听 ProcessManager 的 'message' 事件，然后调用 IpcHandler.handleMessage()。
            // IpcHandler.handleMessage() 处理消息，如果需要发送响应，调用 ProcessManager.send()。

            // **当前实现调整:** ProcessManager 已经 emit('message')，并且 IpcHandler 构造时传入了 DebuggerApiWrapper。
            // IpcHandler 内部的 registerMessageListener 需要修改为 handleMessage(message)，并且发送响应时调用 this.processManager.send()
            // **因此，这里不需要显式设置 IpcHandler 的 process**

            // **重要:** 需要修改 IpcHandler 以依赖 ProcessManager 发送消息。
            // **暂时维持现状:** 让 IpcHandler 暂时持有 process 实例，后续再优化。
            // 需要在 ProcessManager 启动后将 process 实例传递给 IpcHandler。
            // 添加一个事件监听器，等待 ProcessManager 状态变为 'running' 或 'starting' 后设置
            const onStatusChange = (status: ProcessStatus) => {
                if (status === 'running' || status === 'starting') { // 使用字符串字面量
                    // 假设 ProcessManager 有一个 getInternalProcess 方法 (需要添加)
                    // const processInstance = this.processManager.getInternalProcess();
                    // if (processInstance) {
                    //     this.ipcHandler.setProcess(processInstance);
                    //     this.outputChannel.appendLine(`[Coordinator] Set process instance in IpcHandler.`);
                    // }
                    // 移除监听器，避免重复设置
                    this.processManager.off('statusChange', onStatusChange);
                } else if (status === 'error' || status === 'stopped') { // 使用字符串字面量
                    this.processManager.off('statusChange', onStatusChange); // 如果启动失败也移除
                }
            };
            this.processManager.on('statusChange', onStatusChange);


        } catch (error: any) {
            console.error('[Coordinator] Error starting MCP server:', error);
            vscode.window.showErrorMessage(`启动 MCP 服务器时出错: ${error.message}`);
            this.statusBarManager.setStatus('error', null); // 使用字符串字面量
        }
    }

    /**
     * 停止 MCP 服务器。
     */
    public stopServer(): void {
        this.outputChannel.appendLine('[Coordinator] Stopping server...');
        // 委托给 ProcessManager
        this.processManager.stop();
        // StatusBarManager 的状态会通过 ProcessManager 的事件更新
    }

    /**
     * 重启 MCP 服务器。
     */
    public async restartServer(): Promise<void> {
        this.outputChannel.appendLine('[Coordinator] Restarting server...');
        // 委托给 ProcessManager
        await this.processManager.restart();
        // StatusBarManager 和 IpcHandler 的状态会通过 ProcessManager 的事件更新和重新设置
        // 可能需要重新设置 IpcHandler 的 process 实例，逻辑同 startServer
        const onStatusChange = (status: ProcessStatus) => {
            if (status === 'running' || status === 'starting') { // 使用字符串字面量
                // const processInstance = this.processManager.getInternalProcess(); // 假设方法存在
                // if (processInstance) {
                //     this.ipcHandler.setProcess(processInstance);
                //     this.outputChannel.appendLine(`[Coordinator] Re-set process instance in IpcHandler after restart.`);
                // }
                this.processManager.off('statusChange', onStatusChange);
            } else if (status === 'error' || status === 'stopped') { // 使用字符串字面量
                this.processManager.off('statusChange', onStatusChange);
            }
        };
        this.processManager.on('statusChange', onStatusChange);
    }

    /**
     * 生成符合 RooCode/Cline 要求的 MCP 服务器配置 JSON 字符串，并复制到剪贴板。
     */
    public async copyMcpConfigToClipboard(): Promise<void> {
        try {
            // 优先从 ProcessManager 获取当前运行端口，否则从 ConfigManager 获取存储端口
            const portToUse = this.processManager.getCurrentPort() ?? getStoredPort(this.context);

            if (!portToUse) {
                vscode.window.showWarningMessage('MCP 服务器端口未设置或服务器未运行。无法复制配置。');
                this.outputChannel.appendLine('[Coordinator] Attempted to copy config, but port is not available.');
                return;
            }

            const mcpConfig = {
                mcpServers: {
                    [Constants.MCP_CONFIG_SERVER_KEY]: {
                        url: Constants.MCP_CONFIG_URL_TEMPLATE.replace('{port}', String(portToUse)),
                        headers: {} // 保留 headers 字段
                    }
                }
            };

            const configString = JSON.stringify(mcpConfig, null, 2);
            await vscode.env.clipboard.writeText(configString);
            vscode.window.showInformationMessage(`MCP 服务器配置 (端口: ${portToUse}) 已复制到剪贴板！`);
            this.outputChannel.appendLine(`[Coordinator] MCP server configuration (Port: ${portToUse}) copied to clipboard.`);
            console.log('[Coordinator] MCP config copied:', configString);

        } catch (error: unknown) {
            const errorMsg = `无法复制 MCP 配置: ${error instanceof Error ? error.message : String(error)}`;
            console.error('[Coordinator]', errorMsg);
            this.outputChannel.appendLine(`[Coordinator Error] ${errorMsg}`);
            vscode.window.showErrorMessage(errorMsg);
        }
    }

    /**
     * 处理端口冲突的函数 (保留私有，或移至 ConfigManager/PortUtils)
     */
    private async handlePortConflict(occupiedPort: number): Promise<number | null> {
        const choice = await vscode.window.showWarningMessage(
            `MCP 服务器端口 ${occupiedPort} 已被占用。`,
            { modal: true }, // 模态对话框，阻止其他操作
            Constants.UI_TEXT_INPUT_NEW_PORT
        );

        if (choice === Constants.UI_TEXT_INPUT_NEW_PORT) {
            const newPortStr = await vscode.window.showInputBox({
                prompt: `请输入一个新的端口号 (1025-65535)，当前端口 ${occupiedPort} 被占用。`,
                placeHolder: `例如: ${Constants.DEFAULT_MCP_PORT + 1}`, // 建议一个不同的端口
                ignoreFocusOut: true, // 防止失去焦点时关闭输入框
                validateInput: (value) => {
                    if (!value) { return '端口号不能为空。'; }
                    const portNum = parseInt(value, 10);
                    if (!isValidPort(portNum)) {
                        return '请输入 1025 到 65535 之间的有效端口号。';
                    }
                    // 可以在这里添加额外的检查，例如再次检查新端口是否被占用
                    // const isNewPortInUse = await isPortInUse(portNum);
                    // if (isNewPortInUse) { return `端口 ${portNum} 也被占用了。`; }
                    return null; // 验证通过
                }
            });

            if (newPortStr) {
                const newPort = parseInt(newPortStr, 10);
                // 持久化新端口
                await storePort(this.context, newPort);
                this.outputChannel.appendLine(`[Coordinator] New port ${newPort} selected and stored.`);
                return newPort;
            }
        }
        // 用户取消或关闭了输入框
        vscode.window.showInformationMessage('MCP 服务器启动已取消。');
        this.outputChannel.appendLine('[Coordinator] Server start cancelled by user during port conflict resolution.');
        return null;
    }


    /**
     * 实现 vscode.Disposable 接口，用于在插件停用时清理资源。
     */
    dispose(): void {
        this.outputChannel.appendLine('[Coordinator] Disposing McpServerManager...');
        // 调用所有可释放对象的 dispose 方法
        vscode.Disposable.from(...this.disposables).dispose();
        // 移除所有事件监听器 (虽然 ProcessManager dispose 时会移除，但以防万一)
        this.processManager.removeAllListeners();
        // this.ipcHandler.removeAllListeners(); // 如果 IpcHandler 是 EventEmitter
    }

}
