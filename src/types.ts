import * as vscode from 'vscode';
import {
    IPC_COMMAND_GET_CONFIGURATIONS,
    IPC_COMMAND_SET_BREAKPOINT,
    IPC_COMMAND_GET_BREAKPOINTS,
    IPC_COMMAND_REMOVE_BREAKPOINT,
    IPC_STATUS_SUCCESS,
    IPC_STATUS_ERROR
} from './constants';

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

// 具体请求类型联合 (用于 IpcHandler)
export type PluginRequestData =
  | PluginRequest<undefined> & { command: typeof IPC_COMMAND_GET_CONFIGURATIONS }
  | PluginRequest<SetBreakpointParams> & { command: typeof IPC_COMMAND_SET_BREAKPOINT }
  | PluginRequest<undefined> & { command: typeof IPC_COMMAND_GET_BREAKPOINTS }
  | PluginRequest<RemoveBreakpointParams> & { command: typeof IPC_COMMAND_REMOVE_BREAKPOINT };
  // | PluginRequest<any> & { command: 'someOtherCommand' }; // 可扩展其他命令

// --- IPC 响应结构 ---

// 通用响应接口 (保持原有结构，但 payload 和 error 类型更具体)
export interface PluginResponse<P = any, E = { message: string }> {
    type: 'response';
    requestId: string;
    status: typeof IPC_STATUS_SUCCESS | typeof IPC_STATUS_ERROR;
    payload?: P;
    error?: E;
}

// 具体成功响应的 Payload 类型
type GetConfigurationsResponsePayload = { configurations: vscode.DebugConfiguration[] };
type SetBreakpointResponsePayload = { breakpoint: vscode.Breakpoint; timestamp: string }; // 假设返回 Breakpoint 和时间戳
type GetBreakpointsResponsePayload = { breakpoints: vscode.Breakpoint[]; timestamp: string };
type RemoveBreakpointResponsePayload = { message?: string }; // 成功时只有可选消息

// 具体响应类型联合 (用于 IpcHandler 返回和 MCP Server 接收)
export type PluginResponseData =
  | PluginResponse<GetConfigurationsResponsePayload> & { status: typeof IPC_STATUS_SUCCESS } // getConfigurations 成功
  | PluginResponse<SetBreakpointResponsePayload> & { status: typeof IPC_STATUS_SUCCESS } // setBreakpoint 成功
  | PluginResponse<GetBreakpointsResponsePayload> & { status: typeof IPC_STATUS_SUCCESS } // getBreakpoints 成功
  | PluginResponse<RemoveBreakpointResponsePayload> & { status: typeof IPC_STATUS_SUCCESS } // removeBreakpoint 成功
  | PluginResponse<undefined, { message: string }> & { status: typeof IPC_STATUS_ERROR }; // 通用错误响应