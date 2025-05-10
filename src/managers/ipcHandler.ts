import * as vscode from 'vscode';
import { ProcessManager } from './processManager'; // 引入 ProcessManager
import { DebuggerApiWrapper } from '../vscode/debuggerApiWrapper'; // 引入 DebuggerApiWrapper
import {
    PluginRequest,
    PluginResponse,
    RemoveBreakpointParams,
    StartDebuggingRequestPayload,
    StartDebuggingResponsePayload,
    StepExecutionParams, // 导入 StepExecutionParams
    StepExecutionResult, // 导入 StepExecutionResult
    StopDebuggingPayload // 导入 StopDebuggingPayload
} from '../types'; // 从共享文件导入
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
            if (message?.type === Constants.IPC_MESSAGE_TYPE_REQUEST && message.requestId) {
                 this.sendResponseToServer(message.requestId, Constants.IPC_STATUS_ERROR, undefined, { message: 'Invalid message format.' });
            }
            return;
        }

        const { requestId, command, payload } = message;

        if (!this.debuggerApiWrapper) {
            console.error('[Plugin IPC Handler] DebuggerApiWrapper not set. Cannot handle debug commands.');
            this.outputChannel.appendLine('[IPC Handler Error] DebuggerApiWrapper not set.');
            this.sendResponseToServer(requestId, Constants.IPC_STATUS_ERROR, undefined, { message: 'Internal error: Debugger API handler not available.' });
            return;
        }

        try {
            let responsePayload: any;
            // 在这里添加日志
            console.log(`[Plugin IPC Handler] Received command value: '${command}' for request ID: ${requestId}`);
            this.outputChannel.appendLine(`[IPC Handler Debug] Received command value: '${command}' for request ID: ${requestId}`);
            switch (command) {
                case Constants.IPC_COMMAND_SET_BREAKPOINT:
                    this.outputChannel.appendLine(`[IPC Handler] Handling '${Constants.IPC_COMMAND_SET_BREAKPOINT}' request (ID: ${requestId})`);
                    responsePayload = await this.debuggerApiWrapper.addBreakpoint(payload);
                    // addBreakpoint 返回 { breakpoint } 或 { error }
                    if ('breakpoint' in responsePayload) {
                        this.sendResponseToServer(requestId, Constants.IPC_STATUS_SUCCESS, responsePayload);
                    } else {
                        this.sendResponseToServer(requestId, Constants.IPC_STATUS_ERROR, undefined, responsePayload.error);
                    }
                    break;

                case Constants.IPC_COMMAND_GET_BREAKPOINTS:
                    this.outputChannel.appendLine(`[IPC Handler] Handling '${Constants.IPC_COMMAND_GET_BREAKPOINTS}' request (ID: ${requestId})`);
                    const breakpoints = this.debuggerApiWrapper.getBreakpoints();
                    responsePayload = {
                        timestamp: new Date().toISOString(),
                        breakpoints: breakpoints,
                    };
                    this.sendResponseToServer(requestId, Constants.IPC_STATUS_SUCCESS, responsePayload);
                    break;

                case Constants.IPC_COMMAND_REMOVE_BREAKPOINT:
                    this.outputChannel.appendLine(`[IPC Handler] Handling '${Constants.IPC_COMMAND_REMOVE_BREAKPOINT}' request (ID: ${requestId})`);
                    const removeResult = await this.debuggerApiWrapper.removeBreakpoint(payload as RemoveBreakpointParams);
                    if (removeResult.status === Constants.IPC_STATUS_SUCCESS) {
                        this.sendResponseToServer(requestId, Constants.IPC_STATUS_SUCCESS, { message: removeResult.message });
                    } else {
                        this.sendResponseToServer(requestId, Constants.IPC_STATUS_ERROR, undefined, { message: removeResult.message || '移除断点失败' });
                    }
                    break;

                case Constants.IPC_COMMAND_START_DEBUGGING_REQUEST:
                    // 增强日志：记录完整的 payload
                    this.outputChannel.appendLine(`[IPC Handler] Handling '${Constants.IPC_COMMAND_START_DEBUGGING_REQUEST}' request (ID: ${requestId}). Payload: ${JSON.stringify(payload)}`);
                    const startResult = await this.debuggerApiWrapper.startDebuggingAndWait(
                        (payload as StartDebuggingRequestPayload).configurationName,
                        (payload as StartDebuggingRequestPayload).noDebug
                    );
                    // 增强日志：记录返回的 result，并安全地访问可选属性
                    let logMessage = `[IPC Handler] Result from startDebuggingAndWait for request ${requestId}: Status=${startResult.status}`;
                    if ('message' in startResult && startResult.message) {
                        logMessage += `, Message=${startResult.message}`;
                    }
                    if ('data' in startResult && startResult.data) {
                        logMessage += `, Data=${JSON.stringify(startResult.data)}`;
                    }
                    this.outputChannel.appendLine(logMessage);
                    this.sendResponseToServer(requestId, startResult.status, startResult);
                    break;

                case Constants.IPC_COMMAND_STEP_EXECUTION:
                    this.outputChannel.appendLine(`[IPC Handler] Handling '${Constants.IPC_COMMAND_STEP_EXECUTION}' request (ID: ${requestId})`);
                    try {
                        const params = payload as StepExecutionParams; // 类型断言
                        const { sessionId, thread_id, step_type } = params; // 解构参数

                        // 检查 sessionId 是否存在，插件端期望收到有效的 sessionId
                        // 因为 MCP Server 工具端应该已经处理了 sessionId 为空的情况（尝试获取活动会话）
                        if (!sessionId) {
                            console.error(`[Plugin IPC Handler] Missing sessionId for stepExecution request ${requestId}. Plugin expects a valid session ID.`);
                            this.outputChannel.appendLine(`[IPC Handler Error] Missing sessionId for stepExecution request ${requestId}.`);
                            const errorResult: StepExecutionResult = {
                                status: 'error',
                                message: '执行 stepExecution 失败：MCP Server 未能提供有效的 session_id。'
                            };
                            this.sendResponseToServer(requestId, errorResult.status, errorResult);
                            break; // 结束处理此 case
                        }

                        // 使用解构出的参数调用，确保顺序正确
                        const stepResult = await this.debuggerApiWrapper.stepExecutionAndWait(sessionId, thread_id, step_type);
                        // stepExecutionAndWait 返回的是 StepExecutionResult
                        // sendResponseToServer 会处理这种特殊 payload
                        this.sendResponseToServer(requestId, stepResult.status, stepResult); // 传递内部 status 和完整 payload
                    } catch (error: any) {
                        // 捕获 DebuggerApiWrapper 或 DebugSessionManager 中可能抛出的同步错误 (例如 session 不存在)
                        console.error(`[Plugin IPC Handler] Error directly calling stepExecutionAndWait for request ${requestId}:`, error);
                        this.outputChannel.appendLine(`[IPC Handler Error] Failed during stepExecutionAndWait call for request ${requestId}: ${error.message}`);
                        const errorResult: StepExecutionResult = {
                            status: error.status || 'error', // 保留可能的特定状态
                            message: error.message || '执行 stepExecution 时发生未知错误。'
                        };
                        this.sendResponseToServer(requestId, errorResult.status, errorResult); // 发送错误结果
                    }
                    break;

                case Constants.IPC_COMMAND_STOP_DEBUGGING: // 新增处理 stopDebugging
                    this.outputChannel.appendLine(`[IPC Handler] Handling '${Constants.IPC_COMMAND_STOP_DEBUGGING}' request (ID: ${requestId})`);
                    try {
                        // 从 payload 中提取可选的 sessionId
                        const payloadData = payload as StopDebuggingPayload | undefined;
                        const sessionId = payloadData?.sessionId;
                        console.log(`[Plugin IPC Handler] stopDebugging: Received sessionId: ${sessionId}`); // 添加日志
                        // 调用 DebuggerApiWrapper 中的 stopDebugging 方法
                        const stopResult = await this.debuggerApiWrapper.stopDebugging(sessionId); // 传递 sessionId
                        console.log('[Plugin IPC Handler] stopDebugging result:', stopResult);
                        // stopDebugging 返回 { status: string; message?: string }
                        // sendResponseToServer 会根据 status 决定最终的 IPC status 和 payload/error
                        this.sendResponseToServer(
                            requestId,
                            stopResult.status as typeof Constants.IPC_STATUS_SUCCESS | typeof Constants.IPC_STATUS_ERROR, // 添加类型断言以匹配函数签名
                            stopResult.message ? { message: stopResult.message } : undefined,
                            stopResult.status === Constants.IPC_STATUS_ERROR ? { message: stopResult.message || '停止调试时发生未知错误' } : undefined
                        );
                    } catch (error: any) {
                        // 捕获 DebuggerApiWrapper 或 DebugSessionManager 中可能抛出的同步错误
                        console.error(`[Plugin IPC Handler] Error directly calling stopDebugging for request ${requestId}:`, error);
                        this.outputChannel.appendLine(`[IPC Handler Error] Failed during stopDebugging call for request ${requestId}: ${error.message}`);
                        this.sendResponseToServer(requestId, Constants.IPC_STATUS_ERROR, undefined, { message: `处理停止调试命令时发生内部错误: ${error.message}` });
                    }
                    break;

                // 在这里添加对其他调试命令的处理...
                // case Constants.IPC_COMMAND_GET_CONFIGURATIONS:
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
     * @param status 响应状态 (可以是 IPC 标准状态或 StartDebugging/StepExecution 的内部状态)。
     * @param payload 响应负载 (可以是通用负载或 StartDebuggingResponsePayload/StepExecutionResult)。
     * @param error 错误信息。
     */
    private sendResponseToServer(
        requestId: string,
        status: typeof Constants.IPC_STATUS_SUCCESS | typeof Constants.IPC_STATUS_ERROR | StartDebuggingResponsePayload['status'] | StepExecutionResult['status'],
        payload?: any,
        error?: { message: string }
    ): void {
        let finalPayload = payload;
        let finalStatus: typeof Constants.IPC_STATUS_SUCCESS | typeof Constants.IPC_STATUS_ERROR = Constants.IPC_STATUS_ERROR; // Default to error
        let finalError = error;

        // 检查 payload 是否是 StartDebuggingResponsePayload 或 StepExecutionResult 类型
        const isDebugResultPayload = payload && typeof payload === 'object' && 'status' in payload &&
                                     ['stopped', 'completed', 'error', 'timeout', 'interrupted'].includes(payload.status);

        if (isDebugResultPayload) {
            const debugResultPayload = payload as StartDebuggingResponsePayload | StepExecutionResult; // 联合类型
            // 映射到顶层 IPC 状态
            if (debugResultPayload.status === 'stopped' || debugResultPayload.status === 'completed') {
                finalStatus = Constants.IPC_STATUS_SUCCESS;
                finalPayload = debugResultPayload; // 成功时，payload 就是完整的 Debug 结果
                finalError = undefined; // 清除可能存在的外部错误
            } else {
                // 对于 error, timeout, interrupted 状态
                finalStatus = Constants.IPC_STATUS_ERROR;
                finalError = { message: debugResultPayload.message }; // 将内部消息放入顶层 error
                finalPayload = undefined; // 清除 payload
            }
        } else {
             // 如果不是 Debug 结果 Payload，则使用传入的 status 和 error
             if (status === Constants.IPC_STATUS_SUCCESS || status === Constants.IPC_STATUS_ERROR) {
                 finalStatus = status;
             } else {
                 // 如果传入的 status 也不是标准 IPC 状态 (例如 Debug 结果的内部状态)，则默认为 error
                 finalStatus = Constants.IPC_STATUS_ERROR;
                 // 如果没有明确的 error 对象，尝试从 payload 或 status 创建一个
                 if (!finalError) {
                     const message = typeof payload?.message === 'string' ? payload.message : `Operation failed with status: ${status}`;
                     finalError = { message };
                 }
                 finalPayload = undefined; // 清除非标准成功状态的 payload
             }
             // finalPayload 和 finalError 保持传入的值 (除非上面已修改)
        }

        const responseMessage: PluginResponse = {
            type: Constants.IPC_MESSAGE_TYPE_RESPONSE,
            requestId: requestId,
            status: finalStatus,
            payload: finalPayload,
            error: finalError
        };

        // 增强日志：记录最终发送给 MCP 服务器的 responseMessage
        this.outputChannel.appendLine(`[IPC Handler] Sending response to MCP Server for request ${requestId}. Full response: ${JSON.stringify(responseMessage)}`);
        console.log(`[IPC Handler] Sending response to MCP Server for request ${requestId}:`, responseMessage);

        try {
            const success = this.processManager.send(responseMessage);
            this.outputChannel.appendLine(`[IPC Handler] processManager.send returned: ${success} for request ${requestId}`);

            if (!success) {
                console.error(`[Plugin IPC Handler] Failed to send IPC response via ProcessManager for request ${requestId} (returned false).`);
                this.outputChannel.appendLine(`[IPC Handler Error] Failed to send response via ProcessManager for request ${requestId}. Process might be unavailable or channel blocked.`);
            } else {
                 this.outputChannel.appendLine(`[IPC Handler] Successfully queued response via ProcessManager for request ${requestId}: ${finalStatus}`);
            }
        } catch (e: any) {
            console.error(`[Plugin IPC Handler] Exception during processManager.send for request ${requestId}:`, e);
            this.outputChannel.appendLine(`[IPC Handler Exception] Exception during send for request ${requestId}: ${e.message}`);
        }
    }


    /**
     * 实现 vscode.Disposable 接口。
     */
    dispose(): void {
        this.outputChannel.appendLine('[IPC Handler] Disposing...');
        // 目前 IpcHandler 没有需要显式清理的资源
        // OutputChannel 由 McpServerManager 管理和清理
        console.log('[Plugin IPC Handler] Disposed.');
    }
}