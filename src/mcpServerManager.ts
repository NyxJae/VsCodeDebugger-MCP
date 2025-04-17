import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { StatusBarManager } from './statusBarManager'; // 引入状态栏管理器

/**
 * 管理 MCP 服务器子进程的启动、停止和状态。
 */
export class McpServerManager implements vscode.Disposable {
    private serverProcess: ChildProcess | null = null;
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
                this.outputChannel.appendLine(`[stdout] ${message}`); // 输出到 OutputChannel
                // 检查是否收到启动成功消息
                if (message.includes('Debug MCP Server Started')) {
                    this.statusBarManager.setStatus('running');
                    console.log('Debug MCP Server successfully started.');
                    this.outputChannel.appendLine('Debug MCP Server successfully started.');
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
            this.serverProcess.on('exit', (code, signal) => {
                const exitMessage = `Debug MCP Server process exited with code ${code}, signal ${signal}`;
                console.log(exitMessage);
                this.outputChannel.appendLine(exitMessage);
                // 只有在非正常退出 (code !== 0 且非 SIGTERM 信号) 或非主动停止时才标记为错误
                // 如果是 SIGTERM 信号，说明是 stopServer 主动停止的
                if (signal !== 'SIGTERM' && code !== 0 && code !== null) { // 增加 code !== null 判断
                    this.statusBarManager.setStatus('error');
                    const errorMsg = `Debug MCP Server stopped unexpectedly (Code: ${code}, Signal: ${signal}). Check the 'Debug MCP Server' output channel for details.`;
                    vscode.window.showErrorMessage(errorMsg);
                    this.outputChannel.appendLine(`Error: ${errorMsg}`);
                    this.outputChannel.show(true); // 确保错误时显示
                } else {
                    // 正常退出或手动停止
                    this.statusBarManager.setStatus('stopped');
                    this.outputChannel.appendLine('Debug MCP Server stopped.');
                }
                this.serverProcess = null; // 清理引用
            });

            // 监听进程错误事件 (例如，无法启动进程)
            this.serverProcess.on('error', (err) => {
                console.error(`Failed to start Debug MCP Server process: ${err.message}`);
                const errorMsg = `Failed to start Debug MCP Server process: ${err.message}`;
                console.error(errorMsg);
                this.outputChannel.appendLine(`Error: ${errorMsg}`);
                vscode.window.showErrorMessage(errorMsg);
                this.statusBarManager.setStatus('error');
                this.serverProcess = null; // 清理引用
                this.outputChannel.show(true); // 确保错误时显示
            });

        } catch (error: any) {
            const errorMsg = `Error spawning Debug MCP Server process: ${error.message}`;
            console.error(errorMsg);
            this.outputChannel.appendLine(`Error: ${errorMsg}`);
            vscode.window.showErrorMessage(errorMsg);
            this.statusBarManager.setStatus('error');
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
        const killed = this.serverProcess.kill('SIGTERM');
        if (!killed) {
            const errorMsg = `Failed to send SIGTERM to Debug MCP Server process (PID: ${pid}).`;
            console.error(errorMsg);
            this.outputChannel.appendLine(`Error: ${errorMsg}`);
            // 如果发送信号失败，可能需要强制杀死，或者至少更新状态
            this.statusBarManager.setStatus('error'); // 或者保持 'running' 直到确认退出？这里设为 error
            vscode.window.showErrorMessage('Failed to send stop signal to Debug MCP Server. Check Output Channel.');
            this.outputChannel.show(true);
            // 强制清理引用，避免状态不一致
            this.serverProcess = null;
        } else {
            console.log(`SIGTERM signal sent to Debug MCP Server (PID: ${pid}).`);
            this.outputChannel.appendLine(`SIGTERM signal sent to Debug MCP Server (PID: ${pid}). Waiting for exit...`);
            // 不在此处更新状态，等待 'exit' 事件
        }
    }

/**
 * 生成符合 RooCode/Cline 要求的 MCP 服务器配置 JSON 字符串，并复制到剪贴板。
 */
public async copyMcpConfigToClipboard(): Promise<void> { // 改为 async
    try {
        // 1. 获取服务器脚本的绝对路径 (已在构造函数中获取 this.serverScriptPath)
        // 2. 处理路径分隔符，确保在 JSON 字符串中正确转义 (Windows: \ -> \\)
        const escapedServerScriptPath = this.serverScriptPath.replace(/\\/g, '\\\\');

        // 3. 生成符合要求的配置对象
        const mcpConfig = {
            mcpServers: {
                "vscode-debugger-mcp": { // 使用指定的键名
                    command: "node", // 固定为 "node"
                    args: [ escapedServerScriptPath ], // 数组，包含转义后的绝对路径
                    env: {} // 空对象
                }
            }
        };

        // 4. 将配置对象转换为格式化的 JSON 字符串
        const configString = JSON.stringify(mcpConfig, null, 2);

        // 5. 复制到剪贴板
        await vscode.env.clipboard.writeText(configString);

        // 6. 显示成功提示
        vscode.window.showInformationMessage('MCP server configuration (RooCode/Cline format) copied to clipboard!');
        this.outputChannel.appendLine('MCP server configuration (RooCode/Cline format) copied to clipboard.');
        console.log('MCP config (RooCode/Cline format) copied:', configString);

    } catch (error) {
        const errorMsg = `Failed to copy MCP config (RooCode/Cline format): ${error instanceof Error ? error.message : String(error)}`;
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