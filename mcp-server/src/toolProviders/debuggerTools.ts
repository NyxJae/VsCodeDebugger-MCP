import * as fs from 'fs/promises'; // 使用 promises API
import * as path from 'path';
import { z } from 'zod'; // 导入 zod
import { sendRequestToPlugin, PluginResponse } from '../pluginCommunicator'; // 导入 IPC 通信函数和类型

// import { McpToolExtra } from '@modelcontextprotocol/sdk'; // 确认 SDK 是否导出此类型，若无则省略或自定义

// --- get_debugger_configurations 相关定义 ---

// 定义期望的 launch.json 配置项结构 (至少包含必要的字段)
interface LaunchConfiguration {
    name: string;
    type: string;
    request: string;
    [key: string]: any; // 允许其他任意属性
}

// 定义期望的 launch.json 顶层结构
interface LaunchJson {
    version?: string; // version 字段通常存在但可选
    configurations: LaunchConfiguration[];
}

// 定义 get_debugger_configurations 工具处理函数的类型
type GetDebuggerConfigurationsArgs = Record<string, never>; // 空对象表示无输入参数
type GetDebuggerConfigurationsResult =
    | { status: 'success'; content: { type: "text", text: string }[] }
    | { status: 'error'; message: string; content: { type: "text", text: string }[]; isError: true };

/**
 * 处理 get_debugger_configurations MCP 工具请求。
 * 读取 VS Code 工作区的 .vscode/launch.json 文件并返回其配置。
 */
