// mcp-server/src/toolProviders/debug/removeBreakpoint.ts
import { z } from 'zod';
// Removed ToolInputValidationException import as error handling follows setBreakpoint pattern
import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator'; // Import sendRequestToPlugin
import { IPC_COMMAND_REMOVE_BREAKPOINT, STATUS_SUCCESS, STATUS_ERROR } from '../../constants'; // Import necessary constants

// --- Schema Definition ---
const LocationSchema = z.object({
  file_path: z.string().describe('要移除断点的源代码文件的绝对路径或相对于工作区的路径。'),
  line_number: z.number().int().positive().describe('要移除断点的行号 (基于 1 开始计数)。'),
});

// Define the base object schema first
export const BaseRemoveBreakpointInputSchema = z.object({
  breakpoint_id: z.number().int().positive().optional().describe('要移除的断点的唯一 ID。'),
  location: LocationSchema.optional().describe('指定要移除断点的位置。'),
  clear_all: z.boolean().optional().describe('如果设置为 true，则尝试移除所有断点。'),
});

// Then apply refine to the base schema for validation logic
export const RemoveBreakpointInputSchema = BaseRemoveBreakpointInputSchema.refine(
  (data) => {
    const providedParams = [data.breakpoint_id, data.location, data.clear_all].filter(
      (param) => param !== undefined
    );
    return providedParams.length === 1;
  },
  {
    message: '必须且只能提供 breakpoint_id、location 或 clear_all 中的一个参数。',
    // 可以指定 path 来更好地指示错误来源，但对于这种跨字段校验，通常省略或指向顶层
    // path: ["breakpoint_id", "location", "clear_all"], // Optional: refine error path
  }
);

// The inferred type remains the same structure
export type RemoveBreakpointInput = z.infer<typeof BaseRemoveBreakpointInputSchema>; // Infer from base schema

// --- Tool Handler ---
// Define the expected structure for the result, including the content field
type RemoveBreakpointResult =
    | { status: typeof STATUS_SUCCESS; message?: string; content: { type: "text", text: string }[] } // Success
    | { status: typeof STATUS_ERROR; message: string; content: { type: "text", text: string }[]; isError?: boolean }; // Error, isError is optional but good practice

export async function handleRemoveBreakpoint(params: unknown): Promise<RemoveBreakpointResult> {
  let validatedParams: RemoveBreakpointInput;
  try {
    validatedParams = RemoveBreakpointInputSchema.parse(params);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // ZodError 现在可能包含来自 .refine() 的错误消息
      const errorMessage = error.errors.map(e => e.message).join('; '); // 使用分号分隔可能更好
      const fullMessage = `输入参数校验失败: ${errorMessage}`;
      console.error(`[MCP Server] Validation Error in handleRemoveBreakpoint: ${fullMessage}`);
      // 返回 refine 的错误消息给客户端
      return { status: STATUS_ERROR, message: fullMessage, content: [{ type: "text", text: fullMessage }], isError: true };
    }
    // 处理其他非 Zod 错误
    const unexpectedErrorMessage = '处理输入参数时发生未知错误';
    console.error(`[MCP Server] Unexpected Error parsing params in handleRemoveBreakpoint: ${error}`);
    return { status: STATUS_ERROR, message: unexpectedErrorMessage, content: [{ type: "text", text: unexpectedErrorMessage }], isError: true };
  }

  // --- Manual validation removed, handled by .refine() ---

  try {
    // 通过 IPC 请求插件执行移除操作, using sendRequestToPlugin
    // validatedParams 已经通过了包括 refine 在内的所有校验
    const response: PluginResponse = await sendRequestToPlugin({
      type: IPC_COMMAND_REMOVE_BREAKPOINT, // Use 'type' as per setBreakpoint example
      payload: validatedParams, // Use 'payload' as per setBreakpoint example
    });

    if (response.status === STATUS_SUCCESS) {
      console.log('[MCP Server] Successfully removed breakpoint via plugin.');
      const successMessage = typeof response.payload?.message === 'string' ? response.payload.message : '断点移除操作已成功请求。'; // Slightly better default message
      return { status: STATUS_SUCCESS, message: successMessage, content: [{ type: "text", text: successMessage }] };
    } else {
      // Plugin returned an error status
      const errorMessage = response.error?.message || '插件移除断点时返回未知错误。';
      console.error(`[MCP Server] Plugin reported error removing breakpoint: ${errorMessage}`);
      return { status: STATUS_ERROR, message: errorMessage, content: [{ type: "text", text: errorMessage }], isError: true };
    }
  } catch (error: any) {
    // IPC communication failed (e.g., timeout) or other unexpected error
    const commErrorMessage = error?.message || '与插件通信失败或发生未知错误。';
    const fullCommMessage = `移除断点时发生通信错误: ${commErrorMessage}`;
    console.error('[MCP Server] Error communicating with plugin for removeBreakpoint:', error);
    return { status: STATUS_ERROR, message: fullCommMessage, content: [{ type: "text", text: fullCommMessage }], isError: true };
  }
}