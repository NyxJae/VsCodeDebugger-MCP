import { z } from 'zod';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
import * as Constants from '../../constants';
import { logger } from '../../config'; // 导入 logger
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'; // 导入 RequestHandlerExtra

// Input Schema (Keep as is)
export const stopDebuggingSchema = z.object({
    sessionId: z.string().optional().describe("The ID of the debug session to stop. If omitted, the currently active session will be attempted."),
});

export type StopDebuggingArgs = z.infer<typeof stopDebuggingSchema>;

// --- 新增：定义工具执行结果的 Schema ---
const StopDebuggingOutputSchema = z.object({
    status: z.enum([Constants.IPC_STATUS_SUCCESS, Constants.IPC_STATUS_ERROR]),
    message: z.string().optional().describe("A message describing the result of the operation, may be included on success or failure"),
}).describe("Execution result of the stop debugging tool");


// --- 新增：定义工具对象 ---
export const stopDebuggingTool = {
    name: Constants.TOOL_STOP_DEBUGGING, // Use correct constant
    description: "Stops the specified or currently active debug session.",
    inputSchema: stopDebuggingSchema,
    outputSchema: StopDebuggingOutputSchema,

    async execute(
        args: StopDebuggingArgs,
        extra?: RequestHandlerExtra // 修改参数为 extra
    ): Promise<z.infer<typeof StopDebuggingOutputSchema>> {
        const toolName = this.name;
        logger.info(`[MCP Tool - ${toolName}] Executing with args:`, args); // 使用 logger

        try {
            logger.debug(`[MCP Tool - ${toolName}] Sending request to plugin:`, { sessionId: args.sessionId }); // Log payload being sent
            const response: PluginResponse = await sendRequestToPlugin({
                 command: Constants.IPC_COMMAND_STOP_DEBUGGING,
                 payload: { sessionId: args.sessionId } // Pass args directly
            });

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

            if (response.status === Constants.IPC_STATUS_SUCCESS) { // Use Constants.*
                const successMessage = response.payload?.message || 'Request to stop debug session successfully sent.';
                logger.info(`[MCP Tool - ${toolName}] Success: ${successMessage}`); // 使用 logger
                // Return success status based on schema
                return { status: Constants.IPC_STATUS_SUCCESS, message: successMessage };
            } else { // Handles IPC_STATUS_ERROR or any other non-success status from plugin
                const errorMessage = response.error?.message || 'Plugin returned an unknown error or non-success status while stopping debugging.';
                logger.error(`[MCP Tool - ${toolName}] Plugin reported error or non-success status: ${errorMessage}`); // 使用 logger
                // Return error status based on schema
                return { status: Constants.IPC_STATUS_ERROR, message: errorMessage };
            }
        } catch (error: any) { // Catch communication errors or errors in sendRequestToPlugin
            const commErrorMessage = error?.message || 'Failed to communicate with plugin or an unknown error occurred.';
            logger.error(`[MCP Tool - ${toolName}] Communication error:`, error); // 使用 logger
            // Return error status based on schema
            return { status: Constants.IPC_STATUS_ERROR, message: `Failed to communicate with plugin: ${commErrorMessage}` };
        }
    }
};

// --- 保留旧函数以防万一 ---
/*
export async function handleStopDebugging(
    args: z.infer<typeof stopDebuggingSchema> // 使用 z.infer 保持与 schema 同步
): Promise<{ status: string; message: string }> {
    // ... 旧的实现 ...
}
*/