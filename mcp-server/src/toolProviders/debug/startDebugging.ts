import { z } from 'zod';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
import * as Constants from '../../constants';
import type { StartDebuggingRequestPayload, StartDebuggingResponsePayload } from '../../types';

export const startDebuggingSchema = z.object({
  configuration_name: z.string().min(1, "Configuration name cannot be empty.").describe("launch.json 中的配置名称"),
  no_debug: z.boolean().optional().default(false).describe("是否以非调试模式启动"),
});

export type StartDebuggingArgs = z.infer<typeof startDebuggingSchema>;

type StartDebuggingResult = StartDebuggingResponsePayload;

type McpToolResult = {
    content: { type: "text", text: string }[];
    isError?: boolean;
};

/**
 * 处理 start_debugging MCP 工具请求。
 * 向 VS Code 插件发送请求以启动调试会话。
 */
export async function handleStartDebugging(
    args: StartDebuggingArgs,
    extra: any // RequestHandlerExtra
): Promise<McpToolResult> {
    const payloadForPlugin: StartDebuggingRequestPayload = {
        configurationName: args.configuration_name,
        noDebug: args.no_debug,
    };

    const toolTimeout = 60000;

    try {
        const pluginResponse: PluginResponse<StartDebuggingResponsePayload> = await sendRequestToPlugin(
            { command: Constants.IPC_COMMAND_START_DEBUGGING_REQUEST, payload: payloadForPlugin },
            toolTimeout
        );

        if (pluginResponse.status === Constants.IPC_STATUS_SUCCESS && pluginResponse.payload) {
            const resultPayload = pluginResponse.payload;
            const resultText = JSON.stringify(resultPayload, null, 2);
            const isError = resultPayload.status !== 'stopped' && resultPayload.status !== 'completed';
            return {
                content: [{ type: "text", text: resultText }],
                isError: isError
            };
        } else if (pluginResponse.status === Constants.IPC_STATUS_ERROR) {
            const errorMessage = pluginResponse.error?.message || 'Plugin failed to start debugging.';
            console.error(`[MCP Server] Plugin reported error during start_debugging: ${errorMessage}`);
            return {
                content: [{ type: "text", text: JSON.stringify({ status: 'error', message: errorMessage }, null, 2) }],
                isError: true
            };
        } else {
            const errorMessage = 'Plugin returned success but the response payload was missing or invalid.';
            console.error(`[MCP Server] ${errorMessage}`, pluginResponse);
            return {
                content: [{ type: "text", text: JSON.stringify({ status: 'error', message: errorMessage }, null, 2) }],
                isError: true
            };
        }

    } catch (error: any) {
        console.error(`[MCP Server] Error during start_debugging communication:`, error);
        let errorStatus: StartDebuggingResponsePayload['status'] = 'error';
        let errorMessage = `MCP Server Error: ${error.message || 'Unknown communication error'}`;
        if (error.message?.includes('timed out')) {
            errorStatus = 'timeout';
            errorMessage = `MCP Server: Waiting for plugin response timed out (${toolTimeout}ms).`;
        }
        return {
            content: [{ type: "text", text: JSON.stringify({ status: errorStatus, message: errorMessage }, null, 2) }],
            isError: true
        };
    }
}