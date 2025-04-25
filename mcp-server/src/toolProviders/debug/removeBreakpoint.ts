import { z } from 'zod';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator'; // Import PluginResponse type
import * as Constants from '../../constants';
import { logger } from '../../config'; // 导入 logger
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'; // 导入 RequestHandlerExtra

// --- Input Schema Definitions (Keep as is) ---
const LocationSchema = z.object({
  file_path: z.string().describe('要移除断点的源代码文件的绝对路径或相对于工作区的路径。'),
  line_number: z.number().int().positive().describe('要移除断点的行号 (基于 1 开始计数)。'),
});

export const BaseRemoveBreakpointInputSchema = z.object({
  breakpoint_id: z.number().int().positive().optional().describe('要移除的断点的唯一 ID。'),
  location: LocationSchema.optional().describe('指定要移除断点的位置。'),
  clear_all: z.boolean().optional().describe('如果设置为 true，则尝试移除所有断点。'),
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
    message: '必须且只能提供 breakpoint_id、location 或 clear_all 中的一个参数。',
  }
);

export type RemoveBreakpointInput = z.infer<typeof RemoveBreakpointInputSchema>; // Use refined schema for type

// --- 新增：定义工具执行结果的 Schema ---
const RemoveBreakpointOutputSchema = z.object({
    status: z.enum([Constants.IPC_STATUS_SUCCESS, Constants.IPC_STATUS_ERROR]),
    message: z.string().optional().describe("操作结果的消息，成功或失败时都可能包含"),
}).describe("移除断点工具的执行结果");


// --- 新增：定义工具对象 ---
export const removeBreakpointTool = {
    name: Constants.TOOL_REMOVE_BREAKPOINT,
    description: "移除一个或所有断点。可以通过断点 ID、位置或设置 clear_all=true 来指定。",
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
                const successMessage = typeof response.payload?.message === 'string' ? response.payload.message : '断点移除操作已成功请求。';
                logger.info(`[MCP Tool - ${toolName}] Success: ${successMessage}`); // 使用 logger
                return { status: Constants.IPC_STATUS_SUCCESS, message: successMessage };
            } else {
                const errorMessage = response.error?.message || '插件移除断点时返回未知错误。';
                logger.error(`[MCP Tool - ${toolName}] Plugin reported error: ${errorMessage}`); // 使用 logger
                return { status: Constants.IPC_STATUS_ERROR, message: errorMessage };
            }
        } catch (error: any) {
            const commErrorMessage = error?.message || '与插件通信失败或发生未知错误。';
            const fullCommMessage = `移除断点时发生通信错误: ${commErrorMessage}`;
            logger.error(`[MCP Tool - ${toolName}] Communication error:`, error); // 使用 logger
            return { status: Constants.IPC_STATUS_ERROR, message: fullCommMessage };
        }
    }
};