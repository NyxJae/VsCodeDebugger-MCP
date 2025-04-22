import { z } from 'zod'; // 导入 zod
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator'; // 调整导入路径
import * as Constants from '../../constants'; // 导入常量

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
): Promise<{ status: typeof Constants.STATUS_SUCCESS; content: { type: "text", text: string }[] } | { status: typeof Constants.STATUS_ERROR; message: string; content: { type: "text", text: string }[]; isError: true }> { // 明确返回类型以匹配 SDK
    console.log('[MCP Server] Handling get_breakpoints request...');

    try {
        // 调用 pluginCommunicator 向插件发送获取断点请求
        // 使用常量作为命令字符串
        const pluginResponse: PluginResponse = await sendRequestToPlugin({ type: Constants.IPC_COMMAND_GET_BREAKPOINTS, payload: {} }); // 无需 payload

        console.log('[MCP Server] Received response from extension for get_breakpoints:', JSON.stringify(pluginResponse, null, 2));

        if (pluginResponse.status === Constants.STATUS_SUCCESS && pluginResponse.payload) {
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
                    status: Constants.STATUS_SUCCESS,
                    content: [{ type: "text", text: successText }]
                };
            } else {
                // 插件返回的 payload 结构不符合预期
                const errorMessage = 'Plugin returned breakpoint data in an unexpected format.';
                console.error(`[MCP Server] ${errorMessage}`, pluginResponse.payload);
                return {
                    status: Constants.STATUS_ERROR,
                    message: errorMessage,
                    content: [{ type: "text", text: errorMessage }], // 添加 content
                    isError: true // 添加 isError
                };
            }
        } else if (pluginResponse.status === Constants.STATUS_ERROR) {
            // 插件返回失败状态
            const errorMessage = pluginResponse.error?.message || 'Plugin failed to get breakpoints with an unspecified error.';
            console.error(`[MCP Server] Plugin reported error getting breakpoints: ${errorMessage}`);
            return {
                status: Constants.STATUS_ERROR,
                message: errorMessage,
                content: [{ type: "text", text: errorMessage }], // 添加 content
                isError: true // 添加 isError
            };
        } else {
            // 插件返回成功但 payload 结构不正确或缺失
            const errorMessage = 'Plugin returned success but payload format was unexpected or missing.';
            console.error(`[MCP Server] ${errorMessage}`, pluginResponse.payload);
            return {
                status: Constants.STATUS_ERROR,
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
            status: Constants.STATUS_ERROR, // 使用常量
            message: `Error communicating with VS Code extension: ${errorMessage}`,
            content: [{ type: "text", text: `Error communicating with VS Code extension: ${errorMessage}` }], // 添加 content
            isError: true // 添加 isError
        };
    }
}