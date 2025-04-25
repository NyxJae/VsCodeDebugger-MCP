import * as path from 'path';
import { z } from 'zod';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
import * as Constants from '../../constants';

// 输入 Schema (保持不变)
export const setBreakpointSchema = z.object({
    file_path: z.string().min(1, "File path cannot be empty.").describe("要设置断点的文件路径（可以是相对路径或绝对路径）"),
    line_number: z.number().int().positive("Line number must be a positive integer.").describe("要设置断点的行号（从 1 开始）"),
    column_number: z.number().int().positive("Column number must be a positive integer.").optional().describe("要设置断点的列号（从 1 开始）"),
    condition: z.string().optional().describe("断点触发的条件表达式"),
    hit_condition: z.string().optional().describe("断点触发的命中次数条件"),
    log_message: z.string().optional().describe("断点触发时要记录的消息（日志断点）"),
});

export type SetBreakpointArgs = z.infer<typeof setBreakpointSchema>;

// --- 新增：定义工具执行结果的 Schema ---
const BreakpointInfoSchema = z.object({
    id: z.string().optional().describe("断点的唯一标识符 (由调试适配器分配)"), // ID 可能在插件响应中不存在，设为 optional
    verified: z.boolean().describe("断点是否已被调试器验证并成功设置"),
    source: z.object({
        path: z.string().describe("断点所在文件的绝对路径")
    }).describe("断点源文件信息"),
    line: z.number().int().positive().describe("断点实际设置的行号"),
    column: z.number().int().positive().optional().describe("断点实际设置的列号"),
    message: z.string().optional().describe("与断点相关的消息（例如，未验证的原因）"),
    timestamp: z.string().datetime().describe("断点设置或更新的时间戳 (ISO 8601)") // 假设插件返回 ISO 格式
}).describe("成功设置的断点信息");

const SetBreakpointOutputSchema = z.object({
    status: z.enum([Constants.IPC_STATUS_SUCCESS, Constants.IPC_STATUS_ERROR]),
    breakpoint: BreakpointInfoSchema.optional().describe("成功时返回的断点信息"),
    message: z.string().optional().describe("失败时返回的错误信息"),
}).describe("设置断点工具的执行结果");

// --- 新增：定义工具对象 ---
export const setBreakpointTool = {
    name: Constants.TOOL_SET_BREAKPOINT,
    description: "在指定文件的指定行设置一个断点。",
    inputSchema: setBreakpointSchema,
    outputSchema: SetBreakpointOutputSchema,

    async execute(
        args: SetBreakpointArgs,
        // extra: any // 如果需要 extra 参数可以取消注释
    ): Promise<z.infer<typeof SetBreakpointOutputSchema>> {
        const toolName = this.name; // 在日志中使用
        console.info(`[MCP Tool - ${toolName}] Executing with args:`, args);

        const workspacePath = process.env.VSCODE_WORKSPACE_PATH;
        if (!workspacePath) {
            const errorMsg = '无法获取 VS Code 工作区路径 (VSCODE_WORKSPACE_PATH 环境变量未设置)。';
            console.error(`[MCP Tool - ${toolName}] Error: ${errorMsg}`);
            return { status: Constants.IPC_STATUS_ERROR, message: errorMsg };
        }

        let absoluteFilePath = args.file_path;
        if (!path.isAbsolute(args.file_path)) {
            absoluteFilePath = path.resolve(workspacePath, args.file_path);
            console.debug(`[MCP Tool - ${toolName}] Resolved relative path '${args.file_path}' to absolute path '${absoluteFilePath}'`);
        }

        const payloadForPlugin = {
            ...args,
            file_path: absoluteFilePath
        };

        try {
            console.debug(`[MCP Tool - ${toolName}] Sending request to plugin:`, payloadForPlugin);
            const pluginResponse: PluginResponse = await sendRequestToPlugin({ command: Constants.IPC_COMMAND_SET_BREAKPOINT, payload: payloadForPlugin });
            console.debug(`[MCP Tool - ${toolName}] Received response from plugin:`, pluginResponse);

            if (pluginResponse.status === Constants.IPC_STATUS_SUCCESS && pluginResponse.payload && pluginResponse.payload.breakpoint) {
                const resultBreakpoint = pluginResponse.payload.breakpoint;

                // 尝试使用 Zod 解析插件返回的断点信息，以确保格式正确
                try {
                    const validatedBreakpoint = BreakpointInfoSchema.parse(resultBreakpoint);
                    console.info(`[MCP Tool - ${toolName}] Breakpoint set successfully:`, validatedBreakpoint);
                    return { status: Constants.IPC_STATUS_SUCCESS, breakpoint: validatedBreakpoint };
                } catch (validationError: any) {
                     const errorMessage = `插件返回的断点数据格式无效: ${validationError.message}`;
                     console.error(`[MCP Tool - ${toolName}] ${errorMessage}`, resultBreakpoint);
                     return { status: Constants.IPC_STATUS_ERROR, message: errorMessage };
                }

            } else if (pluginResponse.status === Constants.IPC_STATUS_ERROR) {
                const errorMessage = pluginResponse.error?.message || '插件设置断点失败，未指定错误。';
                console.error(`[MCP Tool - ${toolName}] Plugin reported error: ${errorMessage}`);
                return { status: Constants.IPC_STATUS_ERROR, message: errorMessage };
            } else {
                const errorMessage = '插件返回成功但响应负载格式意外。';
                console.error(`[MCP Tool - ${toolName}] ${errorMessage}`, pluginResponse.payload);
                return { status: Constants.IPC_STATUS_ERROR, message: errorMessage };
            }

        } catch (error: any) {
            const errorMessage = error?.message || "设置断点时发生通信错误或意外问题。";
            console.error(`[MCP Tool - ${toolName}] Error: ${errorMessage}`, error);
            return { status: Constants.IPC_STATUS_ERROR, message: errorMessage };
        }
    }
};