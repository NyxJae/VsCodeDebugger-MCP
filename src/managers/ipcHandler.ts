import * as vscode from 'vscode';
import { ProcessManager } from './processManager'; // 引入 ProcessManager
import { DebuggerApiWrapper } from '../vscode/debuggerApiWrapper'; // 引入 DebuggerApiWrapper
import { PluginRequest, PluginResponse, RemoveBreakpointParams } from '../types'; // 从共享文件导入, 增加 RemoveBreakpointParams
import * as Constants from '../constants'; // 导入常量

/**
 * 处理与 MCP 服务器子进程的 IPC 通信，并将调试相关请求委托给 DebuggerApiWrapper。
 */
export class IpcHandler implements vscode.Disposable { // 实现 Disposable 接口
    private outputChannel: vscode.OutputChannel;
    private debuggerApiWrapper: DebuggerApiWrapper | null = null; // 持有 DebuggerApiWrapper 实例
    private processManager: ProcessManager; // 持有 ProcessManager 实例

    constructor(
        outputChannel: vscode.OutputChannel,
        processManager: ProcessManager // 注入 ProcessManager
    ) {
        this.outputChannel = outputChannel;
        this.processManager = processManager;
        this.outputChannel.appendLine('[IPC Handler] Initialized.');
    }

    /**
     * 设置 DebuggerApiWrapper 实例。
     * @param wrapper DebuggerApiWrapper 实例。
     */
    public setDebuggerApiWrapper(wrapper: DebuggerApiWrapper): void {
        this.debuggerApiWrapper = wrapper;
        this.outputChannel.appendLine('[IPC Handler] DebuggerApiWrapper injected.');
    }

    /**
     * 处理从 ProcessManager 转发过来的 IPC 消息。
     * @param message 收到的消息对象。
     */
    public async handleIncomingMessage(message: PluginRequest | any): Promise<void> {
        console.log('[Plugin IPC Handler] Handling incoming message:', message);
        this.outputChannel.appendLine(`[IPC Handler] Handling message: ${JSON.stringify(message)}`);

        if (message?.type !== Constants.IPC_MESSAGE_TYPE_REQUEST || !message.command || !message.requestId) {
            console.warn('[Plugin IPC Handler] Received invalid or non-request message:', message);
            this.outputChannel.appendLine(`[IPC Handler Warning] Received invalid message: ${JSON.stringify(message)}`);
            // 对于无效请求，可以选择不响应或发送错误
            if (message?.type === Constants.IPC_MESSAGE_TYPE_REQUEST && message.requestId) {
                 this.sendResponseToServer(message.requestId, Constants.IPC_STATUS_ERROR, undefined, { message: 'Invalid message format.' });
            }
            return;
        }

        const { requestId, command, payload } = message;

        // 检查 DebuggerApiWrapper 是否已设置
        if (!this.debuggerApiWrapper) {
            console.error('[Plugin IPC Handler] DebuggerApiWrapper not set. Cannot handle debug commands.');
            this.outputChannel.appendLine('[IPC Handler Error] DebuggerApiWrapper not set.');
            this.sendResponseToServer(requestId, Constants.IPC_STATUS_ERROR, undefined, { message: 'Internal error: Debugger API handler not available.' });
            return;
        }

        try {
            let responsePayload: any;
            switch (command) {
                case Constants.IPC_COMMAND_SET_BREAKPOINT:
                    this.outputChannel.appendLine(`[IPC Handler] Handling '${Constants.IPC_COMMAND_SET_BREAKPOINT}' request (ID: ${requestId})`);
                    // 委托给 DebuggerApiWrapper
                    responsePayload = await this.debuggerApiWrapper.addBreakpoint(payload);
                    this.sendResponseToServer(requestId, Constants.IPC_STATUS_SUCCESS, responsePayload);
                    break;

                case Constants.IPC_COMMAND_GET_BREAKPOINTS:
                    this.outputChannel.appendLine(`[IPC Handler] Handling '${Constants.IPC_COMMAND_GET_BREAKPOINTS}' request (ID: ${requestId})`);
                    // 委托给 DebuggerApiWrapper
                    const breakpoints = this.debuggerApiWrapper.getBreakpoints();
                    responsePayload = {
                        timestamp: new Date().toISOString(), // 添加时间戳
                        breakpoints: breakpoints,
                    };
                    this.sendResponseToServer(requestId, Constants.IPC_STATUS_SUCCESS, responsePayload);
                    break;

                case Constants.IPC_COMMAND_REMOVE_BREAKPOINT: // 新增处理 removeBreakpoint
                    this.outputChannel.appendLine(`[IPC Handler] Handling '${Constants.IPC_COMMAND_REMOVE_BREAKPOINT}' request (ID: ${requestId})`);
                    // 委托给 DebuggerApiWrapper
                    const removeResult = await this.debuggerApiWrapper.removeBreakpoint(payload as RemoveBreakpointParams); // 类型断言
                    if (removeResult.status === Constants.IPC_STATUS_SUCCESS) {
                        this.sendResponseToServer(requestId, Constants.IPC_STATUS_SUCCESS, { message: removeResult.message });
                    } else {
                        this.sendResponseToServer(requestId, Constants.IPC_STATUS_ERROR, undefined, { message: removeResult.message || '移除断点失败' });
                    }
                    break;

                // 在这里添加对其他调试命令的处理...
                // case 'getConfigurations':
                //     // const configs = await this.debuggerApiWrapper.getConfigurations(); // 假设有此方法
                //     // responsePayload = { configurations: configs };
                //     // this.sendResponseToServer(requestId, Constants.IPC_STATUS_SUCCESS, responsePayload);
                //     this.outputChannel.appendLine(`[IPC Handler] Command '${command}' not yet implemented.`);
                //     this.sendResponseToServer(requestId, Constants.IPC_STATUS_ERROR, undefined, { message: `Command '${command}' not implemented.` });
                //     break;

                default:
                    console.warn(`[Plugin IPC Handler] Received unknown command: ${command}`);
                    this.outputChannel.appendLine(`[IPC Handler Warning] Received unknown command: ${command}`);
                    this.sendResponseToServer(requestId, Constants.IPC_STATUS_ERROR, undefined, { message: `Unknown command: ${command}` });
                    break;
            }
        } catch (error: any) {
            console.error(`[Plugin IPC Handler] Error handling command '${command}' for request ${requestId}:`, error);
            this.outputChannel.appendLine(`[IPC Handler Error] Failed to handle command '${command}' for request ${requestId}: ${error.message}`);
            this.sendResponseToServer(requestId, Constants.IPC_STATUS_ERROR, undefined, { message: `Failed to handle command '${command}': ${error.message}` });
        }
    }


