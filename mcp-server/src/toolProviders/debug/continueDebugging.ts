import { z } from 'zod';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator'; // 确认路径
import { ContinueDebuggingParams, StartDebuggingResponsePayload } from '../../types'; // 确认路径
import * as Constants from '../../constants'; // <--- 导入常量

const ContinueDebuggingParamsSchema = z.object({
    session_id: z.string().describe("目标调试会话的 ID。必须由 AI Agent 提供。"), // <--- 修改：添加并设为必需
    thread_id: z.number().int().describe("需要恢复执行的线程的 ID。"),
});

// 示例：可以创建一个通用的异步结果 Schema
const AsyncDebugResultSchema = z.object({
    status: z.enum(["stopped", "completed", "error", "timeout", "interrupted"]),
    stop_event_data: z.any().optional().describe("当 status 为 'stopped' 时，包含停止事件的详细信息。"), // 需要更精确的 StopEventData Schema
    message: z.string().optional().describe("当 status 为 'completed', 'error', 'timeout', 'interrupted' 时，包含描述信息。")
}).describe("异步调试操作的结果");

export const continueDebuggingTool = {
    name: "continue_debugging",
    description: "当调试器暂停时，命令指定线程恢复执行，并等待下一次暂停或结束。需要提供 session_id。",
    inputSchema: ContinueDebuggingParamsSchema,
    outputSchema: AsyncDebugResultSchema, // 使用通用或特定的 Schema
    async execute(params: ContinueDebuggingParams): Promise<z.infer<typeof AsyncDebugResultSchema>> {
        try {
            // --- 修改：直接从参数获取 sessionId ---
            const { session_id: sessionId, thread_id: threadId } = params;
            // --- 移除对 getCurrentActiveSessionId 的调用 ---
            // const activeSessionId = getCurrentActiveSessionId(); // 移除
            // if (!activeSessionId) { // 移除
            //     return { status: "error", message: "当前没有活动的调试会话。" }; // 移除
            // }

            console.log(`[MCP Tool] Sending continue_debugging request to plugin for session ${sessionId}, thread ${threadId}`);

            // 向插件发送请求
            const response: PluginResponse<StartDebuggingResponsePayload> = await sendRequestToPlugin({
                command: Constants.IPC_COMMAND_CONTINUE_DEBUGGING, // <--- 使用常量
                payload: {
                    // --- 修改：使用从参数获取的 sessionId 和 threadId ---
                    sessionId: sessionId,
                    threadId: threadId,
                }
            }, 65000); // 设置超时时间 (例如 65 秒)

            console.log(`[MCP Tool] Received response from plugin for continue_debugging:`, response);

            // 处理插件响应并返回
            if (response.status === 'success' && response.payload) {
                // 直接返回插件的 payload，其结构应符合 AsyncDebugResultSchema
                // 注意 payload 内部的 status 和这里的 status 不同
                const payload = response.payload;
                if (payload.status === 'stopped') {
                    return { status: 'stopped', stop_event_data: payload.data };
                } else if (payload.status === 'completed') {
                    return { status: 'completed', message: payload.message };
                } else if (payload.status === 'timeout') {
                    return { status: 'timeout', message: payload.message };
                } else if (payload.status === 'interrupted') {
                     return { status: 'interrupted', message: payload.message };
                } else { // error status from payload
                    return { status: 'error', message: payload.message || '插件返回未知错误' };
                }
            } else {
                // 处理顶层响应错误
                const errorMessage = response.error?.message || '插件通信失败或返回无效响应';
                return { status: "error", message: errorMessage };
            }
        } catch (error: any) {
            console.error(`[MCP Tool] Error executing continue_debugging:`, error);
            return { status: "error", message: error.message || "执行 continue_debugging 工具时发生未知错误。" };
        }
    }
};

// --- 移除不再需要的 getCurrentActiveSessionId 函数 ---
// function getCurrentActiveSessionId(): string | undefined { ... }