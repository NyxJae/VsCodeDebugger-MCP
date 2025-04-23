import * as vscode from 'vscode';
import * as Constants from './constants'; // 导入 Constants

/**
 * 定义插件与 MCP 服务器之间 IPC 通信的共享类型。
 */

// --- 参数类型定义 ---

// setBreakpoint 参数 (与 mcp-server Schema 对应)
export interface SetBreakpointParams {
    file_path: string; // 插件端接收到时应已是绝对路径
    line_number: number;
    column_number?: number;
    condition?: string;
    hit_condition?: string;
    log_message?: string;
}

// removeBreakpoint 参数 (与 mcp-server Schema 对应)
export interface RemoveBreakpointParams {
  breakpoint_id?: number;
  location?: {
    file_path: string; // 插件端接收到时应已是绝对路径
    line_number: number;
  };
  clear_all?: boolean;
}

// --- IPC 请求结构 ---

// 通用请求接口 (保持原有结构，但 payload 类型更具体)
export interface PluginRequest<T = any> {
    type: 'request';
    command: string;
    requestId: string;
    payload: T;
}

// --- IPC 响应结构 ---

// 通用响应接口 (保持原有结构，但 payload 和 error 类型更具体)
export interface PluginResponse<P = any, E = { message: string }> {
    type: 'response';
    requestId: string;
    status: typeof Constants.IPC_STATUS_SUCCESS | typeof Constants.IPC_STATUS_ERROR; // 使用 Constants
    payload?: P;
    error?: E;
}

// 具体成功响应的 Payload 类型
type GetConfigurationsResponsePayload = { configurations: vscode.DebugConfiguration[] };
type SetBreakpointResponsePayload = { breakpoint: vscode.Breakpoint; timestamp: string }; // 假设返回 Breakpoint 和时间戳
type GetBreakpointsResponsePayload = { breakpoints: vscode.Breakpoint[]; timestamp: string };
type RemoveBreakpointResponsePayload = { message?: string }; // 成功时只有可选消息

// --- startDebugging 类型定义 ---

// 请求负载
export interface StartDebuggingRequestPayload {
  configurationName: string;
  noDebug: boolean;
}

// 变量信息结构 (用于 StopEventData)
export interface VariableInfo {
  name: string;
  value: string;
  type: string | null;
  variables_reference: number; // >0 表示可展开
  evaluate_name?: string;
  memory_reference?: string;
}

// 调用栈帧信息结构 (从 StopEventData 提取)
export interface StackFrameInfo {
  frame_id: number;
  function_name: string;
  file_path: string;
  line_number: number;
  column_number: number;
}

// 调试停止事件数据结构 (根据 ProjectBrief.md)
export interface StopEventData {
  timestamp: string; // ISO 8601 UTC
  reason: string; // "breakpoint", "exception", "step", etc.
  thread_id: number;
  description?: string | null;
  text?: string | null; // Exception message
  all_threads_stopped?: boolean | null;
  source?: { path: string; name: string } | null;
  line?: number | null;
  column?: number | null;
  call_stack: StackFrameInfo[]; // 使用定义的接口
  top_frame_variables?: { // 顶层帧变量快照
    scope_name: string;
    variables: VariableInfo[];
  } | null;
  hit_breakpoint_ids?: number[] | null;
}

// 响应负载 (根据 ProjectBrief.md 和任务规划)
export type StartDebuggingResponsePayload =
  | { status: "stopped"; data: StopEventData }
  | { status: "completed"; message: string }
  | { status: "error"; message: string }
  | { status: "timeout"; message: string }
  | { status: "interrupted"; message: string };

// 将 startDebugging 添加到 PluginRequestData 和 PluginResponseData 联合类型中
export type PluginRequestData =
  | PluginRequest<undefined> & { command: typeof Constants.IPC_COMMAND_GET_CONFIGURATIONS }
  | PluginRequest<SetBreakpointParams> & { command: typeof Constants.IPC_COMMAND_SET_BREAKPOINT }
  | PluginRequest<undefined> & { command: typeof Constants.IPC_COMMAND_GET_BREAKPOINTS }
  | PluginRequest<RemoveBreakpointParams> & { command: typeof Constants.IPC_COMMAND_REMOVE_BREAKPOINT }
  | PluginRequest<StartDebuggingRequestPayload> & { command: typeof Constants.IPC_COMMAND_START_DEBUGGING_REQUEST }; // 新增

export type PluginResponseData =
  | PluginResponse<GetConfigurationsResponsePayload> & { status: typeof Constants.IPC_STATUS_SUCCESS }
  | PluginResponse<SetBreakpointResponsePayload> & { status: typeof Constants.IPC_STATUS_SUCCESS }
  | PluginResponse<GetBreakpointsResponsePayload> & { status: typeof Constants.IPC_STATUS_SUCCESS }
  | PluginResponse<RemoveBreakpointResponsePayload> & { status: typeof Constants.IPC_STATUS_SUCCESS }
  | PluginResponse<StartDebuggingResponsePayload> & { status: typeof Constants.IPC_STATUS_SUCCESS } // 新增成功响应 (虽然 startDebugging 自身状态在 payload 里)
  | PluginResponse<undefined, { message: string }> & { status: typeof Constants.IPC_STATUS_ERROR }; // 通用错误响应