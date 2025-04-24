import { z } from 'zod'; // <--- 导入 zod
// import { Tool, ToolInputSchema, ToolExecuteParams } from '@modelcontextprotocol/sdk'; // <--- 移除 SDK 导入
// import { JSONSchema7 } from 'json-schema'; // <--- 移除 json-schema 导入 (如果 zod 足够)
import { StepExecutionParams, StepExecutionResult, StopEventData } from '../../types'; // 使用 mcp-server 内部类型
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator'; // 导入 sendRequestToPlugin
import { TOOL_NAME_STEP_EXECUTION, IPC_COMMAND_STEP_EXECUTION } from '../../constants'; // 导入常量

// --- 使用 Zod 定义输入 Schema ---
const StepExecutionParamsSchema = z.object({
    thread_id: z.number().int().describe('需要执行单步操作的线程的 ID (从 stop_event_data.thread_id 获取)。'),
    step_type: z.enum(['over', 'into', 'out']).describe("指定单步执行的具体类型: 'over', 'into', 'out'。")
});

// --- 使用 Zod 定义输出 Schema (与 continueDebugging 类似) ---
const AsyncDebugResultSchema = z.object({
    status: z.enum(["stopped", "completed", "error", "timeout", "interrupted"]),
    stop_event_data: z.any().optional().describe("当 status 为 'stopped' 时，包含停止事件的详细信息。"), // 可以定义更精确的 StopEventData Schema
    message: z.string().optional().describe("当 status 为 'completed', 'error', 'timeout', 'interrupted' 时，包含描述信息。")
}).describe("异步调试操作的结果");


// --- 调整 Tool 定义 ---
// const stepExecutionTool: Tool<StepExecutionParams, any> = { // <--- 移除 SDK 类型
export const stepExecutionTool = { // <--- 直接导出对象
    name: TOOL_NAME_STEP_EXECUTION,
    description: '当调试器暂停时，执行一次单步操作 (步过, 步入, 步出)。',
    inputSchema: StepExecutionParamsSchema, // <--- 使用 Zod Schema
    outputSchema: AsyncDebugResultSchema, // <--- 添加 Zod Output Schema

    // --- 修改 execute 函数签名和实现 ---
    async execute(params: StepExecutionParams): Promise<z.infer<typeof AsyncDebugResultSchema>> { // <--- 修改参数类型和返回类型
        try {
            console.log(`[MCP Tool] Executing ${TOOL_NAME_STEP_EXECUTION} with params:`, params); // <--- 直接使用 params

            // 向 VS Code 插件发送请求
            const response: PluginResponse<StepExecutionResult> = await sendRequestToPlugin(
                {
                    command: IPC_COMMAND_STEP_EXECUTION, // 使用 IPC 命令常量
                    payload: params // <--- 直接传递 params 作为 payload
                },
                65000 // 设置超时时间 (例如 65 秒, 与 continue 保持一致)
            );

            console.log(`[MCP Tool] ${TOOL_NAME_STEP_EXECUTION} result from plugin:`, response);

            // 根据插件返回结果构建最终响应 (逻辑保持不变，但返回结构需符合 AsyncDebugResultSchema)
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
                } else { // error status from payload
                    return {
                        status: 'error',
                        message: result.message || '插件返回未知错误',
                    };
                }
            } else {
                 // 处理顶层响应错误
                 const errorMessage = response.error?.message || '插件通信失败或返回无效响应';
                 return {
                     status: 'error',
                     message: errorMessage,
                 };
            }
        } catch (error: any) {
            console.error(`[MCP Tool] Error executing ${TOOL_NAME_STEP_EXECUTION}:`, error);
            const status = error.message?.includes('timed out') ? 'timeout' : 'error';
            return {
                status: status,
                message: `执行 ${TOOL_NAME_STEP_EXECUTION} 工具时出错: ${error.message || error}`,
            };
        }
    },
};

// export default stepExecutionTool; // <--- 改为命名导出