import * as path from 'path';
import { z } from 'zod';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
import * as Constants from '../../constants';
import { logger } from '../../config'; // 导入 logger
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'; // 导入 RequestHandlerExtra

// 输入 Schema (保持不变)
export const setBreakpointSchema = z.object({
    file_path: z.string().min(1, "File path cannot be empty.").describe("The path to the file where the breakpoint should be set (can be relative or absolute)"),
    line_number: z.number().int().positive("Line number must be a positive integer.").describe("The 1-based line number where the breakpoint should be set"),
    column_number: z.number().int().positive("Column number must be a positive integer.").optional().describe("The 1-based column number where the breakpoint should be set"),
    condition: z.string().optional().describe("An expression that must evaluate to true for the breakpoint to be hit"),
    hit_condition: z.string().optional().describe("The hit count condition for the breakpoint to be hit"),
    log_message: z.string().optional().describe("A message to be logged when the breakpoint is hit (logpoint)"),
});

export type SetBreakpointArgs = z.infer<typeof setBreakpointSchema>;

// --- 新增：定义工具执行结果的 Schema ---
const BreakpointInfoSchema = z.object({
    id: z.string().optional().describe("The unique identifier of the breakpoint (assigned by the debug adapter)"), // ID might not be present in plugin response, set to optional
    verified: z.boolean().describe("Whether the breakpoint has been verified and successfully set by the debugger"),
    source: z.object({
        path: z.string().describe("The absolute path of the file where the breakpoint is located")
    }).describe("Source file information for the breakpoint"),
    line: z.number().int().positive().describe("The actual line number where the breakpoint was set"),
    column: z.number().int().positive().optional().describe("The actual column number where the breakpoint was set"),
    message: z.string().optional().describe("A message related to the breakpoint (e.g., reason for not being verified)"),
    timestamp: z.string().datetime().describe("Timestamp when the breakpoint was set or updated (ISO 8601)") // Assuming plugin returns ISO format
}).describe("Information about the successfully set breakpoint");

const SetBreakpointOutputSchema = z.object({
    status: z.enum([Constants.IPC_STATUS_SUCCESS, Constants.IPC_STATUS_ERROR]),
    breakpoint: BreakpointInfoSchema.optional().describe("Breakpoint information returned on success"),
    message: z.string().optional().describe("Error message returned on failure"),
}).describe("Execution result of the set breakpoint tool");

// --- 新增：定义工具对象 ---
export const setBreakpointTool = {
    name: Constants.TOOL_SET_BREAKPOINT,
    description: "Sets a breakpoint at the specified line in the given file.",
    inputSchema: setBreakpointSchema,
    outputSchema: SetBreakpointOutputSchema,

    async execute(
        args: SetBreakpointArgs,
        extra?: RequestHandlerExtra // 修改参数为 extra
    ): Promise<z.infer<typeof SetBreakpointOutputSchema>> {
        const toolName = this.name; // 在日志中使用
        logger.info(`[MCP Tool - ${toolName}] Executing with args:`, args); // 使用 logger

        const workspacePath = process.env.VSCODE_WORKSPACE_PATH;
        if (!workspacePath) {
            const errorMsg = '无法获取 VS Code 工作区路径 (VSCODE_WORKSPACE_PATH 环境变量未设置)。';
            logger.error(`[MCP Tool - ${toolName}] Error: ${errorMsg}`); // 使用 logger
            return { status: Constants.IPC_STATUS_ERROR, message: errorMsg };
        }

        let absoluteFilePath = args.file_path;
        if (!path.isAbsolute(args.file_path)) {
            absoluteFilePath = path.resolve(workspacePath, args.file_path);
            logger.debug(`[MCP Tool - ${toolName}] Resolved relative path '${args.file_path}' to absolute path '${absoluteFilePath}'`); // 使用 logger
        }

        const payloadForPlugin = {
            ...args,
            file_path: absoluteFilePath
        };

        try {
            logger.debug(`[MCP Tool - ${toolName}] Sending request to plugin:`, payloadForPlugin); // 使用 logger
            const pluginResponse: PluginResponse = await sendRequestToPlugin({ command: Constants.IPC_COMMAND_SET_BREAKPOINT, payload: payloadForPlugin });

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

            if (pluginResponse.status === Constants.IPC_STATUS_SUCCESS && pluginResponse.payload && pluginResponse.payload.breakpoint) {
                const resultBreakpoint = pluginResponse.payload.breakpoint;

                // 尝试使用 Zod 解析插件返回的断点信息，以确保格式正确
                try {
                    const validatedBreakpoint = BreakpointInfoSchema.parse(resultBreakpoint);
                    logger.info(`[MCP Tool - ${toolName}] Breakpoint set successfully:`, validatedBreakpoint); // 使用 logger
                    return { status: Constants.IPC_STATUS_SUCCESS, breakpoint: validatedBreakpoint };
                } catch (validationError: any) {
                     const errorMessage = `Invalid breakpoint data format returned by plugin: ${validationError.message}`;
                     logger.error(`[MCP Tool - ${toolName}] ${errorMessage}`, resultBreakpoint); // 使用 logger
                     return { status: Constants.IPC_STATUS_ERROR, message: errorMessage };
                }

            } else if (pluginResponse.status === Constants.IPC_STATUS_ERROR) {
                const errorMessage = pluginResponse.error?.message || 'Plugin failed to set breakpoint, no specific error provided.';
                logger.error(`[MCP Tool - ${toolName}] Plugin reported error: ${errorMessage}`); // 使用 logger
                return { status: Constants.IPC_STATUS_ERROR, message: errorMessage };
            } else {
                const errorMessage = 'Plugin returned success but response payload format is unexpected.';
                logger.error(`[MCP Tool - ${toolName}] ${errorMessage}`, pluginResponse.payload); // 使用 logger
                return { status: Constants.IPC_STATUS_ERROR, message: errorMessage };
            }

        } catch (error: any) {
            const errorMessage = error?.message || "Communication error or unexpected issue occurred while setting breakpoint.";
            logger.error(`[MCP Tool - ${toolName}] Error: ${errorMessage}`, error); // 使用 logger
            return { status: Constants.IPC_STATUS_ERROR, message: errorMessage };
        }
    }
};