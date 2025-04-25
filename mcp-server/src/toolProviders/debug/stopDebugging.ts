import { z } from 'zod';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
import * as Constants from '../../constants';
import { IPC_STATUS_SUCCESS, IPC_STATUS_ERROR } from '../../constants'; // Keep specific imports if needed
// import { StopDebuggingPayload } from '../../types'; // Type not directly used in the old handler, maybe not needed

// Input Schema (Keep as is)
export const stopDebuggingSchema = z.object({
    sessionId: z.string().optional().describe("要停止的调试会话的 ID。如果省略，将尝试停止当前活动的会话。"),
});

export type StopDebuggingArgs = z.infer<typeof stopDebuggingSchema>;

// --- 新增：定义工具执行结果的 Schema ---
const StopDebuggingOutputSchema = z.object({
    status: z.enum([Constants.IPC_STATUS_SUCCESS, Constants.IPC_STATUS_ERROR]),
    message: z.string().optional().describe("操作结果的消息，成功或失败时都可能包含"),
}).describe("停止调试工具的执行结果");


// --- 新增：定义工具对象 ---
export const stopDebuggingTool = {
    name: Constants.TOOL_STOP_DEBUGGING,
    description: "停止指定的或当前活动的调试会话。",
    inputSchema: stopDebuggingSchema,
    outputSchema: StopDebuggingOutputSchema,

    async execute(
        args: StopDebuggingArgs,
        // extra: any
    ): Promise<z.infer<typeof StopDebuggingOutputSchema>> {
        const toolName = this.name;
        console.info(`[MCP Tool - ${toolName}] Executing with args:`, args);

        try {
            const response: PluginResponse = await sendRequestToPlugin({
                 command: Constants.IPC_COMMAND_STOP_DEBUGGING,
                 payload: { sessionId: args.sessionId } // Pass args directly
            });
            console.debug(`[MCP Tool - ${toolName}] Received response from plugin:`, response);

            if (response.status === IPC_STATUS_SUCCESS) {
                const successMessage = response.payload?.message || '已成功发送停止调试会话的请求。';
                console.info(`[MCP Tool - ${toolName}] Success: ${successMessage}`);
                // Return success status based on schema
                return { status: Constants.IPC_STATUS_SUCCESS, message: successMessage };
            } else {
                const errorMessage = response.error?.message || '停止调试时插件端返回未知错误。';
                console.error(`[MCP Tool - ${toolName}] Plugin reported error: ${errorMessage}`);
                // Return error status based on schema
                return { status: Constants.IPC_STATUS_ERROR, message: errorMessage };
            }
        } catch (error: any) {
            const commErrorMessage = error?.message || '与插件通信失败或发生未知错误。';
            console.error(`[MCP Tool - ${toolName}] Communication error:`, error);
            // Return error status based on schema
            return { status: Constants.IPC_STATUS_ERROR, message: `与插件通信失败: ${commErrorMessage}` };
        }
    }
};


// --- 保留旧函数以防万一 ---
/*
export async function handleStopDebugging(
    args: z.infer<typeof stopDebuggingSchema> // 使用 z.infer 保持与 schema 同步
): Promise<{ status: string; message: string }> {
    // ... 旧的实现 ...
}
*/