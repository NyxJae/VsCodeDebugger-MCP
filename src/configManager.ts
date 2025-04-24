import * as vscode from 'vscode';
import { DEFAULT_MCP_PORT, MCP_PORT_KEY, isValidPort } from './utils/portUtils';
// 导入自动启动相关的常量
import { AUTO_START_KEY, DEFAULT_AUTO_START } from './constants';

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

/**
 * 获取存储的自动启动配置。
 */
export function getAutoStartConfig(context: vscode.ExtensionContext): boolean {
    // 明确指定类型为 boolean，并提供默认值
    const storedValue = context.globalState.get<boolean>(AUTO_START_KEY);
    // 如果存储的值是 undefined，则返回默认值
    if (storedValue === undefined) {
        return DEFAULT_AUTO_START;
    }
    // 确保返回的是布尔值
    return !!storedValue;
}

/**
 * 存储自动启动配置。
 */
export async function storeAutoStartConfig(context: vscode.ExtensionContext, autoStart: boolean): Promise<void> {
    // 直接存储布尔值
    await context.globalState.update(AUTO_START_KEY, autoStart);
    console.log(`Auto-start config updated to: ${autoStart}`);
}