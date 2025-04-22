import * as path from 'path';
import { z } from 'zod'; // 导入 zod
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator'; // 调整导入路径
import * as Constants from '../../constants'; // 导入常量

// 定义 set_breakpoint 工具的输入参数 Schema (使用 Zod)
export const setBreakpointSchema = z.object({
    file_path: z.string().min(1, "File path cannot be empty."),
    line_number: z.number().int().positive("Line number must be a positive integer."),
    column_number: z.number().int().positive("Column number must be a positive integer.").optional(),
    condition: z.string().optional(),
    hit_condition: z.string().optional(),
    log_message: z.string().optional(),
});

// 从 Schema 推断输入参数类型
export type SetBreakpointArgs = z.infer<typeof setBreakpointSchema>;

// 定义 set_breakpoint 工具的返回值类型 (符合 MCP SDK 要求)
type SetBreakpointResult =
    | { status: typeof Constants.STATUS_SUCCESS; content: { type: "text", text: string }[] } // 成功时返回 breakpoint 信息的 JSON 字符串
    | { status: typeof Constants.STATUS_ERROR; message: string; content: { type: "text", text: string }[]; isError: true }; // 失败时返回错误信息

/**
 * 处理 set_breakpoint MCP 工具请求。
 * 向 VS Code 插件发送请求以设置断点。
 */
export async function handleSetBreakpoint(
    args: SetBreakpointArgs, // 恢复为 SetBreakpointArgs 类型
    extra: any
): Promise<SetBreakpointResult> {
    console.log('[MCP Server] Handling set_breakpoint request...');

    // 参数校验由 MCP SDK 使用 setBreakpointSchema 完成。

    // --- 开始修改 ---
    // 1. 获取并校验工作区路径
    const workspacePath = process.env.VSCODE_WORKSPACE_PATH;
    if (!workspacePath) {
        const errorMsg = '无法获取 VS Code 工作区路径 (VSCODE_WORKSPACE_PATH 环境变量未设置)。';
        console.error(`[MCP Server] Error in handleSetBreakpoint: ${errorMsg}`);
        return {
            status: Constants.STATUS_ERROR,
            message: errorMsg,
            content: [{ type: "text", text: errorMsg }],
            isError: true
        };
    }
    console.log(`[MCP Server] Workspace path for breakpoint: ${workspacePath}`);

    // 2. 解析文件路径
    let absoluteFilePath = args.file_path; // 默认使用原始路径
    if (!path.isAbsolute(args.file_path)) {
        console.log(`[MCP Server] Resolving relative path: ${args.file_path} against workspace: ${workspacePath}`);
        absoluteFilePath = path.resolve(workspacePath, args.file_path);
        console.log(`[MCP Server] Resolved to absolute path: ${absoluteFilePath}`);
    } else {
        console.log(`[MCP Server] Path is already absolute: ${args.file_path}`);
    }

    // 3. 更新传递给插件的 payload
    const payloadForPlugin = {
        ...args, // 包含 line_number, column_number 等其他参数
        file_path: absoluteFilePath // 使用解析后的绝对路径
    };
    // --- 结束修改 ---

    try {
        // 调用 pluginCommunicator 向插件发送设置断点请求
        // 使用常量作为命令字符串
        const pluginResponse: PluginResponse = await sendRequestToPlugin({ type: Constants.IPC_COMMAND_SET_BREAKPOINT, payload: payloadForPlugin }); // 使用更新后的 payload

        if (pluginResponse.status === Constants.STATUS_SUCCESS && pluginResponse.payload && pluginResponse.payload.breakpoint) {
            // 插件成功设置断点并返回信息
            console.log('[MCP Server] Successfully set breakpoint via plugin.');
            // 确保返回的 breakpoint 结构符合预期
            const resultBreakpoint = pluginResponse.payload.breakpoint;
            if (
                typeof resultBreakpoint === 'object' && resultBreakpoint !== null &&
                'verified' in resultBreakpoint && typeof resultBreakpoint.verified === 'boolean' &&
                'source' in resultBreakpoint && typeof resultBreakpoint.source === 'object' && resultBreakpoint.source !== null && 'path' in resultBreakpoint.source && typeof resultBreakpoint.source.path === 'string' &&
                'line' in resultBreakpoint && typeof resultBreakpoint.line === 'number' &&
                'timestamp' in resultBreakpoint && typeof resultBreakpoint.timestamp === 'string'
                // id, column, message 是可选的，不强制检查类型，但要确保存在时传递
            ) {
                 // 构造符合 SDK 要求的成功响应
                 const breakpointInfo = {
                     id: resultBreakpoint.id, // 可能为 undefined
                     verified: resultBreakpoint.verified,
                     source: { path: resultBreakpoint.source.path },
                     line: resultBreakpoint.line,
                     column: resultBreakpoint.column, // 可能为 undefined
                     message: resultBreakpoint.message, // 可能为 undefined
                     timestamp: resultBreakpoint.timestamp
                 };
                 const successText = JSON.stringify(breakpointInfo, null, 2);
                 return {
                     status: Constants.STATUS_SUCCESS,
                     content: [{ type: "text", text: successText }]
                 };
             } else {
                 // 插件返回的 payload.breakpoint 结构不符合预期
                 const errorMessage = 'Plugin returned breakpoint data in an unexpected format.';
                 console.error(`[MCP Server] ${errorMessage}`, pluginResponse.payload.breakpoint);
                 return {
                     status: Constants.STATUS_ERROR,
                     message: errorMessage,
                     content: [{ type: "text", text: errorMessage }],
                     isError: true
                 };
             }
         } else if (pluginResponse.status === Constants.STATUS_ERROR) {
             // 插件返回失败状态
             const errorMessage = pluginResponse.error?.message || 'Plugin failed to set breakpoint with an unspecified error.';
             console.error(`[MCP Server] Plugin reported error setting breakpoint: ${errorMessage}`);
             return {
                 status: Constants.STATUS_ERROR,
                 message: errorMessage, // 使用提取的字符串消息
                 content: [{ type: "text", text: errorMessage }], // 使用提取的字符串消息
                 isError: true
             };
         } else {
              // 插件返回成功但 payload 结构不正确
              const errorMessage = 'Plugin returned success but payload format was unexpected.';
              console.error(`[MCP Server] ${errorMessage}`, pluginResponse.payload);
              return {
                  status: Constants.STATUS_ERROR,
                  message: errorMessage,
                  content: [{ type: "text", text: errorMessage }],
                  isError: true
              };
         }

     } catch (error: any) {
         // IPC 通信失败 (例如超时) 或其他意外错误
         const errorMessage = error?.message || "Failed to set breakpoint due to communication error or unexpected issue.";
         console.error(`[MCP Server] Error setting breakpoint: ${errorMessage}`);
         return {
             status: Constants.STATUS_ERROR, // 使用常量
             message: errorMessage, // 使用提取的字符串消息
             content: [{ type: "text", text: errorMessage }], // 使用提取的字符串消息
             isError: true
         };
     }
 }