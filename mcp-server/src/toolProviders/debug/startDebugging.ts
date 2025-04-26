import { z } from 'zod';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
import * as Constants from '../../constants';
import { logger } from '../../config'; // 导入 logger
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'; // 导入 RequestHandlerExtra
import type { StartDebuggingRequestPayload, StartDebuggingResponsePayload } from '../../types'; // Keep type import

// Input Schema (Keep as is)
export const startDebuggingSchema = z.object({
  configuration_name: z.string().min(1, "Configuration name cannot be empty.").describe("The name of the configuration in launch.json"),
  no_debug: z.boolean().optional().default(false).describe("Whether to start in non-debug mode"),
});

export type StartDebuggingArgs = z.infer<typeof startDebuggingSchema>;

// --- 新增：定义工具执行结果的 Schema (基于 StartDebuggingResponsePayload) ---
// StartDebuggingResponsePayload already defines the structure we need for the result.
// We can reuse it or define a specific Zod schema if stricter validation is desired.
// Let's define a Zod schema for clarity and consistency.
const StartDebuggingOutputSchema = z.object({
    status: z.enum(["stopped", "completed", "error", "timeout", "interrupted", "running"]), // Add 'running' if applicable
    data: z.any().optional().describe("Contains details of the stop event when status is 'stopped'."),
    message: z.string().optional().describe("Contains descriptive information when status is 'completed', 'error', 'timeout', or 'interrupted'."),
    session_id: z.string().optional().describe("The ID of the successfully started debug session"), // Add session_id if returned by plugin
}).describe("Execution result of the start debugging tool");


// --- 新增：定义工具对象 ---
export const startDebuggingTool = {
    name: Constants.TOOL_START_DEBUGGING,
    description: "Starts a debug session based on the configuration name in launch.json.",
    inputSchema: startDebuggingSchema,
    outputSchema: StartDebuggingOutputSchema, // Use the new output schema

    async execute(
        args: StartDebuggingArgs,
        extra?: RequestHandlerExtra // 修改参数为 extra
    ): Promise<z.infer<typeof StartDebuggingOutputSchema>> {
        const toolName = this.name;
        logger.info(`[MCP Tool - ${toolName}] Executing with args:`, args); // 使用 logger

        const payloadForPlugin: StartDebuggingRequestPayload = {
            configurationName: args.configuration_name,
            noDebug: args.no_debug,
        };

        const toolTimeout = 60000; // Keep timeout

        try {
            logger.debug(`[MCP Tool - ${toolName}] Sending request to plugin:`, payloadForPlugin); // 使用 logger
            // Specify the expected response payload type for better type checking
            const pluginResponse: PluginResponse<StartDebuggingResponsePayload> = await sendRequestToPlugin(
                { command: Constants.IPC_COMMAND_START_DEBUGGING_REQUEST, payload: payloadForPlugin },
                toolTimeout
            );

            // --- 更新 IPC 响应处理日志 ---
            const sessionId = extra?.sessionId; // 从 extra 获取 sessionId
            const payloadSnippet = JSON.stringify(pluginResponse.payload).substring(0, 100);

            if (sessionId) {
                logger.debug(`[MCP Server - ${toolName}] Received IPC response for requestId ${pluginResponse.requestId}, status: ${pluginResponse.status}. Preparing SSE send to sessionId: ${sessionId}. Payload snippet: ${payloadSnippet}...`);
            } else {
                // 注意：此警告现在更可能触发，因为 extra 可能不包含 sessionId，除非 SDK 明确传递
                logger.warn(`[MCP Server - ${toolName}] No sessionId found in extra for requestId ${pluginResponse.requestId} after receiving IPC response. Cannot confirm target SSE session.`);
            }
            // --- 日志结束 ---

            logger.debug(`[MCP Tool - ${toolName}] Received response from plugin:`, pluginResponse); // 使用 logger

            if (pluginResponse.status === Constants.IPC_STATUS_SUCCESS && pluginResponse.payload) {
                // Validate and return the payload according to StartDebuggingOutputSchema
                // The structure of StartDebuggingResponsePayload seems compatible
                try {
                    // Directly parse the payload using the output schema
                    const validatedResult = StartDebuggingOutputSchema.parse(pluginResponse.payload);
                    logger.info(`[MCP Tool - ${toolName}] Debugging started/stopped with status: ${validatedResult.status}`); // 使用 logger
                    return validatedResult;
                } catch (validationError: any) {
                    const errorMessage = `Invalid start debugging result format returned by plugin: ${validationError.message}`;
                    logger.error(`[MCP Tool - ${toolName}] ${errorMessage}`, pluginResponse.payload); // 使用 logger
                    // Return an error status consistent with the schema
                    return { status: 'error', message: errorMessage };
                }
            } else if (pluginResponse.status === Constants.IPC_STATUS_ERROR) {
                const errorMessage = pluginResponse.error?.message || 'Plugin failed to start debugging, no specific error provided.';
                logger.error(`[MCP Tool - ${toolName}] Plugin reported error: ${errorMessage}`); // 使用 logger
                return { status: 'error', message: errorMessage };
            } else {
                const errorMessage = 'Plugin returned success but response payload format is unexpected or missing.';
                logger.error(`[MCP Tool - ${toolName}] ${errorMessage}`, pluginResponse.payload); // 使用 logger
                return { status: 'error', message: errorMessage };
            }

        } catch (error: any) {
            logger.error(`[MCP Tool - ${toolName}] Error during communication:`, error); // 使用 logger
            let errorStatus: z.infer<typeof StartDebuggingOutputSchema>['status'] = 'error';
            let errorMessage = `MCP Server error: ${error.message || 'Unknown communication error'}`;
            if (error.message?.includes('timed out')) {
                errorStatus = 'timeout'; // Use 'timeout' status from the schema
                errorMessage = `MCP Server: Timeout waiting for plugin response (${toolTimeout}ms).`;
            }
            return { status: errorStatus, message: errorMessage };
        }
    }
};


// --- 保留旧函数以防万一 ---
/*
type McpToolResult_Old = {
    content: { type: "text", text: string }[];
    isError?: boolean;
};

export async function handleStartDebugging(
    args: StartDebuggingArgs,
    extra: any // RequestHandlerExtra
): Promise<McpToolResult_Old> {
   // ... 旧的实现 ...
}
*/