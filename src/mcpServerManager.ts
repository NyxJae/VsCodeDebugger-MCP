import * as vscode from 'vscode';
import { StatusBarManager, McpServerStatus } from './statusBarManager';
import { getStoredPort, storePort } from './configManager';
import { isPortInUse, isValidPort } from './utils/portUtils';
import { ProcessManager, ProcessStatus } from './managers/processManager';
import { IpcHandler } from './managers/ipcHandler';
import { DebuggerApiWrapper } from './vscode/debuggerApiWrapper';
import { PluginRequest, PluginResponse, ContinueDebuggingParams, StepExecutionParams, StepExecutionResult, StopDebuggingPayload } from './types';
import * as Constants from './constants';
import { SseClientManager } from './managers/sseClientManager'; // 导入 SSE 客户端管理器

/**
 * 协调 MCP 服务器的启动、停止、状态管理和与 VS Code 的交互。
 * 作为各个管理器的中心协调者。
 */
export class McpServerManager implements vscode.Disposable {
    private readonly outputChannel: vscode.OutputChannel;
    private disposables: vscode.Disposable[] = [];
    private sseClientManager: SseClientManager; // 添加 SSE 客户端管理器实例

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

        // 实例化 SseClientManager
        this.sseClientManager = new SseClientManager(this.outputChannel);
        this.disposables.push(this.sseClientManager); // 添加到 disposables

        // 将 DebuggerApiWrapper 注入 IpcHandler
        this.ipcHandler.setDebuggerApiWrapper(this.debuggerApiWrapper);

