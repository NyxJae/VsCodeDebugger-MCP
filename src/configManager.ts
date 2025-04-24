import * as vscode from 'vscode';
import { DEFAULT_MCP_PORT, MCP_PORT_KEY, isValidPort } from './utils/portUtils';

/**
 * 获取存储的MCP端口号，如果无效则返回默认端口。
 */
export function getStoredPort(context: vscode.ExtensionContext): number {
    const storedPort = context.globalState.get<number>(MCP_PORT_KEY);
    if (storedPort !== undefined && isValidPort(storedPort)) {
        return storedPort;
    }
    return DEFAULT_MCP_PORT;
}

/**
 * 存储有效的MCP端口号。
 */
export async function storePort(context: vscode.ExtensionContext, port: number): Promise<void> {
    if (isValidPort(port)) {
        await context.globalState.update(MCP_PORT_KEY, port);
    } else {
        console.error(`尝试存储无效的端口号: ${port}`);
    }
}