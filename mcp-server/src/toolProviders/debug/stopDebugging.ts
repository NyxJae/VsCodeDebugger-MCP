import { z } from 'zod';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
import * as Constants from '../../constants';
import { IPC_STATUS_SUCCESS, IPC_STATUS_ERROR } from '../../constants';
import { StopDebuggingPayload } from '../../types';

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
    try {
        const response: PluginResponse = await sendRequestToPlugin({
             command: Constants.IPC_COMMAND_STOP_DEBUGGING,
             payload: { sessionId: args.sessionId }
        });

        if (response.status === IPC_STATUS_SUCCESS) {
            return { status: 'success', message: response.payload?.message || '已成功发送停止调试会话的请求。' };
        } else {
            return { status: 'error', message: response.error?.message || '停止调试时插件端返回未知错误。' };
        }
    } catch (error: any) {
        console.error('[MCP Server] Error communicating with plugin for stopDebugging:', error);
        return { status: 'error', message: `与插件通信失败: ${error.message}` };
    }
}