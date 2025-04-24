import { z } from 'zod';
import { StepExecutionParams, StepExecutionResult } from '../../types';
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
import { TOOL_NAME_STEP_EXECUTION, IPC_COMMAND_STEP_EXECUTION } from '../../constants';

const StepExecutionParamsSchema = z.object({
    session_id: z.string().optional().describe("目标调试会话的 ID。如果省略，将尝试使用当前活动的调试会话。"),
    thread_id: z.number().int().describe('需要执行单步操作的线程的 ID (从 stop_event_data.thread_id 获取)。'),
    step_type: z.enum(['over', 'into', 'out']).describe("指定单步执行的具体类型: 'over', 'into', 'out'。")
});

const AsyncDebugResultSchema = z.object({
    status: z.enum(["stopped", "completed", "error", "timeout", "interrupted"]),
    stop_event_data: z.any().optional().describe("当 status 为 'stopped' 时，包含停止事件的详细信息。"),
    message: z.string().optional().describe("当 status 为 'completed', 'error', 'timeout', 'interrupted' 时，包含描述信息。")
}).describe("异步调试操作的结果");


export const stepExecutionTool = {
    name: TOOL_NAME_STEP_EXECUTION,
    description: '当调试器暂停时，执行一次单步操作 (步过, 步入, 步出)。如果省略 session_id，将尝试使用活动会话。',
    inputSchema: StepExecutionParamsSchema,
    outputSchema: AsyncDebugResultSchema,

    async execute(params: StepExecutionParams): Promise<z.infer<typeof AsyncDebugResultSchema>> {
        try {

            let sessionId = params.session_id;
            const threadId = params.thread_id;
            const stepType = params.step_type;


            const response: PluginResponse<StepExecutionResult> = await sendRequestToPlugin(
                {
                    command: IPC_COMMAND_STEP_EXECUTION,
                    payload: {
                        sessionId: sessionId,
                        thread_id: threadId,
                        step_type: stepType,
                    }
                },
                65000
            );


            if (response.status === 'success' && response.payload) {
                const result = response.payload;
                if (result.status === 'stopped') {
                    return {
                        status: 'stopped',
                        stop_event_data: result.stop_event_data,
                    };
                } else if (result.status === 'completed') {
                    return {
                        status: 'completed',
                        message: result.message,
                    };
                } else if (result.status === 'timeout') {
                    return {
                        status: 'timeout',
                        message: result.message,
                    };
                } else if (result.status === 'interrupted') {
                    return {
                        status: 'interrupted',
                        message: result.message,
                    };
                } else if (result.status === 'error') {
                    return {
                        status: 'error',
                        message: result.message || '插件返回错误状态但无消息',
                    };
                }
                 return { status: 'error', message: `处理插件响应时遇到意外的内部状态: ${(result as any).status}` };
            } else {
                 const errorMessage = response.error?.message || '插件通信失败或返回无效响应';
                 return {
                     status: 'error',
                     message: errorMessage,
                 };
            }
        } catch (error: any) {
            const status = error.message?.includes('timed out') ? 'timeout' : 'error';
            return {
                status: status,
                message: `执行 ${TOOL_NAME_STEP_EXECUTION} 工具时出错: ${error.message || error}`,
            };
        }
    },
};