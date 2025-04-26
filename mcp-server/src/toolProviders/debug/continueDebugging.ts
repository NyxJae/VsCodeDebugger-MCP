import { z } from 'zod';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
import { ContinueDebuggingParams, StartDebuggingResponsePayload } from '../../types';
import * as Constants from '../../constants'; // Import Constants
import { logger } from '../../config'; // 导入 logger
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'; // 导入 RequestHandlerExtra

const ContinueDebuggingParamsSchema = z.object({
    session_id: z.string().optional().describe("The ID of the target debug session. If omitted, the currently active debug session will be attempted."),
    thread_id: z.number().int().describe("The ID of the thread whose execution needs to be resumed."),
});

// 在这里定义异步结果 Schema
const AsyncDebugResultSchema = z.object({
    status: z.enum(["stopped", "completed", "error", "timeout", "interrupted"]),
    stop_event_data: z.any().optional().describe("Contains details of the stop event when status is 'stopped'."),
    message: z.string().optional().describe("Contains descriptive information when status is 'completed', 'error', 'timeout', or 'interrupted'.")
}).describe("Result of an asynchronous debug operation");


export const continueDebuggingTool = {
    name: "continue_debugging", // 恢复使用字符串名称，因为常量不存在
    description: "When the debugger is paused, this command resumes execution of the specified thread and waits for the next pause or termination. If session_id is omitted, the active session will be attempted.",
    inputSchema: ContinueDebuggingParamsSchema,
    outputSchema: AsyncDebugResultSchema,

    async execute(
        params: ContinueDebuggingParams,
        extra?: RequestHandlerExtra // 修改参数为 extra
    ): Promise<z.infer<typeof AsyncDebugResultSchema>> {
        const toolName = this.name;
        try {
            logger.info(`[MCP Tool - ${toolName}] Executing with params:`, params); // 使用 logger

            let sessionId = params.session_id;
            const threadId = params.thread_id;

            logger.debug(`[MCP Tool - ${toolName}] Sending request to plugin for session ${sessionId || 'default (active)'}, thread ${threadId}`); // 使用 logger

            const response: PluginResponse<StartDebuggingResponsePayload> = await sendRequestToPlugin({
                command: Constants.IPC_COMMAND_CONTINUE_DEBUGGING, // 使用常量
                payload: {
                    sessionId: sessionId,
                    threadId: threadId,
                }
            }, 65000); // 设置超时时间 (65 秒)

            // --- 更新 IPC 响应处理日志 ---
            const transportSessionId = extra?.sessionId; // 从 extra 获取 sessionId
            const payloadSnippet = JSON.stringify(response.payload).substring(0, 100);

            if (transportSessionId) {
                logger.debug(`[MCP Server - ${toolName}] Received IPC response for requestId ${response.requestId}, status: ${response.status}. Preparing SSE send to sessionId: ${transportSessionId}. Payload snippet: ${payloadSnippet}...`);
            } else {
                // 注意：此警告现在更可能触发，因为 extra 可能不包含 sessionId，除非 SDK 明确传递
                logger.warn(`[MCP Server - ${toolName}] No sessionId found in extra for requestId ${response.requestId} after receiving IPC response. Cannot confirm target SSE session.`);
            }
            // --- 日志结束 ---

            logger.debug(`[MCP Tool - ${toolName}] Received response from plugin:`, response); // 使用 logger

            if (response.status === Constants.IPC_STATUS_SUCCESS && response.payload) { // Use constant
                const payload = response.payload;
                // 适配 StartDebuggingResponsePayload 到 AsyncDebugResultSchema
                if (payload.status === 'stopped') {
                    return { status: 'stopped', stop_event_data: payload.data };
                } else if (payload.status === 'completed' || payload.status === 'error' || payload.status === 'timeout' || payload.status === 'interrupted') {
                    return { status: payload.status, message: payload.message };
                }
                // 如果 payload.status 不是预期的值，记录错误并返回 error 状态
                const unexpectedStatusMsg = `处理插件响应时遇到意外的内部状态: ${(payload as any).status}`;
                logger.error(`[MCP Tool - ${toolName}] ${unexpectedStatusMsg}`, payload);
                return { status: 'error', message: unexpectedStatusMsg };
            } else {
                const errorMessage = response.error?.message || '插件通信失败或返回无效响应';
                logger.error(`[MCP Tool - ${toolName}] Plugin communication error: ${errorMessage}`); // 使用 logger
                return { status: "error", message: errorMessage };
            }

        } catch (error: any) {
            logger.error(`[MCP Tool - ${toolName}] Error executing continue_debugging:`, error); // 使用 logger
            const status = error.message?.includes('timed out') ? 'timeout' : 'error'; // Check for timeout in error message
            return { status: status, message: `执行 ${toolName} 时出错: ${error.message || "未知错误"}` };
        }
    }
};