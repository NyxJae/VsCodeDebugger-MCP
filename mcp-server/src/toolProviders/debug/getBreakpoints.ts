import { z } from 'zod';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
import * as Constants from '../../constants';
import { logger } from '../../config'; // 导入 logger

// 输入 Schema (保持不变)
export const getBreakpointsSchema = z.object({}).describe("获取当前设置的所有断点，无需参数");

export type GetBreakpointsArgs = z.infer<typeof getBreakpointsSchema>;

// --- 新增：定义单个断点信息的 Schema (与 setBreakpoint 类似，但根据 get 的实际返回调整) ---
// 假设 getBreakpoints 返回的结构与 setBreakpoint 确认时的结构一致
const BreakpointInfoSchema = z.object({
    id: z.string().optional().describe("断点的唯一标识符"),
    verified: z.boolean().describe("断点是否已被验证"),
    source: z.object({
        path: z.string().describe("断点所在文件的绝对路径")
    }).optional().describe("断点源文件信息"), // Source might be optional if breakpoint is unverified/pending
    line: z.number().int().positive().describe("断点设置的行号"),
    column: z.number().int().positive().optional().describe("断点设置的列号"),
    condition: z.string().optional().describe("断点条件"),
    hitCondition: z.string().optional().describe("断点命中条件"),
    logMessage: z.string().optional().describe("日志断点消息"),
    message: z.string().optional().describe("与断点相关的消息"),
    timestamp: z.string().datetime().optional().describe("断点创建/更新的时间戳") // Timestamp might be per-breakpoint or global
}).passthrough(); // Allow other potential fields from the debug adapter

// --- 新增：定义工具执行结果的 Schema ---
const GetBreakpointsOutputSchema = z.object({
    status: z.enum([Constants.IPC_STATUS_SUCCESS, Constants.IPC_STATUS_ERROR]),
    timestamp: z.string().datetime().optional().describe("获取断点列表的时间戳 (ISO 8601)"), // Make timestamp optional as well
    breakpoints: z.array(BreakpointInfoSchema).optional().describe("成功时返回的断点信息列表"),
    message: z.string().optional().describe("失败时返回的错误信息"),
}).describe("获取断点列表工具的执行结果");


// --- 新增：定义工具对象 ---
export const getBreakpointsTool = {
    name: Constants.TOOL_GET_BREAKPOINTS,
    description: "获取当前在 VS Code 中设置的所有断点。",
    inputSchema: getBreakpointsSchema,
    outputSchema: GetBreakpointsOutputSchema,

    async execute(
        args: GetBreakpointsArgs,
        context?: { transport?: { sessionId: string } } // 添加 context 参数以获取 sessionId
    ): Promise<z.infer<typeof GetBreakpointsOutputSchema>> {
        const toolName = this.name;
        logger.info(`[MCP Tool - ${toolName}] Executing...`); // 使用 logger

        try {
            const pluginResponse: PluginResponse = await sendRequestToPlugin({ command: Constants.IPC_COMMAND_GET_BREAKPOINTS, payload: {} });

            // --- 新增 IPC 响应处理日志 ---
            const sessionId = context?.transport?.sessionId;
            const payloadSnippet = JSON.stringify(pluginResponse.payload).substring(0, 100);

            if (sessionId) {
                logger.debug(`[MCP Server - ${toolName}] Received IPC response for requestId ${pluginResponse.requestId}, status: ${pluginResponse.status}. Preparing SSE send to sessionId: ${sessionId}. Payload snippet: ${payloadSnippet}...`);
            } else {
                // 如果没有 sessionId，记录警告。这可能表示请求不是通过标准 SSE 流程触发，或者 context 未正确传递。
                logger.warn(`[MCP Server - ${toolName}] No active transport or sessionId found in context for requestId ${pluginResponse.requestId} after receiving IPC response. Cannot confirm target SSE session.`);
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
                    const errorMessage = `插件返回的数据格式无效: ${validationError.message}`;
                    logger.error(`[MCP Tool - ${toolName}] ${errorMessage}`, pluginResponse.payload); // 使用 logger
                    return { status: Constants.IPC_STATUS_ERROR, message: errorMessage };
                 }
            } else if (pluginResponse.status === Constants.IPC_STATUS_ERROR) {
                const errorMessage = pluginResponse.error?.message || '插件获取断点列表失败，未指定错误。';
                logger.error(`[MCP Tool - ${toolName}] Plugin reported error: ${errorMessage}`); // 使用 logger
                return { status: Constants.IPC_STATUS_ERROR, message: errorMessage };
            } else {
                const errorMessage = '插件返回成功但响应负载格式意外或缺失。';
                logger.error(`[MCP Tool - ${toolName}] ${errorMessage}`, pluginResponse.payload); // 使用 logger
                return { status: Constants.IPC_STATUS_ERROR, message: errorMessage };
            }

        } catch (error: any) {
            const errorMessage = error?.message || "获取断点列表时发生通信错误或意外问题。";
            logger.error(`[MCP Tool - ${toolName}] Error: ${errorMessage}`, error); // 使用 logger
            return { status: Constants.IPC_STATUS_ERROR, message: `与 VS Code 扩展通信时出错: ${errorMessage}` };
        }
    }
};