export async function handleGetDebuggerConfigurations(
    args: GetDebuggerConfigurationsArgs,
    extra: any
): Promise<GetDebuggerConfigurationsResult> {
    console.log('[MCP Server] Handling get_debugger_configurations request...');

    const workspacePath = process.env.VSCODE_WORKSPACE_PATH;

    if (!workspacePath) {
        const errorMsg = '无法获取 VS Code 工作区路径，请确保插件已正确设置 VSCODE_WORKSPACE_PATH 环境变量。';
        console.error(`[MCP Server] Error: ${errorMsg}`);
        return { status: 'error', message: errorMsg, content: [{ type: "text", text: errorMsg }], isError: true };
    }
    console.log(`[MCP Server] Workspace path received: ${workspacePath}`);

    const launchJsonPath = path.join(workspacePath, '.vscode', 'launch.json');
    console.log(`[MCP Server] Attempting to read launch.json from: ${launchJsonPath}`);

    try {
        const fileContent = await fs.readFile(launchJsonPath, 'utf-8');
        console.log('[MCP Server] Successfully read launch.json content.');

        try {
            const jsonStringWithoutComments = fileContent.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
            const parsedJson: unknown = JSON.parse(jsonStringWithoutComments);
            console.log('[MCP Server] Successfully parsed launch.json content (after removing comments).');

            if (
                typeof parsedJson === 'object' &&
                parsedJson !== null &&
                'configurations' in parsedJson &&
                Array.isArray((parsedJson as LaunchJson).configurations)
            ) {
                const launchJson = parsedJson as LaunchJson;
                const validConfigurations = launchJson.configurations.filter(
                    config => typeof config.name === 'string' && typeof config.type === 'string' && typeof config.request === 'string'
                );
                const resultConfigurations = validConfigurations.map(config => ({ ...config }));

                console.log(`[MCP Server] Found ${resultConfigurations.length} valid configurations.`);
                const configurationsText = JSON.stringify(resultConfigurations, null, 2);
                return { status: 'success', content: [{ type: "text", text: configurationsText }] };
            } else {
                const errorMsg = 'launch.json 文件格式错误：缺少有效的 "configurations" 数组或结构不正确。';
                console.error(`[MCP Server] Error: ${errorMsg}`);
                return { status: 'error', message: errorMsg, content: [{ type: "text", text: errorMsg }], isError: true };
            }
        } catch (parseError) {
            if (parseError instanceof SyntaxError) {
                const errorMsg = `launch.json 文件格式错误: ${parseError.message}`;
                console.error(`[MCP Server] Error parsing launch.json: ${errorMsg}`);
                return { status: 'error', message: errorMsg, content: [{ type: "text", text: errorMsg }], isError: true };
            }
            const errorMsg = `解析 launch.json 时发生意外错误: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
            console.error(`[MCP Server] ${errorMsg}`);
            return { status: 'error', message: errorMsg, content: [{ type: "text", text: errorMsg }], isError: true };
        }
    } catch (readError: any) {
        if (readError.code === 'ENOENT') {
            const errorMsg = `无法在 ${workspacePath}${path.sep}.vscode${path.sep} 目录下找到 launch.json 文件。`;
            console.warn(`[MCP Server] ${errorMsg}`);
            return { status: 'error', message: errorMsg, content: [{ type: "text", text: errorMsg }], isError: true };
        } else {
            const errorMsg = `读取 launch.json 文件时出错: ${readError.message}`;
            console.error(`[MCP Server] Error reading launch.json: ${errorMsg}`);
            return { status: 'error', message: errorMsg, content: [{ type: "text", text: errorMsg }], isError: true };
        }
    }
}

// --- set_breakpoint 相关定义 ---

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
// 注意：不再导出 SetBreakpointResult，直接在函数签名中使用 SDK 期望的类型
type SetBreakpointResult =
    | { status: 'success'; content: { type: "text", text: string }[] } // 成功时返回 breakpoint 信息的 JSON 字符串
    | { status: 'error'; message: string; content: { type: "text", text: string }[]; isError: true }; // 失败时返回错误信息

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
            status: 'error',
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
        // 'setBreakpoint' 是自定义的命令字符串，需要与插件端监听的命令一致
        // 使用 type 字段（pluginCommunicator 内部会映射到 command），并传递更新后的 payloadForPlugin
        const pluginResponse: PluginResponse = await sendRequestToPlugin({ type: 'setBreakpoint', payload: payloadForPlugin }); // 使用更新后的 payload

        if (pluginResponse.status === 'success' && pluginResponse.payload && pluginResponse.payload.breakpoint) {
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
                     status: "success",
                     content: [{ type: "text", text: successText }]
                 };
             } else {
                 // 插件返回的 payload.breakpoint 结构不符合预期
                 const errorMessage = 'Plugin returned breakpoint data in an unexpected format.';
                 console.error(`[MCP Server] ${errorMessage}`, pluginResponse.payload.breakpoint);
                 return {
                     status: "error",
                     message: errorMessage,
                     content: [{ type: "text", text: errorMessage }],
                     isError: true
                 };
             }
         } else if (pluginResponse.status === 'error') {
             // 插件返回失败状态
             const errorMessage = pluginResponse.error?.message || 'Plugin failed to set breakpoint with an unspecified error.';
             console.error(`[MCP Server] Plugin reported error setting breakpoint: ${errorMessage}`);
             return {
                 status: "error",
                 message: errorMessage, // 使用提取的字符串消息
                 content: [{ type: "text", text: errorMessage }], // 使用提取的字符串消息
                 isError: true
             };
         } else {
              // 插件返回成功但 payload 结构不正确
              const errorMessage = 'Plugin returned success but payload format was unexpected.';
              console.error(`[MCP Server] ${errorMessage}`, pluginResponse.payload);
              return {
                  status: "error",
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
             status: "error",
             message: errorMessage, // 使用提取的字符串消息
             content: [{ type: "text", text: errorMessage }], // 使用提取的字符串消息
             isError: true
         };
     }
 }
 
 // --- get_breakpoints 相关定义 ---
 
 // 定义 get_breakpoints 工具的输入参数 Schema (无参数)
 export const getBreakpointsSchema = z.object({});
 
 // 从 Schema 推断输入参数类型
 export type GetBreakpointsArgs = z.infer<typeof getBreakpointsSchema>;
 
 // 定义 get_breakpoints 工具的返回值类型 (符合 ProjectBrief.md 规范)
 // 注意：直接在函数签名中使用 SDK 期望的 ToolResult 类型
 
 /**
  * 处理 get_breakpoints MCP 工具请求。
  * 向 VS Code 插件发送请求以获取所有断点。
  */
 export async function handleGetBreakpoints(
     args: GetBreakpointsArgs, // 使用推断的类型
     extra: any
 ): Promise<{ status: 'success'; content: { type: "text", text: string }[] } | { status: 'error'; message: string; content: { type: "text", text: string }[]; isError: true }> { // 明确返回类型以匹配 SDK
     console.log('[MCP Server] Handling get_breakpoints request...');
 
     try {
         // 调用 pluginCommunicator 向插件发送获取断点请求
         // 'getBreakpoints' 是自定义的命令字符串，需要与插件端监听的命令一致
         const pluginResponse: PluginResponse = await sendRequestToPlugin({ type: 'getBreakpoints', payload: {} }); // 无需 payload
 
         console.log('[MCP Server] Received response from extension for get_breakpoints:', JSON.stringify(pluginResponse, null, 2));
 
         if (pluginResponse.status === 'success' && pluginResponse.payload) {
             // 插件成功获取断点并返回信息
             const { timestamp, breakpoints } = pluginResponse.payload;
 
             // 验证响应结构是否符合预期 (根据 ProjectBrief.md)
             if (typeof timestamp === 'string' && Array.isArray(breakpoints)) {
                 console.log('[MCP Server] Successfully received breakpoints from plugin.');
                 // 构建符合 SDK 要求的成功响应
                 const successPayload = {
                     timestamp: timestamp,
                     breakpoints: breakpoints,
                 };
                 const successText = JSON.stringify(successPayload, null, 2);
                 return {
                     status: 'success',
                     content: [{ type: "text", text: successText }]
                 };
             } else {
                 // 插件返回的 payload 结构不符合预期
                 const errorMessage = 'Plugin returned breakpoint data in an unexpected format.';
                 console.error(`[MCP Server] ${errorMessage}`, pluginResponse.payload);
                 return {
                     status: 'error',
                     message: errorMessage,
                     content: [{ type: "text", text: errorMessage }], // 添加 content
                     isError: true // 添加 isError
                 };
             }
         } else if (pluginResponse.status === 'error') {
             // 插件返回失败状态
             const errorMessage = pluginResponse.error?.message || 'Plugin failed to get breakpoints with an unspecified error.';
             console.error(`[MCP Server] Plugin reported error getting breakpoints: ${errorMessage}`);
             return {
                 status: 'error',
                 message: errorMessage,
                 content: [{ type: "text", text: errorMessage }], // 添加 content
                 isError: true // 添加 isError
             };
         } else {
             // 插件返回成功但 payload 结构不正确或缺失
             const errorMessage = 'Plugin returned success but payload format was unexpected or missing.';
             console.error(`[MCP Server] ${errorMessage}`, pluginResponse.payload);
             return {
                 status: 'error',
                 message: errorMessage,
                 content: [{ type: "text", text: errorMessage }], // 添加 content
                 isError: true // 添加 isError
             };
         }
 
     } catch (error: any) {
         // IPC 通信失败 (例如超时) 或其他意外错误
         const errorMessage = error?.message || "Failed to get breakpoints due to communication error or unexpected issue.";
         console.error(`[MCP Server] Error getting breakpoints: ${errorMessage}`);
         return {
             status: 'error',
             message: `Error communicating with VS Code extension: ${errorMessage}`,
             content: [{ type: "text", text: `Error communicating with VS Code extension: ${errorMessage}` }], // 添加 content
             isError: true // 添加 isError
         };
     }
 }