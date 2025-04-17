import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { StatusBarManager } from './statusBarManager'; // 引入状态栏管理器

/**
 * 管理 MCP 服务器子进程的启动、停止和状态。
 */
export class McpServerManager implements vscode.Disposable {
    private serverProcess: ChildProcess | null = null;
    private currentBaseUrl: string | null = null; // 新增：存储基础 URL
    private readonly serverScriptPath: string;
    private readonly serverCwd: string;
    private readonly outputChannel: vscode.OutputChannel; // 添加 OutputChannel 成员

    /**
     * 创建一个新的 McpServerManager 实例。
     * @param context VS Code 扩展上下文。
     * @param statusBarManager 状态栏管理器实例。
     */
    constructor(
        private context: vscode.ExtensionContext,
        private statusBarManager: StatusBarManager // 依赖注入 StatusBarManager
    ) {
        // 构建 mcp-server/dist/server.js 的绝对路径
        this.serverScriptPath = path.join(context.extensionPath, 'mcp-server', 'dist', 'server.js');
        // 设置子进程的工作目录为 mcp-server
        this.serverCwd = path.join(context.extensionPath, 'mcp-server');
        // 创建或获取名为 "MCP Server" 的 OutputChannel
        this.outputChannel = vscode.window.createOutputChannel('Debug MCP Server');
    }

    /**
     * 启动 MCP 服务器子进程。
     */
    public startServer(): void {
        // 防止重复启动
        if (this.serverProcess) {
            vscode.window.showWarningMessage('Debug MCP Server is already running or starting.');
            return;
        }

        // 更新状态为 'starting'
        this.statusBarManager.setStatus('starting');
        console.log('Attempting to start Debug MCP server...');
        this.outputChannel.appendLine('Attempting to start Debug MCP server...'); // 输出到 OutputChannel
        this.outputChannel.show(true); // 启动时显示 OutputChannel

        try {
            // 使用 spawn 启动 Node.js 进程执行服务器脚本
            this.serverProcess = spawn('node', [this.serverScriptPath], {
                cwd: this.serverCwd, // 设置工作目录
                stdio: ['pipe', 'pipe', 'pipe'], // 捕获 stdin, stdout, stderr
            });

            console.log(`Spawning server process with PID: ${this.serverProcess.pid}`);
            this.outputChannel.appendLine(`Spawning server process with PID: ${this.serverProcess.pid}`);

            // 监听 stdout
            this.serverProcess.stdout?.on('data', (data: Buffer) => {
                const message = data.toString().trim();
                console.log(`Debug MCP Server stdout: ${message}`);
                this.outputChannel.appendLine(`[stdout] ${message}`);

                // **修改:** 使用正则捕获监听 URL
                const match = message.match(/listening on (http:\/\/localhost:\d+)/);
                if (match && match[1]) {
                    this.currentBaseUrl = match[1]; // 存储基础 URL
                    // 从 URL 中提取端口号用于状态栏显示
                    const portMatch = this.currentBaseUrl.match(/:(\d+)$/);
                    const port = portMatch ? parseInt(portMatch[1], 10) : null;
                    // 注意：setStatus 将在 statusBarManager.ts 中更新以接受端口参数
                    this.statusBarManager.setStatus('running', port); // 更新状态栏，传入端口
                    console.log(`Debug MCP Server successfully started, listening on ${this.currentBaseUrl}.`);
                    this.outputChannel.appendLine(`Debug MCP Server successfully started, listening on ${this.currentBaseUrl}.`);
                }
            });

            // 监听 stderr
            this.serverProcess.stderr?.on('data', (data: Buffer) => {
                const errorMessage = data.toString(); // 保留原始格式，包括换行符
                console.error(`Debug MCP Server stderr: ${errorMessage.trim()}`);
                this.outputChannel.append(`[stderr] ${errorMessage}`); // 输出到 OutputChannel
                this.outputChannel.show(true); // 发生错误时确保 OutputChannel 可见
                // 不再使用 vscode.window.showErrorMessage，让用户查看 OutputChannel
            });

            // 监听进程退出事件
            this.serverProcess.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
                const exitMessage = `Debug MCP Server process exited with code ${code}, signal ${signal}`;
                console.log(exitMessage);
                this.outputChannel.appendLine(exitMessage);
                // 只有在非正常退出 (code !== 0 且非 SIGTERM 信号) 或非主动停止时才标记为错误
                // 如果是 SIGTERM 信号，说明是 stopServer 主动停止的
                if (signal !== 'SIGTERM' && code !== 0 && code !== null) { // 增加 code !== null 判断
                    this.statusBarManager.setStatus('error');
                    // Enhance error message for unexpected exits, hinting at potential port issues during startup
                    let errorMsg = `Debug MCP Server stopped unexpectedly (Code: ${code}, Signal: ${signal}).`;
                    // 如果 URL 从未被设置 (即服务器从未成功报告监听) 且退出码非 0 (已经在外部 if 判断过), 很可能是在启动阶段失败
                    // 移除内部的 signal !== 'SIGTERM' 检查以修复 TS 错误，因为外部 if 已保证这一点
                    if (this.currentBaseUrl === null && code !== 0) {
                        errorMsg += ` This might be due to issues during startup, such as the configured port being already in use.`;
                    }
                    errorMsg += ` Check the 'Debug MCP Server' output channel for more details.`;
                    vscode.window.showErrorMessage(errorMsg);
                    this.outputChannel.appendLine(`Error: ${errorMsg}`);
                    this.outputChannel.show(true); // 确保错误时显示
                } else {
                    // 正常退出或手动停止
                    this.statusBarManager.setStatus('stopped');
                    this.outputChannel.appendLine('Debug MCP Server stopped.');
                }
                this.currentBaseUrl = null; // 重置 URL
                this.serverProcess = null; // 清理引用
            });

