import { z } from 'zod';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
import { ContinueDebuggingParams, StartDebuggingResponsePayload } from '../../types';
import { IPC_COMMAND_CONTINUE_DEBUGGING } from '../../constants';

const ContinueDebuggingParamsSchema = z.object({
    session_id: z.string().optional().describe("目标调试会话的 ID。如果省略，将尝试使用当前活动的调试会话。"),
    thread_id: z.number().int().describe("需要恢复执行的线程的 ID。"),
});

// 在这里定义异步结果 Schema
const AsyncDebugResultSchema = z.object({
    status: z.enum(["stopped", "completed", "error", "timeout", "interrupted"]),
    stop_event_data: z.any().optional().describe("当 status 为 'stopped' 时，包含停止事件的详细信息。"),
    message: z.string().optional().describe("当 status 为 'completed', 'error', 'timeout', 'interrupted' 时，包含描述信息。")
}).describe("异步调试操作的结果");


export const continueDebuggingTool = {
    name: "continue_debugging",
    description: "当调试器暂停时，命令指定线程恢复执行，并等待下一次暂停或结束。如果省略 session_id，将尝试使用活动会话。",
    inputSchema: ContinueDebuggingParamsSchema,
    outputSchema: AsyncDebugResultSchema,

    async execute(params: ContinueDebuggingParams): Promise<z.infer<typeof AsyncDebugResultSchema>> {
        try {
            console.log(`[MCP Tool] Executing continue_debugging with params:`, params);

            let sessionId = params.session_id;
            const threadId = params.thread_id;

            console.log(`[MCP Tool] Sending continue_debugging request to plugin for session ${sessionId || 'default (active)'}, thread ${threadId}`);

            const response: PluginResponse<StartDebuggingResponsePayload> = await sendRequestToPlugin({
                command: IPC_COMMAND_CONTINUE_DEBUGGING,
                payload: {
                    sessionId: sessionId,
                    threadId: threadId,
                }
            }, 65000); // 设置超时时间 (65 秒)

            console.log(`[MCP Tool] Received response from plugin for continue_debugging:`, response);

            if (response.status === 'success' && response.payload) {
                const payload = response.payload;
                // 适配 StartDebuggingResponsePayload 到 AsyncDebugResultSchema
                if (payload.status === 'stopped') {
                    return { status: 'stopped', stop_event_data: payload.data };
                } else if (payload.status === 'completed' || payload.status === 'error' || payload.status === 'timeout' || payload.status === 'interrupted') {
                    return { status: payload.status, message: payload.message };
                }
                return { status: 'error', message: `处理插件响应时遇到意外的内部状态: ${(payload as any).status}` };
            } else {
                const errorMessage = response.error?.message || '插件通信失败或返回无效响应';
                console.error(`[MCP Tool] Plugin communication error: ${errorMessage}`);
                return { status: "error", message: errorMessage };
            }

        } catch (error: any) {
            console.error(`[MCP Tool] Error executing continue_debugging:`, error);
            return { status: "error", message: `执行 continue_debugging 时出错: ${error.message || "未知错误"}` };
        }
    }
};