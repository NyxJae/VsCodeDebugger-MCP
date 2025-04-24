import { z } from 'zod';
import { sendRequestToPlugin } from '../../pluginCommunicator';
import * as Constants from '../../constants';
import type { PluginResponse as LocalPluginResponse } from '../../types';

// --- Schema Definition ---
const LocationSchema = z.object({
  file_path: z.string().describe('要移除断点的源代码文件的绝对路径或相对于工作区的路径。'),
  line_number: z.number().int().positive().describe('要移除断点的行号 (基于 1 开始计数)。'),
});

export const BaseRemoveBreakpointInputSchema = z.object({
  breakpoint_id: z.number().int().positive().optional().describe('要移除的断点的唯一 ID。'),
  location: LocationSchema.optional().describe('指定要移除断点的位置。'),
  clear_all: z.boolean().optional().describe('如果设置为 true，则尝试移除所有断点。'),
});

export const RemoveBreakpointInputSchema = BaseRemoveBreakpointInputSchema.refine(
  (data) => {
    const providedParams = [data.breakpoint_id, data.location, data.clear_all].filter(
      (param) => param !== undefined
    );
    return providedParams.length === 1;
  },
  {
    message: '必须且只能提供 breakpoint_id、location 或 clear_all 中的一个参数。',
  }
);

export type RemoveBreakpointInput = z.infer<typeof BaseRemoveBreakpointInputSchema>;

// --- Tool Handler ---
type RemoveBreakpointResult =
    | { status: typeof Constants.IPC_STATUS_SUCCESS; message?: string; content: { type: "text", text: string }[] }
    | { status: typeof Constants.IPC_STATUS_ERROR; message: string; content: { type: "text", text: string }[]; isError?: boolean };

export async function handleRemoveBreakpoint(params: unknown): Promise<RemoveBreakpointResult> {
  let validatedParams: RemoveBreakpointInput;
  try {
    validatedParams = RemoveBreakpointInputSchema.parse(params);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.errors.map(e => e.message).join('; ');
      const fullMessage = `输入参数校验失败: ${errorMessage}`;
      console.error(`[MCP Server] Validation Error in handleRemoveBreakpoint: ${fullMessage}`);
      return { status: Constants.IPC_STATUS_ERROR, message: fullMessage, content: [{ type: "text", text: fullMessage }], isError: true };
    }
    const unexpectedErrorMessage = '处理输入参数时发生未知错误';
    console.error(`[MCP Server] Unexpected Error parsing params in handleRemoveBreakpoint: ${error}`);
    return { status: Constants.IPC_STATUS_ERROR, message: unexpectedErrorMessage, content: [{ type: "text", text: unexpectedErrorMessage }], isError: true };
  }

  try {
    const response: LocalPluginResponse = await sendRequestToPlugin({
      command: Constants.IPC_COMMAND_REMOVE_BREAKPOINT,
      payload: validatedParams,
    });

    if (response.status === Constants.IPC_STATUS_SUCCESS) {
      console.log('[MCP Server] Successfully removed breakpoint via plugin.');
      const successMessage = typeof response.payload?.message === 'string' ? response.payload.message : '断点移除操作已成功请求。';
      return { status: Constants.IPC_STATUS_SUCCESS, message: successMessage, content: [{ type: "text", text: successMessage }] };
    } else {
      const errorMessage = response.error?.message || '插件移除断点时返回未知错误。';
      console.error(`[MCP Server] Plugin reported error removing breakpoint: ${errorMessage}`);
      return { status: Constants.IPC_STATUS_ERROR, message: errorMessage, content: [{ type: "text", text: errorMessage }], isError: true };
    }
  } catch (error: any) {
    const commErrorMessage = error?.message || '与插件通信失败或发生未知错误。';
    const fullCommMessage = `移除断点时发生通信错误: ${commErrorMessage}`;
    console.error('[MCP Server] Error communicating with plugin for removeBreakpoint:', error);
    return { status: Constants.IPC_STATUS_ERROR, message: fullCommMessage, content: [{ type: "text", text: fullCommMessage }], isError: true };
  }
}