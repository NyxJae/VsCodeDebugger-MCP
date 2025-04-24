import { z } from 'zod';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
import * as Constants from '../../constants';

export const getBreakpointsSchema = z.object({});

export type GetBreakpointsArgs = z.infer<typeof getBreakpointsSchema>;

/**
 * 处理 get_breakpoints MCP 工具请求。
 * 向 VS Code 插件发送请求以获取所有断点。
 */
export async function handleGetBreakpoints(
    args: GetBreakpointsArgs,
    extra: any
): Promise<{ status: typeof Constants.IPC_STATUS_SUCCESS; content: { type: "text", text: string }[] } | { status: typeof Constants.IPC_STATUS_ERROR; message: string; content: { type: "text", text: string }[]; isError: true }> {
    try {
        const pluginResponse: PluginResponse = await sendRequestToPlugin({ command: Constants.IPC_COMMAND_GET_BREAKPOINTS, payload: {} });

        if (pluginResponse.status === Constants.IPC_STATUS_SUCCESS && pluginResponse.payload) {
            const { timestamp, breakpoints } = pluginResponse.payload;

            // 验证响应结构是否符合预期 (根据 ProjectBrief.md)
            if (typeof timestamp === 'string' && Array.isArray(breakpoints)) {
                const successPayload = {
                    timestamp: timestamp,
                    breakpoints: breakpoints,
                };
                const successText = JSON.stringify(successPayload, null, 2);
                return {
                    status: Constants.IPC_STATUS_SUCCESS,
                    content: [{ type: "text", text: successText }]
                };
            } else {
                const errorMessage = 'Plugin returned breakpoint data in an unexpected format.';
                console.error(`[MCP Server] ${errorMessage}`, pluginResponse.payload);
                return {
                    status: Constants.IPC_STATUS_ERROR,
                    message: errorMessage,
                    content: [{ type: "text", text: errorMessage }],
                    isError: true
                };
            }
        } else if (pluginResponse.status === Constants.IPC_STATUS_ERROR) {
            const errorMessage = pluginResponse.error?.message || 'Plugin failed to get breakpoints with an unspecified error.';
            console.error(`[MCP Server] Plugin reported error getting breakpoints: ${errorMessage}`);
            return {
                status: Constants.IPC_STATUS_ERROR,
                message: errorMessage,
                content: [{ type: "text", text: errorMessage }],
                isError: true
            };
        } else {
            const errorMessage = 'Plugin returned success but payload format was unexpected or missing.';
            console.error(`[MCP Server] ${errorMessage}`, pluginResponse.payload);
            return {
                status: Constants.IPC_STATUS_ERROR,
                message: errorMessage,
                content: [{ type: "text", text: errorMessage }],
                isError: true
            };
        }

    } catch (error: any) {
        const errorMessage = error?.message || "Failed to get breakpoints due to communication error or unexpected issue.";
        console.error(`[MCP Server] Error getting breakpoints: ${errorMessage}`);
        return {
            status: Constants.IPC_STATUS_ERROR,
            message: `Error communicating with VS Code extension: ${errorMessage}`,
            content: [{ type: "text", text: `Error communicating with VS Code extension: ${errorMessage}` }],
            isError: true
        };
    }
}