import { z } from 'zod';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator'; // 导入 IPC 通信函数
import * as Constants from '../../constants'; // 导入本地常量
import type { StartDebuggingRequestPayload, StartDebuggingResponsePayload } from '../../types'; // 导入本地类型

// 定义 start_debugging 工具的输入参数 Schema
export const startDebuggingSchema = z.object({
  configuration_name: z.string().min(1, "Configuration name cannot be empty.").describe("launch.json 中的配置名称"),
  no_debug: z.boolean().optional().default(false).describe("是否以非调试模式启动"),
});

// 从 Schema 推断输入参数类型
export type StartDebuggingArgs = z.infer<typeof startDebuggingSchema>;

// 定义 start_debugging 工具的返回值类型 (直接使用插件端定义的联合类型)
type StartDebuggingResult = StartDebuggingResponsePayload;

// 定义 MCP SDK 期望的工具返回值类型
type McpToolResult = {
    content: { type: "text", text: string }[];
    isError?: boolean;
    // _meta 字段等可以根据需要添加
};

/**
 * 处理 start_debugging MCP 工具请求。
 * 向 VS Code 插件发送请求以启动调试会话并等待首次停止或结束。
 */
export async function handleStartDebugging(
    args: StartDebuggingArgs,
    extra: any // RequestHandlerExtra (根据 SDK 调整)
): Promise<McpToolResult> { // 返回值修改为 McpToolResult
    console.log('[MCP Server] Handling start_debugging request...');

    // 参数校验由 MCP SDK 使用 startDebuggingSchema 完成。

    const payloadForPlugin: StartDebuggingRequestPayload = {
        configurationName: args.configuration_name,
        noDebug: args.no_debug,
    };

    const toolTimeout = 60000; // 设置工具层面的超时，例如 60 秒

    try {
        console.log(`[MCP Server] Sending ${Constants.IPC_COMMAND_START_DEBUGGING_REQUEST} for config: ${args.configuration_name}`); // 使用 mcp-server/src/constants.ts 中的常量
        const pluginResponse: PluginResponse<StartDebuggingResponsePayload> = await sendRequestToPlugin<StartDebuggingResponsePayload>( // 指定泛型类型
            { type: Constants.IPC_COMMAND_START_DEBUGGING_REQUEST, payload: payloadForPlugin }, // 使用 mcp-server/src/constants.ts 中的常量
            toolTimeout
        );

        console.log(`[MCP Server] Received response for start_debugging:`, pluginResponse); // 移除不存在的常量引用

        // 检查插件响应状态和负载
        if (pluginResponse.status === Constants.IPC_STATUS_SUCCESS && pluginResponse.payload) { // 使用正确的常量名
            // 插件成功处理并返回了 StartDebuggingResponsePayload
            const resultPayload = pluginResponse.payload;
            const resultText = JSON.stringify(resultPayload, null, 2);
            // 根据内部 status 判断是否为错误
            const isError = resultPayload.status !== 'stopped' && resultPayload.status !== 'completed';
            return {
                content: [{ type: "text", text: resultText }],
                isError: isError // 如果内部状态是 error/timeout/interrupted，则标记为错误
            };
        } else if (pluginResponse.status === Constants.IPC_STATUS_ERROR) { // 使用正确的常量名
            // 插件返回了错误状态
            const errorMessage = pluginResponse.error?.message || 'Plugin failed to start debugging with an unspecified error.';
            console.error(`[MCP Server] Plugin reported error during start_debugging: ${errorMessage}`);
            return {
                content: [{ type: "text", text: JSON.stringify({ status: 'error', message: errorMessage }, null, 2) }],
                isError: true
            };
        } else {
            // 插件返回成功但 payload 缺失或格式不符
            const errorMessage = 'Plugin returned success but the response payload was missing or invalid.';
            console.error(`[MCP Server] ${errorMessage}`, pluginResponse);
            return {
                content: [{ type: "text", text: JSON.stringify({ status: 'error', message: errorMessage }, null, 2) }],
                isError: true
            };
        }

    } catch (error: any) {
        // IPC 通信失败 (例如超时) 或其他意外错误
        console.error(`[MCP Server] Error during start_debugging communication:`, error);
        let errorStatus: StartDebuggingResponsePayload['status'] = 'error';
        let errorMessage = `MCP Server Error: ${error.message || '未知通信错误'}`;
        if (error.message?.includes('timed out')) {
            errorStatus = 'timeout';
            errorMessage = `MCP Server: 等待插件响应超时 (${toolTimeout}ms)。`;
        }
        return {
            content: [{ type: "text", text: JSON.stringify({ status: errorStatus, message: errorMessage }, null, 2) }],
            isError: true
        };
    }
}