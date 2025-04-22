import { v4 as uuidv4 } from 'uuid';

// 定义 PluginRequest 接口
// 定义 PluginRequest 接口 (与 src/mcpServerManager.ts 一致)
export interface PluginRequest {
    type: 'request';
    command: string; // 请求类型，例如 'setBreakpoint'
    requestId: string; // 请求的唯一标识符
    payload?: any; // 请求携带的数据
}

// 定义 PluginResponse 接口 (使其支持泛型)
export interface PluginResponse<P = any, E = { message: string }> {
    type: 'response';
    requestId: string; // 响应对应的请求标识符
    status: 'success' | 'error'; // 标识请求是否成功
    payload?: P; // 响应携带的数据 (泛型)
    error?: E; // 如果失败，包含错误信息对象 (泛型)
}

// 用于存储待处理的请求 Promise (更新 resolve 类型以匹配泛型 PluginResponse)
const pendingRequests = new Map<string, { resolve: (response: PluginResponse<any>) => void, reject: (error: Error) => void, timeout: NodeJS.Timeout }>();

// 向插件发送请求 (更新返回值类型以匹配泛型 PluginResponse)
// 注意：输入参数的 'type' 字段将被映射到 PluginRequest 的 'command' 字段
export function sendRequestToPlugin<T = any>(request: { type: string; payload?: any }, timeoutMs: number = 5000): Promise<PluginResponse<T>> {
    return new Promise<PluginResponse<T>>((resolve, reject) => { // 返回泛型 Promise
        const requestId = uuidv4(); // 生成唯一 ID
        const fullRequest: PluginRequest = {
            type: 'request',
            command: request.type, // 将输入的 type 映射到 command
            requestId: requestId,
            payload: request.payload
        };

        // 设置超时
        const timeout = setTimeout(() => {
            pendingRequests.delete(requestId);
            reject(new Error(`Plugin request timed out after ${timeoutMs}ms for command: ${fullRequest.command}`));
        }, timeoutMs);

        // 存储 Promise 的 resolve/reject 和超时 ID
        pendingRequests.set(requestId, { resolve, reject, timeout });

        // 发送消息给父进程 (VS Code 扩展)
        // process.send 仅在子进程中可用
        if (process.send) {
            process.send(fullRequest);
        } else {
            // 如果不是子进程环境，直接拒绝
            pendingRequests.delete(requestId);
            clearTimeout(timeout);
            reject(new Error("process.send is not available. This function should be run in a child process."));
        }
    });
}

// 处理来自插件的响应 (更新参数类型以匹配泛型 PluginResponse)
export function handlePluginResponse(response: PluginResponse<any>): void {
    // 基本类型检查，确保是预期的响应结构
    if (response?.type !== 'response' || !response.requestId) {
        console.error(`[MCP Server] Received invalid IPC response:`, response);
        return;
    }

    const pending = pendingRequests.get(response.requestId);
    if (pending) {
        clearTimeout(pending.timeout); // 清除超时
        pendingRequests.delete(response.requestId); // 从 Map 中移除

        if (response.status === 'success') {
            pending.resolve(response); // 解决 Promise
        } else {
            // 使用 response.error.message (如果存在)
            const errorMessage = response.error?.message || `Plugin request failed for ID: ${response.requestId}`;
            pending.reject(new Error(errorMessage)); // 拒绝 Promise
        }
    } else {
        // 收到未知 ID 的响应，可能是超时后才收到的响应
        console.warn(`[MCP Server] Received response for unknown or timed out request ID: ${response.requestId}`);
    }
}

// 导出相关函数或实例，这里直接导出函数
// export const pluginCommunicator = { sendRequestToPlugin, handlePluginResponse };