        // 连接 ProcessManager 事件到 StatusBarManager 和 IpcHandler
        this.processManager.on('statusChange', (status: ProcessStatus, port: number | null) => {
            // 将 ProcessStatus 映射到 McpServerStatus
            let mcpStatus: McpServerStatus;
            switch (status) {
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

            // 根据状态管理 SSE 客户端连接 <--- 新增逻辑
            if (status === 'running' && port !== null) {
                this.outputChannel.appendLine(`[Coordinator] Server is running on port ${port}. Starting SSE listener.`);
                this.sseClientManager.startListening(port);
            } else if (status === 'stopped' || status === 'error') {
                this.outputChannel.appendLine(`[Coordinator] Server stopped or encountered an error. Stopping SSE listener.`);
                this.sseClientManager.stopListening();
            }
        });
        this.processManager.on('message', (message: any) => {
            this.outputChannel.appendLine(`[Coordinator] Forwarding message from process to IpcHandler: ${JSON.stringify(message)}`);
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
                                error: { message: `Unexpected error occurred while processing request: ${error.message}` }
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
            vscode.window.showErrorMessage(`MCP server process error: ${err.message}`);
            // StatusBarManager status is updated by ProcessManager's statusChange event to 'error'
            this.sseClientManager.stopListening(); // 服务器进程出错，停止 SSE 监听
        });

        this.processManager.on('close', (code: number | null, signal: NodeJS.Signals | null, unexpected: boolean) => {
            this.outputChannel.appendLine(`[Coordinator] Received close event from ProcessManager. Code: ${code}, Signal: ${signal}, Unexpected: ${unexpected}`);
            // 如果是意外关闭，显示错误信息
            if (unexpected) {
                vscode.window.showErrorMessage(`MCP server process exited unexpectedly (Code: ${code}, Signal: ${signal})`);
            }
            // IpcHandler no longer directly holds process reference, no cleanup needed
            // StatusBarManager 的状态已由 ProcessManager 的 statusChange 事件更新
            this.sseClientManager.stopListening(); // 服务器进程关闭，停止 SSE 监听
        });

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
                case Constants.IPC_COMMAND_START_DEBUGGING_REQUEST:
                    responsePayload = await this.debuggerApiWrapper.startDebuggingAndWait(payload.configurationName, payload.noDebug ?? false);
                    break;
                case Constants.IPC_COMMAND_CONTINUE_DEBUGGING: {
                    this.outputChannel.appendLine(`[Coordinator] Handling 'continue_debugging' request: ${requestId}`);
                    const continueParams = payload as ContinueDebuggingParams;
                    let sessionIdToUse = continueParams.sessionId;

                    if (!sessionIdToUse) {
                        const activeSession = vscode.debug.activeDebugSession;
                        if (activeSession) {
                            sessionIdToUse = activeSession.id;
                            this.outputChannel.appendLine(`[Coordinator] No sessionId provided for continue, using active session: ${sessionIdToUse}`);
                        } else {
                            throw new Error('Cannot continue execution: session_id not provided and no active debug session.');
                        }
                    }
                    // 调用 DebuggerApiWrapper，此时 sessionIdToUse 必为 string
                    responsePayload = await this.debuggerApiWrapper.continueDebuggingAndWait(sessionIdToUse, continueParams.threadId);
                    this.outputChannel.appendLine(`[Coordinator] 'continue_debugging' result for ${requestId}: ${JSON.stringify(responsePayload)}`);
                    break;
                }
                case Constants.IPC_COMMAND_STEP_EXECUTION: {
                    this.outputChannel.appendLine(`[Coordinator] Handling '${Constants.IPC_COMMAND_STEP_EXECUTION}' request: ${requestId}`);
                    const stepParams = payload as StepExecutionParams;
                    let sessionIdToUse = stepParams.sessionId;

                    if (!sessionIdToUse) {
                        const activeSession = vscode.debug.activeDebugSession;
                        if (activeSession) {
                            sessionIdToUse = activeSession.id;
                            this.outputChannel.appendLine(`[Coordinator] No sessionId provided for step, using active session: ${sessionIdToUse}`);
                        } else {
                            throw new Error('Cannot perform step operation: session_id not provided and no active debug session.');
                        }
                    }
                    // 调用 DebuggerApiWrapper 处理单步执行，此时 sessionIdToUse 必为 string
                    responsePayload = await this.debuggerApiWrapper.stepExecutionAndWait(sessionIdToUse, stepParams.thread_id, stepParams.step_type);
                    this.outputChannel.appendLine(`[Coordinator] '${Constants.IPC_COMMAND_STEP_EXECUTION}' result for ${requestId}: ${JSON.stringify(responsePayload)}`);
                    break;
                }
                case Constants.IPC_COMMAND_STOP_DEBUGGING: {
                    this.outputChannel.appendLine(`[Coordinator] Handling '${Constants.IPC_COMMAND_STOP_DEBUGGING}' request: ${requestId}`);
                    const stopPayload = payload as StopDebuggingPayload | undefined;
                    const sessionId = stopPayload?.sessionId;
                    // 调用 stopDebugging，传递可选的 sessionId
                    responsePayload = await this.debuggerApiWrapper.stopDebugging(sessionId);
                    this.outputChannel.appendLine(`[Coordinator] '${Constants.IPC_COMMAND_STOP_DEBUGGING}' result for ${requestId}: ${JSON.stringify(responsePayload)}`);
                    break;
                }
                default:
                    throw new Error(`Unsupported command: ${command}`);
            }
        } catch (error: any) {
            console.error(`[Coordinator] Error handling MCP request ${requestId} (${command}):`, error);
            this.outputChannel.appendLine(`[Coordinator Error] Handling MCP request ${requestId} (${command}): ${error.message}\n${error.stack}`);
            status = Constants.IPC_STATUS_ERROR;
            errorMessage = error.message || 'Unknown error occurred while processing request';
            // For specific error types, different responsePayload can be set
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
            error: status === Constants.IPC_STATUS_ERROR ? { message: errorMessage || 'Unknown error occurred' } : undefined,
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
        if (this.processManager.getStatus() !== 'stopped') {
            const status = this.processManager.getStatus();
            const port = this.processManager.getCurrentPort();
            vscode.window.showInformationMessage(`MCP server is already running or starting (Status: ${status}${port ? `, Port: ${port}` : ''}).`);
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
                        vscode.window.showErrorMessage(`New port ${targetPort} is still in use. Please check or try another port.`);
                        this.statusBarManager.setStatus('error', null); // Use string literal
                        return; // Cannot start
                    }
                } else {
                    // 用户取消输入新端口
                    this.statusBarManager.setStatus('stopped', null); // 使用字符串字面量
                    return;
                }
            }

            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showErrorMessage('Cannot start Debug-MCP server: Please open a workspace folder first.');
                this.statusBarManager.setStatus('error', null); // Use string literal
                return;
            }
            const workspacePath = workspaceFolders[0].uri.fsPath;
            this.outputChannel.appendLine(`[Coordinator] Starting server with Port: ${targetPort}, Workspace: ${workspacePath}`);

            this.processManager.start(targetPort, workspacePath);

            const onStatusChange = (status: ProcessStatus) => {
                if (status === 'running' || status === 'starting') {
                    this.processManager.off('statusChange', onStatusChange);
                } else if (status === 'error' || status === 'stopped') {
                    this.processManager.off('statusChange', onStatusChange);
                }
            };
            this.processManager.on('statusChange', onStatusChange);


        } catch (error: any) {
            console.error('[Coordinator] Error starting MCP server:', error);
            vscode.window.showErrorMessage(`Error starting MCP server: ${error.message}`);
            this.statusBarManager.setStatus('error', null); // Use string literal
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
            if (status === 'running' || status === 'starting') {
                this.processManager.off('statusChange', onStatusChange);
            } else if (status === 'error' || status === 'stopped') {
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
                vscode.window.showWarningMessage('MCP server port is not set or server is not running. Cannot copy configuration.');
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
            vscode.window.showInformationMessage(`MCP server configuration (Port: ${portToUse}) copied to clipboard!`);
            this.outputChannel.appendLine('[Coordinator] MCP server configuration (Port: ${portToUse}) copied to clipboard.');
            console.log('[Coordinator] MCP config copied:', configString);

        } catch (error: unknown) {
            const errorMsg = `Failed to copy MCP configuration: ${error instanceof Error ? error.message : String(error)}`;
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
            `MCP server port ${occupiedPort} is already in use.`,
            { modal: true }, // Modal dialog, blocks other operations
            Constants.UI_TEXT_INPUT_NEW_PORT
        );

        if (choice === Constants.UI_TEXT_INPUT_NEW_PORT) {
            const newPortStr = await vscode.window.showInputBox({
                    prompt: `Please enter a new port number (1025-65535), current port ${occupiedPort} is in use.`,
                    placeHolder: `e.g.: ${Constants.DEFAULT_MCP_PORT + 1}`, // Suggest a different port
                    ignoreFocusOut: true, // Prevent input box from closing when losing focus
                    validateInput: (value) => {
                        if (!value) { return 'Port number cannot be empty.'; }
                        const portNum = parseInt(value, 10);
                        if (!isValidPort(portNum)) {
                            return 'Please enter a valid port number between 1025 and 65535.';
                        }
                        return null;
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
        // User cancelled or closed the input box
        vscode.window.showInformationMessage('MCP server startup cancelled.');
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
    }

}
