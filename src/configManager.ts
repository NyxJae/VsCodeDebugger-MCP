import * as vscode from 'vscode';
import { DEFAULT_MCP_PORT, MCP_PORT_KEY, isValidPort } from './utils/portUtils';

/**
 * 从全局状态中获取存储的端口号。
 * 如果没有存储或存储的值无效，则返回默认端口号。
 * @param context 扩展上下文
 * @returns 存储的或默认的端口号
 */
export function getStoredPort(context: vscode.ExtensionContext): number {
    const storedPort = context.globalState.get<number>(MCP_PORT_KEY);
    if (storedPort !== undefined && isValidPort(storedPort)) {
        return storedPort;
    }
    return DEFAULT_MCP_PORT;
}

/**
 * 将端口号存储到全局状态中。
 * 只有当端口号有效时才进行存储。
 * @param context 扩展上下文
 * @param port 要存储的端口号
 */
export async function storePort(context: vscode.ExtensionContext, port: number): Promise<void> {
    if (isValidPort(port)) {
        await context.globalState.update(MCP_PORT_KEY, port);
    } else {
        console.error(`尝试存储无效的端口号: ${port}`);
    }
}