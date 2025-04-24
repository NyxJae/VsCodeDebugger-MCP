// 类型定义，从根目录 src/types.ts 复制并简化，避免 vscode 依赖

import * as Constants from './constants';

// --- 简化类型 ---

// 简化的调试配置信息 (替代 vscode.DebugConfiguration)
export interface SimpleDebugConfiguration {
    name: string;
    type: string;
    request: string;
    [key: string]: any; // 允许其他属性
}

// 简化的断点信息 (替代 vscode.Breakpoint)
export interface SimpleBreakpointInfo {
    id?: number; // VS Code Breakpoint ID 可能在 set 时还未分配
    verified: boolean;
    source?: { path?: string; name?: string };
    line?: number;
    column?: number;
    message?: string;
    condition?: string;
    hitCondition?: string;
    logMessage?: string;
}

// --- 参数类型定义 ---

export interface SetBreakpointParams {
    file_path: string;
    line_number: number;
    column_number?: number;
    condition?: string;
    hit_condition?: string;
    log_message?: string;
}

export interface RemoveBreakpointParams {
  breakpoint_id?: number;
  location?: {
    file_path: string;
    line_number: number;
  };
  clear_all?: boolean;
}

export interface ContinueDebuggingParams {
    session_id?: string;
    thread_id: number;
}

// --- IPC 响应结构 ---

export interface PluginResponse<P = any, E = { message: string }> {
    type: 'response';
    requestId: string;
    status: typeof Constants.IPC_STATUS_SUCCESS | typeof Constants.IPC_STATUS_ERROR;
    payload?: P;
    error?: E;
}

export type GetConfigurationsResponsePayload = { configurations: SimpleDebugConfiguration[] }; // 使用简化类型
export type SetBreakpointResponsePayload = { breakpoint: SimpleBreakpointInfo; timestamp: string }; // 使用简化类型
export type GetBreakpointsResponsePayload = { breakpoints: SimpleBreakpointInfo[]; timestamp: string }; // 使用简化类型
export type RemoveBreakpointResponsePayload = { message?: string };

// --- startDebugging 类型定义 ---

export interface StartDebuggingRequestPayload {
  configurationName: string;
  noDebug: boolean;
}

export interface VariableInfo {
  name: string;
  value: string;
  type: string | null;
  variables_reference: number; // >0 表示可展开
  evaluate_name?: string;
  memory_reference?: string;
}

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
  call_stack: {
    frame_id: number;
    function_name: string;
    file_path: string;
    line_number: number;
    column_number: number;
  }[];
  top_frame_variables?: { // 顶层帧变量快照
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

// --- stepExecution 类型定义 ---

/**
 * step_execution 工具的输入参数类型
 */
export interface StepExecutionParams {
    session_id?: string;
  /**
   * 需要执行单步操作的线程的 ID (从 stop_event_data.thread_id 获取)。
   */
  thread_id: number;
  /**
   * 指定单步执行的具体类型: 'over', 'into', 'out'。
   */
  step_type: 'over' | 'into' | 'out';
}

/**
 * VS Code 插件端执行 stepExecution 操作后返回给 MCP 服务器的结果类型
 */
export type StepExecutionResult =
  | { status: 'stopped'; stop_event_data: StopEventData }
  | { status: 'completed'; message: string }
  | { status: 'timeout'; message: string }
  | { status: 'interrupted'; message: string } // 如果支持中断
  | { status: 'error'; message: string };

export interface StopDebuggingPayload {
  sessionId?: string;
}

// 注意：不再需要 PluginRequestData 和 PluginResponseData 联合类型，
// 因为 mcp-server 只处理响应，不构建完整请求。