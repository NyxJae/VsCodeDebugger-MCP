import { z } from 'zod';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
import * as Constants from '../../constants';
import { logger } from '../../config'; // 导入 logger
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'; // 导入 RequestHandlerExtra

// 输入 Schema (保持不变)
export const getBreakpointsSchema = z.object({}).describe("Retrieves all currently set breakpoints, requires no parameters.");

export type GetBreakpointsArgs = z.infer<typeof getBreakpointsSchema>;

// --- 新增：定义单个断点信息的 Schema (与 setBreakpoint 类似，但根据 get 的实际返回调整) ---
// 假设 getBreakpoints 返回的结构与 setBreakpoint 确认时的结构一致
const BreakpointInfoSchema = z.object({
    id: z.string().optional().describe("The unique identifier of the breakpoint"),
    verified: z.boolean().describe("Whether the breakpoint has been verified"),
    source: z.object({
        path: z.string().describe("The absolute path of the file where the breakpoint is located")
    }).optional().describe("Source file information for the breakpoint"), // Source might be optional if breakpoint is unverified/pending
    line: z.number().int().positive().describe("The line number where the breakpoint is set"),
    column: z.number().int().positive().optional().describe("The column number where the breakpoint is set"),
    condition: z.string().optional().describe("The breakpoint condition"),
    hitCondition: z.string().optional().describe("The breakpoint hit condition"),
    logMessage: z.string().optional().describe("The log breakpoint message"),
    message: z.string().optional().describe("A message related to the breakpoint"),
    timestamp: z.string().datetime().optional().describe("Timestamp of breakpoint creation/update") // Timestamp might be per-breakpoint or global
}).passthrough(); // Allow other potential fields from the debug adapter

// --- 新增：定义工具执行结果的 Schema ---
const GetBreakpointsOutputSchema = z.object({
    status: z.enum([Constants.IPC_STATUS_SUCCESS, Constants.IPC_STATUS_ERROR]),
    timestamp: z.string().datetime().optional().describe("Timestamp when the breakpoint list was retrieved (ISO 8601)"), // Make timestamp optional as well
    breakpoints: z.array(BreakpointInfoSchema).optional().describe("List of breakpoint information returned on success"),
    message: z.string().optional().describe("Error message returned on failure"),
}).describe("Execution result of the get breakpoints tool");


// --- 新增：定义工具对象 ---
export const getBreakpointsTool = {
    name: Constants.TOOL_GET_BREAKPOINTS,
    description: "Retrieves all breakpoints currently set in VS Code.",
    inputSchema: getBreakpointsSchema,
    outputSchema: GetBreakpointsOutputSchema,

    async execute(
        args: GetBreakpointsArgs,
        extra?: RequestHandlerExtra // 修改参数为 extra
    ): Promise<z.infer<typeof GetBreakpointsOutputSchema>> {
        const toolName = this.name;
        logger.info(`[MCP Tool - ${toolName}] Executing...`); // 使用 logger

        try {
            const pluginResponse: PluginResponse = await sendRequestToPlugin({ command: Constants.IPC_COMMAND_GET_BREAKPOINTS, payload: {} });

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
                 // 尝试使用 Zod 解析整个 payload
                try {
                    // We expect payload to match { timestamp: string, breakpoints: array }
                    const validatedPayload = z.object({
                        timestamp: z.string().datetime(),
                        breakpoints: z.array(BreakpointInfoSchema) // Validate the array items
                    }).parse(pluginResponse.payload);

                    logger.info(`[MCP Tool - ${toolName}] Successfully retrieved ${validatedPayload.breakpoints.length} breakpoints.`); // 使用 logger
                    return {
                        status: Constants.IPC_STATUS_SUCCESS,
                        timestamp: validatedPayload.timestamp,
                        breakpoints: validatedPayload.breakpoints
                    };
                 } catch (validationError: any) {
                    const errorMessage = `Invalid data format returned by plugin: ${validationError.message}`;
                    logger.error(`[MCP Tool - ${toolName}] ${errorMessage}`, pluginResponse.payload); // 使用 logger
                    return { status: Constants.IPC_STATUS_ERROR, message: errorMessage };
                 }
            } else if (pluginResponse.status === Constants.IPC_STATUS_ERROR) {
                const errorMessage = pluginResponse.error?.message || 'Plugin failed to get breakpoint list, no specific error provided.';
                logger.error(`[MCP Tool - ${toolName}] Plugin reported error: ${errorMessage}`); // 使用 logger
                return { status: Constants.IPC_STATUS_ERROR, message: errorMessage };
            } else {
                const errorMessage = 'Plugin returned success but response payload format is unexpected or missing.';
                logger.error(`[MCP Tool - ${toolName}] ${errorMessage}`, pluginResponse.payload); // 使用 logger
                return { status: Constants.IPC_STATUS_ERROR, message: errorMessage };
            }

        } catch (error: any) {
            const errorMessage = error?.message || "Communication error or unexpected issue occurred while getting breakpoint list.";
            logger.error(`[MCP Tool - ${toolName}] Error: ${errorMessage}`, error); // 使用 logger
            return { status: Constants.IPC_STATUS_ERROR, message: `Error communicating with VS Code extension: ${errorMessage}` };
        }
    }
};