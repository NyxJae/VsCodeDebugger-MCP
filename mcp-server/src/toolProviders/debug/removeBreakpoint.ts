import { z } from 'zod';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator'; // Import PluginResponse type
import * as Constants from '../../constants';
import { logger } from '../../config'; // 导入 logger
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'; // 导入 RequestHandlerExtra

// --- Input Schema Definitions (Keep as is) ---
const LocationSchema = z.object({
  file_path: z.string().describe('The absolute path or workspace-relative path of the source file from which to remove the breakpoint.'),
  line_number: z.number().int().positive().describe('The 1-based line number of the breakpoint to remove.'),
});

export const BaseRemoveBreakpointInputSchema = z.object({
  breakpoint_id: z.number().int().positive().optional().describe('The unique ID of the breakpoint to remove.'),
  location: LocationSchema.optional().describe('Specifies the location of the breakpoint to remove.'),
  clear_all: z.boolean().optional().describe('If set to true, attempts to remove all breakpoints.'),
});

// Refined schema to ensure exactly one parameter is provided
export const RemoveBreakpointInputSchema = BaseRemoveBreakpointInputSchema.refine(
  (data) => {
    const providedParams = [data.breakpoint_id, data.location, data.clear_all].filter(
      (param) => param !== undefined
    );
    return providedParams.length === 1;
  },
  {
    message: 'Exactly one of breakpoint_id, location, or clear_all must be provided.',
  }
);

export type RemoveBreakpointInput = z.infer<typeof RemoveBreakpointInputSchema>; // Use refined schema for type

// --- 新增：定义工具执行结果的 Schema ---
const RemoveBreakpointOutputSchema = z.object({
    status: z.enum([Constants.IPC_STATUS_SUCCESS, Constants.IPC_STATUS_ERROR]),
    message: z.string().optional().describe("A message describing the result of the operation, may be included on success or failure"),
}).describe("Execution result of the remove breakpoint tool");


// --- 新增：定义工具对象 ---
export const removeBreakpointTool = {
    name: Constants.TOOL_REMOVE_BREAKPOINT,
    description: "Removes one or all breakpoints. Can be specified by breakpoint ID, location, or by setting clear_all=true.",
    inputSchema: RemoveBreakpointInputSchema, // Use the refined schema for input validation
    outputSchema: RemoveBreakpointOutputSchema,
    baseinputSchema: BaseRemoveBreakpointInputSchema, // Keep base schema if needed elsewhere

    async execute(
        args: RemoveBreakpointInput, // Expect validated args based on inputSchema
        extra?: RequestHandlerExtra // 修改参数为 extra
    ): Promise<z.infer<typeof RemoveBreakpointOutputSchema>> {
        const toolName = this.name;
        // Input validation is implicitly handled by the MCP server framework using inputSchema
        // If called directly, validation should happen before calling execute.
        // We assume 'args' here conforms to RemoveBreakpointInputSchema.
        logger.info(`[MCP Tool - ${toolName}] Executing with validated args:`, args); // 使用 logger

        try {
            // Use PluginResponse from communicator
            const response: PluginResponse = await sendRequestToPlugin({
                command: Constants.IPC_COMMAND_REMOVE_BREAKPOINT,
                payload: args, // Send the validated parameters
            });

            // --- 更新 IPC 响应处理日志 ---
            const sessionId = extra?.sessionId; // 从 extra 获取 sessionId
            const payloadSnippet = JSON.stringify(response.payload).substring(0, 100);

            if (sessionId) {
                logger.debug(`[MCP Server - ${toolName}] Received IPC response for requestId ${response.requestId}, status: ${response.status}. Preparing SSE send to sessionId: ${sessionId}. Payload snippet: ${payloadSnippet}...`);
            } else {
                // 注意：此警告现在更可能触发，因为 extra 可能不包含 sessionId，除非 SDK 明确传递
                logger.warn(`[MCP Server - ${toolName}] No sessionId found in extra for requestId ${response.requestId} after receiving IPC response. Cannot confirm target SSE session.`);
            }
            // --- 日志结束 ---

            logger.debug(`[MCP Tool - ${toolName}] Received response from plugin:`, response); // 使用 logger

            if (response.status === Constants.IPC_STATUS_SUCCESS) {
                const successMessage = typeof response.payload?.message === 'string' ? response.payload.message : 'Breakpoint removal operation successfully requested.';
                logger.info(`[MCP Tool - ${toolName}] Success: ${successMessage}`); // 使用 logger
                return { status: Constants.IPC_STATUS_SUCCESS, message: successMessage };
            } else {
                const errorMessage = response.error?.message || 'Plugin returned an unknown error while removing breakpoint.';
                logger.error(`[MCP Tool - ${toolName}] Plugin reported error: ${errorMessage}`); // 使用 logger
                return { status: Constants.IPC_STATUS_ERROR, message: errorMessage };
            }
        } catch (error: any) {
            const commErrorMessage = error?.message || 'Failed to communicate with plugin or an unknown error occurred.';
            const fullCommMessage = `Communication error occurred while removing breakpoint: ${commErrorMessage}`;
            logger.error(`[MCP Tool - ${toolName}] Communication error:`, error); // 使用 logger
            return { status: Constants.IPC_STATUS_ERROR, message: fullCommMessage };
        }
    }
};