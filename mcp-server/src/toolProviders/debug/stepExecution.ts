import { z } from 'zod';
import { StepExecutionParams, StepExecutionResult } from '../../types';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
import * as Constants from '../../constants'; // Import all constants
import { logger } from '../../config'; // 导入 logger

const StepExecutionParamsSchema = z.object({
    session_id: z.string().optional().describe("目标调试会话的 ID。如果省略，将尝试使用当前活动的调试会话。"),
    thread_id: z.number().int().describe('需要执行单步操作的线程的 ID (从 stop_event_data.thread_id 获取)。'),
    step_type: z.enum(['over', 'into', 'out']).describe("指定单步执行的具体类型: 'over', 'into', 'out'。")
});

const AsyncDebugResultSchema = z.object({
    status: z.enum(["stopped", "completed", "error", "timeout", "interrupted"]),
    stop_event_data: z.any().optional().describe("当 status 为 'stopped' 时，包含停止事件的详细信息。"),
    message: z.string().optional().describe("当 status 为 'completed', 'error', 'timeout', 'interrupted' 时，包含描述信息。")
}).describe("异步调试操作的结果");


export const stepExecutionTool = {
    name: Constants.TOOL_NAME_STEP_EXECUTION, // Correct constant name
    description: '当调试器暂停时，执行一次单步操作 (步过, 步入, 步出)。如果省略 session_id，将尝试使用活动会话。',
    inputSchema: StepExecutionParamsSchema,
    outputSchema: AsyncDebugResultSchema,

    async execute(
        params: StepExecutionParams,
        context?: { transport?: { sessionId: string } } // 添加 context 参数以获取 sessionId
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

            // --- 新增 IPC 响应处理日志 ---
            const transportSessionId = context?.transport?.sessionId;
            const payloadSnippet = JSON.stringify(response.payload).substring(0, 100);

            if (transportSessionId) {
                logger.debug(`[MCP Server - ${toolName}] Received IPC response for requestId ${response.requestId}, status: ${response.status}. Preparing SSE send to sessionId: ${transportSessionId}. Payload snippet: ${payloadSnippet}...`);
            } else {
                logger.warn(`[MCP Server - ${toolName}] No active transport or sessionId found in context for requestId ${response.requestId} after receiving IPC response. Cannot confirm target SSE session.`);
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
                        message: result.message || '插件返回错误状态但无消息',
                    };
                }
                 // 如果 payload.status 不是预期的值，记录错误并返回 error 状态
                 const unexpectedStatusMsg = `处理插件响应时遇到意外的内部状态: ${(result as any).status}`;
                 logger.error(`[MCP Tool - ${toolName}] ${unexpectedStatusMsg}`, result);
                 return { status: 'error', message: unexpectedStatusMsg };
            } else { // This else corresponds to the outer if (response.status === ...)
                 const errorMessage = response.error?.message || '插件通信失败或返回无效响应';
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
                message: `执行 ${toolName} 工具时出错: ${error.message || error}`,
            };
        }
    },
};