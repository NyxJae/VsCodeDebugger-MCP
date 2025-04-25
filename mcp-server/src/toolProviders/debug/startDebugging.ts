import { z } from 'zod';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
import * as Constants from '../../constants';
import type { StartDebuggingRequestPayload, StartDebuggingResponsePayload } from '../../types'; // Keep type import

// Input Schema (Keep as is)
export const startDebuggingSchema = z.object({
  configuration_name: z.string().min(1, "Configuration name cannot be empty.").describe("launch.json 中的配置名称"),
  no_debug: z.boolean().optional().default(false).describe("是否以非调试模式启动"),
});

export type StartDebuggingArgs = z.infer<typeof startDebuggingSchema>;

// --- 新增：定义工具执行结果的 Schema (基于 StartDebuggingResponsePayload) ---
// StartDebuggingResponsePayload already defines the structure we need for the result.
// We can reuse it or define a specific Zod schema if stricter validation is desired.
// Let's define a Zod schema for clarity and consistency.
const StartDebuggingOutputSchema = z.object({
    status: z.enum(["stopped", "completed", "error", "timeout", "interrupted", "running"]), // Add 'running' if applicable
    data: z.any().optional().describe("当 status 为 'stopped' 时，包含停止事件的详细信息。"),
    message: z.string().optional().describe("当 status 为 'completed', 'error', 'timeout', 'interrupted' 时，包含描述信息。"),
    session_id: z.string().optional().describe("成功启动的调试会话 ID"), // Add session_id if returned by plugin
}).describe("启动调试工具的执行结果");


// --- 新增：定义工具对象 ---
export const startDebuggingTool = {
    name: Constants.TOOL_START_DEBUGGING,
    description: "根据 launch.json 中的配置名称启动一个调试会话。",
    inputSchema: startDebuggingSchema,
    outputSchema: StartDebuggingOutputSchema, // Use the new output schema

    async execute(
        args: StartDebuggingArgs,
        // extra: any
    ): Promise<z.infer<typeof StartDebuggingOutputSchema>> {
        const toolName = this.name;
        console.info(`[MCP Tool - ${toolName}] Executing with args:`, args);

        const payloadForPlugin: StartDebuggingRequestPayload = {
            configurationName: args.configuration_name,
            noDebug: args.no_debug,
        };

        const toolTimeout = 60000; // Keep timeout

        try {
            console.debug(`[MCP Tool - ${toolName}] Sending request to plugin:`, payloadForPlugin);
            // Specify the expected response payload type for better type checking
            const pluginResponse: PluginResponse<StartDebuggingResponsePayload> = await sendRequestToPlugin(
                { command: Constants.IPC_COMMAND_START_DEBUGGING_REQUEST, payload: payloadForPlugin },
                toolTimeout
            );
            console.debug(`[MCP Tool - ${toolName}] Received response from plugin:`, pluginResponse);

            if (pluginResponse.status === Constants.IPC_STATUS_SUCCESS && pluginResponse.payload) {
                // Validate and return the payload according to StartDebuggingOutputSchema
                // The structure of StartDebuggingResponsePayload seems compatible
                try {
                    // Directly parse the payload using the output schema
                    const validatedResult = StartDebuggingOutputSchema.parse(pluginResponse.payload);
                    console.info(`[MCP Tool - ${toolName}] Debugging started/stopped with status: ${validatedResult.status}`);
                    return validatedResult;
                } catch (validationError: any) {
                    const errorMessage = `插件返回的启动调试结果格式无效: ${validationError.message}`;
                    console.error(`[MCP Tool - ${toolName}] ${errorMessage}`, pluginResponse.payload);
                    // Return an error status consistent with the schema
                    return { status: 'error', message: errorMessage };
                }
            } else if (pluginResponse.status === Constants.IPC_STATUS_ERROR) {
                const errorMessage = pluginResponse.error?.message || '插件启动调试失败，未指定错误。';
                console.error(`[MCP Tool - ${toolName}] Plugin reported error: ${errorMessage}`);
                return { status: 'error', message: errorMessage };
            } else {
                const errorMessage = '插件返回成功但响应负载格式意外或缺失。';
                console.error(`[MCP Tool - ${toolName}] ${errorMessage}`, pluginResponse.payload);
                return { status: 'error', message: errorMessage };
            }

        } catch (error: any) {
            console.error(`[MCP Tool - ${toolName}] Error during communication:`, error);
            let errorStatus: z.infer<typeof StartDebuggingOutputSchema>['status'] = 'error';
            let errorMessage = `MCP 服务器错误: ${error.message || '未知通信错误'}`;
            if (error.message?.includes('timed out')) {
                errorStatus = 'timeout'; // Use 'timeout' status from the schema
                errorMessage = `MCP 服务器: 等待插件响应超时 (${toolTimeout}ms)。`;
            }
            return { status: errorStatus, message: errorMessage };
        }
    }
};


// --- 保留旧函数以防万一 ---
/*
type McpToolResult_Old = {
    content: { type: "text", text: string }[];
    isError?: boolean;
};

export async function handleStartDebugging(
    args: StartDebuggingArgs,
    extra: any // RequestHandlerExtra
): Promise<McpToolResult_Old> {
   // ... 旧的实现 ...
}
*/