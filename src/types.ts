/**
 * 定义插件与 MCP 服务器之间 IPC 通信的共享类型。
 */

export interface PluginRequest {
    type: 'request';
    command: string;
    requestId: string;
    payload: any;
}

export interface PluginResponse {
    type: 'response';
    requestId: string;
    status: 'success' | 'error';
    payload?: any;
    error?: { message: string };
}