            // 监听进程错误事件 (例如，无法启动进程)
            this.serverProcess.on('error', (err: Error) => {
                // This usually catches errors like 'spawn ENOENT' if node isn't found or permissions issues
                const errorMsg = `Failed to start Debug MCP Server process: ${err.message}. Ensure Node.js is installed and the extension has permission to execute it. Check the 'Debug MCP Server' output channel.`;
                console.error(errorMsg);
                this.outputChannel.appendLine(`Error: ${errorMsg}`);
                vscode.window.showErrorMessage(errorMsg);
                this.statusBarManager.setStatus('error');
                this.currentBaseUrl = null; // 重置 URL
                this.serverProcess = null; // 清理引用
                this.outputChannel.show(true); // 确保错误时显示
            });

        } catch (error: unknown) { // Use unknown for better type safety
            const errorMsg = `Error spawning Debug MCP Server process: ${error instanceof Error ? error.message : String(error)}`; // Type check error
            console.error(errorMsg);
            this.outputChannel.appendLine(`Error: ${errorMsg}`);
            vscode.window.showErrorMessage(errorMsg);
            this.statusBarManager.setStatus('error');
            this.currentBaseUrl = null; // 重置 URL
            this.serverProcess = null; // 清理引用
            this.outputChannel.show(true); // 确保错误时显示
        }
    }

    /**
     * 停止正在运行的 MCP 服务器子进程。
     */
    public stopServer(): void {
        if (!this.serverProcess) {
            vscode.window.showInformationMessage('Debug MCP Server is not running.');
            // 确保状态是 stopped
            if (this.statusBarManager.getStatus() !== 'stopped') {
                 this.statusBarManager.setStatus('stopped');
            }
            return;
        }

        const pid = this.serverProcess.pid;
        console.log(`Attempting to stop Debug MCP Server (PID: ${pid})...`);
        this.outputChannel.appendLine(`Attempting to stop Debug MCP Server (PID: ${pid})...`);
        // 发送 SIGTERM 信号请求优雅退出
        // 'exit' 事件监听器会处理状态更新和引用清理
        try {
            const killed = this.serverProcess.kill('SIGTERM'); // kill can throw if process doesn't exist
            if (!killed) {
                // This case might be less likely if kill throws, but handle defensively
                const errorMsg = `Failed to send SIGTERM to Debug MCP Server process (PID: ${pid}). kill() returned false.`;
                console.error(errorMsg);
                this.outputChannel.appendLine(`Error: ${errorMsg}`);
                this.statusBarManager.setStatus('error');
                vscode.window.showErrorMessage('Failed to send stop signal to Debug MCP Server. Check Output Channel.');
                this.outputChannel.show(true);
                // 强制清理引用，避免状态不一致
                this.currentBaseUrl = null; // 重置 URL
                this.serverProcess = null;
            } else {
                console.log(`SIGTERM signal sent to Debug MCP Server (PID: ${pid}).`);
                this.outputChannel.appendLine(`SIGTERM signal sent to Debug MCP Server (PID: ${pid}). Waiting for exit...`);
                // 不在此处更新状态，等待 'exit' 事件处理
            }
        } catch (error: unknown) {
             // 处理 kill 可能抛出的错误 (例如进程已不存在)
            const errorMsg = `Error stopping Debug MCP Server process (PID: ${pid}): ${error instanceof Error ? error.message : String(error)}`;
            console.error(errorMsg);
            this.outputChannel.appendLine(`Error: ${errorMsg}`);
            this.statusBarManager.setStatus('error'); // 标记为错误状态
            vscode.window.showErrorMessage('Error trying to stop Debug MCP Server. Check Output Channel.');
            this.outputChannel.show(true);
            // 强制清理引用
            this.currentBaseUrl = null; // 重置 URL
            this.serverProcess = null;
        }
    }

    /**
     * 生成符合 RooCode/Cline 要求的 MCP 服务器配置 JSON 字符串，并复制到剪贴板。
     */
    public async copyMcpConfigToClipboard(): Promise<void> {
        try {
            if (this.statusBarManager.getStatus() !== 'running' || !this.currentBaseUrl) {
                 vscode.window.showWarningMessage('Debug MCP Server is not running or URL is unknown. Cannot copy SSE config.');
                 this.outputChannel.appendLine('Attempted to copy SSE config, but server not running or URL unknown.');
                 return;
            }

            // **修改:** 生成 SSE 配置
            // **修改:** 移除不再需要的 sseUrl 和 postUrl 变量

            // **修改:** 生成符合 Cline SSE 文档要求的配置
            const mcpConfig = {
                mcpServers: {
                    "vscode-debugger-mcp": { // 服务器名称保持不变
                        url: this.currentBaseUrl, // 使用基础 URL
                        headers: {} // 添加空的 headers
                    }
                }
            };

            const configString = JSON.stringify(mcpConfig, null, 2);
            await vscode.env.clipboard.writeText(configString);
            vscode.window.showInformationMessage(`MCP server configuration (URL: ${this.currentBaseUrl}) copied to clipboard!`);
            this.outputChannel.appendLine(`MCP server configuration (URL: ${this.currentBaseUrl}) copied to clipboard.`);
            console.log('MCP config copied:', configString);

        } catch (error: unknown) { // Use unknown for better type safety
            const errorMsg = `Failed to copy MCP SSE config: ${error instanceof Error ? error.message : String(error)}`; // Type check error
            console.error(errorMsg);
            this.outputChannel.appendLine(`Error: ${errorMsg}`);
            vscode.window.showErrorMessage(errorMsg);
            this.outputChannel.show(true);
        }
    }

    /**
     * 实现 vscode.Disposable 接口，用于在插件停用时清理资源。
     */
    dispose(): void {
        console.log('Disposing McpServerManager...');
        this.stopServer(); // 确保服务器在插件停用时停止
        this.outputChannel.dispose(); // 释放 OutputChannel 资源
    }
}