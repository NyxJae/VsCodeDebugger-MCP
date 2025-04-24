import * as vscode from 'vscode';
import * as Constants from './constants';

/**
 * 定义插件与 MCP 服务器之间 IPC 通信的共享类型。
 */


export interface SetBreakpointParams {
    file_path: string; // 插件端接收到时应已是绝对路径
    line_number: number;
    column_number?: number;
    condition?: string;
    hit_condition?: string;
    log_message?: string;
}

export interface RemoveBreakpointParams {
  breakpoint_id?: number;
  location?: {
    file_path: string; // 插件端接收到时应已是绝对路径
    line_number: number;
  };
  clear_all?: boolean;
}


export interface PluginRequest<T = any> {
    type: 'request';
    command: string;
    requestId: string;
    payload: T;
}


export interface PluginResponse<P = any, E = { message: string }> {
    type: 'response';
    requestId: string;
    status: typeof Constants.IPC_STATUS_SUCCESS | typeof Constants.IPC_STATUS_ERROR;
    payload?: P;
    error?: E;
}

type GetConfigurationsResponsePayload = { configurations: vscode.DebugConfiguration[] };
type SetBreakpointResponsePayload = { breakpoint: vscode.Breakpoint; timestamp: string };
type GetBreakpointsResponsePayload = { breakpoints: vscode.Breakpoint[]; timestamp: string };
type RemoveBreakpointResponsePayload = { message?: string }; // 成功时只有可选消息


export interface StartDebuggingRequestPayload {
  configurationName: string;
  noDebug: boolean;
}

export interface ContinueDebuggingParams {
    sessionId?: string;
    threadId: number;
}

/**
 * step_execution 工具参数
 */
export interface StepExecutionParams {
  /**
   * 需要执行单步操作的线程的 ID (从 stop_event_data.thread_id 获取)。
   */
  thread_id: number;
  /**
   * 指定单步执行的具体类型: 'over', 'into', 'out'。
   */
  step_type: 'over' | 'into' | 'out';
  /**
   * 可选的 session_id (由 MCP Server 添加或插件端确定)
   */
  sessionId?: string;
}

export interface StopDebuggingPayload {
  sessionId?: string;
}

export interface VariableInfo {
  name: string;
  value: string;
  type: string | null;
  variables_reference: number; // >0 表示可展开
  evaluate_name?: string;
  memory_reference?: string;
}

export interface StackFrameInfo {
  frame_id: number;
  function_name: string;
  file_path: string;
  line_number: number;
  column_number: number;
}

export interface StopEventData {
  session_id: string;
  timestamp: string;
  reason: string;
  thread_id: number;
  description?: string | null;
  text?: string | null;
  all_threads_stopped?: boolean | null;
  source?: { path: string; name: string } | null;
  line?: number | null;
  column?: number | null;
  call_stack: StackFrameInfo[];
  top_frame_variables?: {
    scope_name: string;
    variables: VariableInfo[];
  } | null;
  hit_breakpoint_ids?: number[] | null;
}

export type StartDebuggingResponsePayload =
  | { status: "stopped"; data: StopEventData }
  | { status: "completed"; message: string }
  | { status: "error"; message: string }
  | { status: "timeout"; message: string }
  | { status: "interrupted"; message: string };

/**
 * stepExecution 操作结果类型
 */
export type StepExecutionResult =
  | { status: 'stopped'; stop_event_data: StopEventData }
  | { status: 'completed'; message: string }
  | { status: 'timeout'; message: string }
  | { status: 'interrupted'; message: string } // 如果支持中断
  | { status: 'error'; message: string };

export type PluginRequestData =
  | PluginRequest<undefined> & { command: typeof Constants.IPC_COMMAND_GET_CONFIGURATIONS }
  | PluginRequest<SetBreakpointParams> & { command: typeof Constants.IPC_COMMAND_SET_BREAKPOINT }
  | PluginRequest<undefined> & { command: typeof Constants.IPC_COMMAND_GET_BREAKPOINTS }
  | PluginRequest<RemoveBreakpointParams> & { command: typeof Constants.IPC_COMMAND_REMOVE_BREAKPOINT }
  | PluginRequest<StartDebuggingRequestPayload> & { command: typeof Constants.IPC_COMMAND_START_DEBUGGING_REQUEST }
  | PluginRequest<ContinueDebuggingParams> & { command: typeof Constants.IPC_COMMAND_CONTINUE_DEBUGGING }
  | PluginRequest<StepExecutionParams> & { command: typeof Constants.IPC_COMMAND_STEP_EXECUTION }
  | PluginRequest<StopDebuggingPayload> & { command: typeof Constants.IPC_COMMAND_STOP_DEBUGGING };

export type PluginResponseData =
  | PluginResponse<GetConfigurationsResponsePayload> & { status: typeof Constants.IPC_STATUS_SUCCESS }
  | PluginResponse<SetBreakpointResponsePayload> & { status: typeof Constants.IPC_STATUS_SUCCESS }
  | PluginResponse<GetBreakpointsResponsePayload> & { status: typeof Constants.IPC_STATUS_SUCCESS }
  | PluginResponse<RemoveBreakpointResponsePayload> & { status: typeof Constants.IPC_STATUS_SUCCESS }
  | PluginResponse<StartDebuggingResponsePayload> & { status: typeof Constants.IPC_STATUS_SUCCESS }
  | PluginResponse<StepExecutionResult> & { status: typeof Constants.IPC_STATUS_SUCCESS }
  | PluginResponse<undefined, { message: string }> & { status: typeof Constants.IPC_STATUS_ERROR };