    /**
     * 发送响应给服务器子进程，通过 ProcessManager。
     * @param requestId 请求 ID。
     * @param status 响应状态。
     * @param payload 响应负载。
     * @param error 错误信息。
     */
    private sendResponseToServer(requestId: string, status: typeof Constants.IPC_STATUS_SUCCESS | typeof Constants.IPC_STATUS_ERROR, payload?: any, error?: { message: string }): void {
        const responseMessage: PluginResponse = {
            type: Constants.IPC_MESSAGE_TYPE_RESPONSE,
            requestId: requestId,
            status: status,
            payload: payload,
            error: error
        };

        this.outputChannel.appendLine(`[IPC Handler] Preparing to send response via ProcessManager for request ${requestId}: ${status}`);
        try {
            const success = this.processManager.send(responseMessage); // 使用 ProcessManager 发送
            this.outputChannel.appendLine(`[IPC Handler] processManager.send returned: ${success} for request ${requestId}`); // Log return value explicitly

            if (!success) {
                console.error(`[Plugin IPC Handler] Failed to send IPC response via ProcessManager for request ${requestId} (returned false).`);
                this.outputChannel.appendLine(`[IPC Handler Error] Failed to send response via ProcessManager for request ${requestId}. Process might be unavailable or channel blocked.`);
            } else {
                 this.outputChannel.appendLine(`[IPC Handler] Successfully queued response via ProcessManager for request ${requestId}: ${status}`); // Changed log message slightly
            }
        } catch (e: any) {
            console.error(`[Plugin IPC Handler] Exception during processManager.send for request ${requestId}:`, e);
            this.outputChannel.appendLine(`[IPC Handler Exception] Exception during send for request ${requestId}: ${e.message}`);
        }
    }


    /**
     */
    dispose(): void {
        this.outputChannel.appendLine('[IPC Handler] Disposing...');
        // 目前 IpcHandler 没有需要显式清理的资源
        // OutputChannel 由 McpServerManager 管理和清理
        console.log('[Plugin IPC Handler] Disposed.');
    }
}