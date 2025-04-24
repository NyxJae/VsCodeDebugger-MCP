import { z } from 'zod';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator'; // 修正导入
import * as Constants from '../../constants'; // 导入服务器端常量
import { IPC_STATUS_SUCCESS, IPC_STATUS_ERROR } from '../../constants'; // 显式导入状态常量
import { StopDebuggingPayload } from '../../types'; // 导入类型

/**
 * Zod schema for the stop_debugging tool.
 * Accepts an optional sessionId.
 */
export const stopDebuggingSchema = z.object({
    sessionId: z.string().optional(),
});

/**
 * Handles the 'stop_debugging' MCP tool request.
 * Sends a command to the VS Code extension plugin to stop the current debugging session.
 *
 *
 * @param args - The arguments for the tool, including an optional sessionId.
 * @returns A promise resolving to an object indicating the status (success/error) and a message.
 */
export async function handleStopDebugging(
    args: z.infer<typeof stopDebuggingSchema> // 使用 z.infer 保持与 schema 同步
): Promise<{ status: string; message: string }> {
    console.log('[MCP Server] handleStopDebugging called with args:', args); // 记录传入的参数
    try { // 添加缺失的 try 关键字
        // 向插件发送停止调试的命令
        // 使用从 mcp-server/src/constants.ts 导入的常量
        const response: PluginResponse = await sendRequestToPlugin({
             command: Constants.IPC_COMMAND_STOP_DEBUGGING, // 使用服务器端常量
             payload: { sessionId: args.sessionId } // 传递 sessionId
        });
        console.log('[MCP Server] Received response from plugin for stopDebugging:', response);

        // 根据插件的响应状态构造返回结果
        if (response.status === IPC_STATUS_SUCCESS) {
            return { status: 'success', message: response.payload?.message || '已成功发送停止调试会话的请求。' };
        } else {
            // 如果插件返回错误，使用插件提供的错误消息，否则提供通用错误消息
            return { status: 'error', message: response.error?.message || '停止调试时插件端返回未知错误。' };
        }
    } catch (error: any) {
        // 处理与插件通信时发生的异常
        console.error('[MCP Server] Error communicating with plugin for stopDebugging:', error);
        // 返回通信错误信息
        return { status: 'error', message: `与插件通信失败: ${error.message}` };
    }
}

// 导出 schema 和处理函数供 server.ts 使用
// 按照 CurrentTask.md 第 53 行的要求，导出 schema 和 handler