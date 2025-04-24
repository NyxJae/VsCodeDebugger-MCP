import { z } from 'zod';
import * as vscode from 'vscode'; // 导入 vscode 以获取 activeDebugSession
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator'; // 恢复导入
import { ContinueDebuggingParams, StartDebuggingResponsePayload } from '../../types'; // 恢复导入 StartDebuggingResponsePayload, 移除 AsyncDebugResultSchema
import { IPC_COMMAND_CONTINUE_DEBUGGING } from '../../constants'; // 导入 IPC 命令常量

const ContinueDebuggingParamsSchema = z.object({
    session_id: z.string().optional().describe("目标调试会话的 ID。如果省略，将尝试使用当前活动的调试会话。"),
    thread_id: z.number().int().describe("需要恢复执行的线程的 ID。"),
});

// 在这里定义异步结果 Schema，因为 types.ts 中没有导出
const AsyncDebugResultSchema = z.object({
    status: z.enum(["stopped", "completed", "error", "timeout", "interrupted"]),
    stop_event_data: z.any().optional().describe("当 status 为 'stopped' 时，包含停止事件的详细信息。"),
    message: z.string().optional().describe("当 status 为 'completed', 'error', 'timeout', 'interrupted' 时，包含描述信息。")
}).describe("异步调试操作的结果");


export const continueDebuggingTool = {
    name: "continue_debugging", // 直接使用字符串
    description: "当调试器暂停时，命令指定线程恢复执行，并等待下一次暂停或结束。如果省略 session_id，将尝试使用活动会话。",
    inputSchema: ContinueDebuggingParamsSchema,
    outputSchema: AsyncDebugResultSchema, // 使用在此定义的 Schema

    async execute(params: ContinueDebuggingParams): Promise<z.infer<typeof AsyncDebugResultSchema>> {
        try {
            console.log(`[MCP Tool] Executing continue_debugging with params:`, params);

            let sessionId = params.session_id;
            const threadId = params.thread_id;

            // 如果 session_id 未提供，尝试获取当前活动会话 ID
            // 注意：MCP Server 无法直接访问 vscode API，此逻辑应在插件端处理
            // 这里暂时保留获取逻辑，但理想情况下应由插件填充
            if (!sessionId) {
                // 尝试从 VS Code 获取活动会话 ID 的逻辑应该在插件端
                // 这里先假设插件会处理这种情况，如果插件未处理，则发送不带 sessionId 的请求
                // 或者，如果明确要求必须有 sessionId，则在此处报错
                // 根据当前设计，让插件处理缺失的 sessionId
                console.log(`[MCP Tool] No session_id provided. Relying on plugin to use active session.`);
                // 如果插件不能处理，则需要报错：
                // const activeSession = vscode.debug.activeDebugSession; // 这行在 MCP Server 中无效
                // if (activeSession) {
                //     sessionId = activeSession.id;
                //     console.log(`[MCP Tool] No session_id provided, using active session: ${sessionId}`);
                // } else {
                //     console.error('[MCP Tool] Error: No session_id provided and no active debug session found (cannot check from server).');
                //     return { status: "error", message: "未提供 session_id，且无法从服务器检查活动会话。" };
                // }
            }

            // 检查 sessionId 是否有效（如果提供了）
            // if (!sessionId) { // 如果上面报错，则这里不需要再次检查
            //      console.error('[MCP Tool] Error: Invalid session ID.');
            //      return { status: "error", message: "无法确定有效的调试会话 ID。" };
            // }

            console.log(`[MCP Tool] Sending continue_debugging request to plugin for session ${sessionId || 'default (active)'}, thread ${threadId}`);

            // 向插件发送请求
            const response: PluginResponse<StartDebuggingResponsePayload> = await sendRequestToPlugin({
                command: IPC_COMMAND_CONTINUE_DEBUGGING, // 使用导入的常量
                payload: {
                    // 传递 sessionId (可能是 undefined) 和 threadId
                    sessionId: sessionId, // 可能为 undefined
                    threadId: threadId,
                }
            }, 65000); // 设置超时时间 (例如 65 秒)

            console.log(`[MCP Tool] Received response from plugin for continue_debugging:`, response);

            // 处理插件响应并返回
            if (response.status === 'success' && response.payload) {
                const payload = response.payload;
                // 适配 StartDebuggingResponsePayload 到 AsyncDebugResultSchema
                if (payload.status === 'stopped') {
                    return { status: 'stopped', stop_event_data: payload.data };
                } else if (payload.status === 'completed' || payload.status === 'error' || payload.status === 'timeout' || payload.status === 'interrupted') {
                    // 这些状态直接映射
                    return { status: payload.status, message: payload.message };
                }
                // 添加一个 return 来处理理论上不可能发生的情况，以满足编译器
                // 理论上，由于 StartDebuggingResponsePayload 类型是联合类型，这里不应该被执行
                console.error(`[MCP Tool] Reached theoretically unreachable code in continue_debugging payload processing. Payload status: ${(payload as any).status}`);
                return { status: 'error', message: `处理插件响应时遇到意外的内部状态: ${(payload as any).status}` };
            } else {
                // 处理顶层响应错误
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