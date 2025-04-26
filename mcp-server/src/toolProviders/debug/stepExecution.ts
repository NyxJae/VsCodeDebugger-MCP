import { z } from 'zod';
import { StepExecutionParams, StepExecutionResult } from '../../types';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
import * as Constants from '../../constants'; // Import all constants
import { logger } from '../../config'; // 导入 logger
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'; // 导入 RequestHandlerExtra

const StepExecutionParamsSchema = z.object({
    session_id: z.string().optional().describe("The ID of the target debug session. If omitted, the currently active debug session will be attempted."),
    thread_id: z.number().int().describe('The ID of the thread for which to perform the step operation (obtained from stop_event_data.thread_id).'),
    step_type: z.enum(['over', 'into', 'out']).describe("Specifies the type of step execution: 'over', 'into', or 'out'.")
});

const AsyncDebugResultSchema = z.object({
    status: z.enum(["stopped", "completed", "error", "timeout", "interrupted"]),
    stop_event_data: z.any().optional().describe("Contains details of the stop event when status is 'stopped'."),
    message: z.string().optional().describe("Contains descriptive information when status is 'completed', 'error', 'timeout', or 'interrupted'.")
}).describe("Result of an asynchronous debug operation");


export const stepExecutionTool = {
    name: Constants.TOOL_NAME_STEP_EXECUTION, // Correct constant name
    description: 'When the debugger is paused, performs a single step operation (step over, step into, or step out). If session_id is omitted, the active session will be attempted.',
    inputSchema: StepExecutionParamsSchema,
    outputSchema: AsyncDebugResultSchema,

    async execute(
        params: StepExecutionParams,
        extra?: RequestHandlerExtra // 修改参数为 extra
    ): Promise<z.infer<typeof AsyncDebugResultSchema>> {
        const toolName = this.name;
        logger.info(`[MCP Tool - ${toolName}] Executing with params:`, params); // 使用 logger
        try {

            let sessionId = params.session_id;
            const threadId = params.thread_id;
            const stepType = params.step_type;

            logger.debug(`[MCP Tool - ${toolName}] Sending request to plugin for session ${sessionId || 'default (active)'}, thread ${threadId}, step: ${stepType}`); // 使用 logger

            const response: PluginResponse<StepExecutionResult> = await sendRequestToPlugin(
                {
                    command: Constants.IPC_COMMAND_STEP_EXECUTION, // Use constant
                    payload: {
                        sessionId: sessionId,
                        thread_id: threadId,
                        step_type: stepType,
                    }
                },
                65000 // Timeout
            );

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
                const result = response.payload; // Define result here
                if (result.status === 'stopped') {
                    return {
                        status: 'stopped',
                        stop_event_data: result.stop_event_data,
                    };
                } else if (result.status === 'completed') {
                    return {
                        status: 'completed',
                        message: result.message,
                    };
                } else if (result.status === 'timeout') {
                    return {
                        status: 'timeout',
                        message: result.message,
                    };
                } else if (result.status === 'interrupted') {
                    return {
                        status: 'interrupted',
                        message: result.message,
                    };
                } else if (result.status === 'error') {
                    return {
                        status: 'error',
                        message: result.message || 'Plugin returned error status but no message',
                    };
                }
                 // 如果 payload.status 不是预期的值，记录错误并返回 error 状态
                 const unexpectedStatusMsg = `Encountered unexpected internal status when processing plugin response: ${(result as any).status}`;
                 logger.error(`[MCP Tool - ${toolName}] ${unexpectedStatusMsg}`, result);
                 return { status: 'error', message: unexpectedStatusMsg };
            } else { // This else corresponds to the outer if (response.status === ...)
                 const errorMessage = response.error?.message || 'Plugin communication failed or returned invalid response';
                 logger.error(`[MCP Tool - ${toolName}] Plugin communication error: ${errorMessage}`); // 使用 logger
                 return {
                     status: 'error',
                     message: errorMessage,
                 };
            }
        } catch (error: any) { // Catch block for the outer try
            logger.error(`[MCP Tool - ${toolName}] Error executing step_execution:`, error); // 使用 logger
            const status = error.message?.includes('timed out') ? 'timeout' : 'error';
            return {
                status: status,
                message: `Error executing ${toolName} tool: ${error.message || error}`,
            };
        }
    },
};