import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { StatusBarManager, McpServerStatus } from './statusBarManager'; // 引入状态栏管理器并导入 McpServerStatus
import { getStoredPort, storePort } from './configManager'; // 导入配置管理函数
import { isPortInUse, isValidPort } from './utils/portUtils'; // 导入端口工具函数

/**
 * 管理 MCP 服务器子进程的启动、停止和状态。
 */
export class McpServerManager implements vscode.Disposable {
    private mcpServerProcess: ChildProcess | null = null;
    private currentPort: number | null = null;
    private readonly serverScriptPath: string;
    private readonly serverCwd: string;
    private readonly outputChannel: vscode.OutputChannel;

    /**
     * 创建一个新的 McpServerManager 实例。
     * @param context VS Code 扩展上下文。
     * @param statusBarManager 状态栏管理器实例。
     */
    constructor(
        private context: vscode.ExtensionContext,
        private statusBarManager: StatusBarManager
    ) {
        // 构建 mcp-server/dist/server.js 的绝对路径
        this.serverScriptPath = path.join(context.extensionPath, 'mcp-server', 'dist', 'server.js');
        // 设置子进程的工作目录为 mcp-server
        this.serverCwd = path.join(context.extensionPath, 'mcp-server');
        // 创建或获取名为 "MCP Server" 的 OutputChannel
        this.outputChannel = vscode.window.createOutputChannel('Debug MCP Server');
    }

    /**
     * 检查 MCP 服务器是否正在运行。
     * @returns 如果服务器正在运行则返回 true，否则返回 false。
     */
    public isRunning(): boolean {
        return this.mcpServerProcess !== null;
    }

    /**
     * 启动 MCP 服务器子进程。
     */
    public async startServer(): Promise<void> {
        // 防止重复启动
        if (this.mcpServerProcess) {
            vscode.window.showInformationMessage('MCP 服务器已在运行。');
            return;
        }

        let targetPort = getStoredPort(this.context);
        let portAvailable = false;

        try {
            const inUse = await isPortInUse(targetPort);
            if (inUse) {
                const newPort = await this.handlePortConflict(targetPort);
                if (newPort !== null) {
                    targetPort = newPort; // Update target port
                    // Again check if the new port is available
                    const newPortInUse = await isPortInUse(targetPort);
                    if (!newPortInUse) {
                       portAvailable = true;
                    } else {
                        vscode.window.showErrorMessage(`新端口 ${targetPort} 仍然被占用。请检查或尝试其他端口。`);
                        this.handleServerError(); // Use unified error handler
                        return; // Cannot start
                    }
                } else {
                    // User cancelled or invalid input, do not start server
                    this.statusBarManager.setStatus('stopped', null); // Ensure status bar is updated
                    return;
                }
            } else {
                portAvailable = true; // Original port is available
            }

            if (portAvailable) {
                this.statusBarManager.setStatus('starting', targetPort); // Update status bar to starting
                this.outputChannel.appendLine(`Attempting to start Debug MCP server on port ${targetPort}...`);
                this.outputChannel.show(true);

                // Start server process, pass port via environment variable
                const serverPath = path.join(this.context.extensionUri.fsPath, 'mcp-server', 'dist', 'server.js'); // Ensure path is correct
                const nodePath = process.execPath; // Use current VS Code's Node.js path

                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) {
                    vscode.window.showErrorMessage('无法启动 Debug-MCP 服务器：请先打开一个工作区文件夹。');
                    this.statusBarManager.setStatus('error', null); // 更新状态栏提示为错误状态
                    return; // 提前返回，不启动服务器
                }
                // 暂时只处理第一个工作区, 实际应用中可能需要更复杂的逻辑来处理多工作区情况
                const workspacePath = workspaceFolders[0].uri.fsPath;
                console.log(`[MCP Server Manager] Workspace path: ${workspacePath}`); // 添加日志

                // Pass port and workspace path to server process via environment variables
                const env = {
                    ...process.env, // Inherit current environment variables
                    MCP_PORT: targetPort.toString(), // Existing port environment variable
                    VSCODE_WORKSPACE_PATH: workspacePath // New workspace path environment variable
                };

                this.mcpServerProcess = spawn(nodePath, [serverPath], { env: env, stdio: ['pipe', 'pipe', 'pipe'] }); // Ensure stdio is set correctly to capture output

                console.log(`[MCP Server Manager] Spawning server process with PID: ${this.mcpServerProcess.pid}`);
                this.outputChannel.appendLine(`Spawning server process with PID: ${this.mcpServerProcess.pid}`);


                this.mcpServerProcess.stdout?.on('data', (data: Buffer) => {
                    const output = data.toString();
                    console.log(`MCP Server stdout: ${output}`);
                    this.outputChannel.appendLine(`[stdout] ${output}`);
                    // **Key:** Check for specific output indicating successful server start
                    // 修改匹配逻辑以更精确地匹配服务器实际输出的格式
                    if (output.includes(`Debug MCP Server listening on http://localhost:${targetPort}`)) {
                         this.currentPort = targetPort;
                         this.statusBarManager.setStatus('running', this.currentPort);
                         vscode.window.showInformationMessage(`MCP 服务器已在端口 ${this.currentPort} 启动。`);
                         this.outputChannel.appendLine(`MCP Server successfully started, listening on port ${this.currentPort}.`);
                    }
                });

                this.mcpServerProcess.stderr?.on('data', (data: Buffer) => {
                    const errorOutput = data.toString();
                    console.error(`MCP Server stderr: ${errorOutput.trim()}`);
                    this.outputChannel.append(`[stderr] ${errorOutput}`);
                    this.outputChannel.show(true);
                });

                this.mcpServerProcess.on('error', (err) => {
                    console.error('Failed to start MCP server process:', err);
                    this.handleServerError(`启动 MCP 服务器进程失败: ${err.message}`); // Use unified error handler
                });

                this.mcpServerProcess.on('close', (code) => {
                    console.log(`MCP server process exited with code ${code}`);
                    this.outputChannel.appendLine(`MCP server process exited with code ${code}`);
                    // Only treat as error or unexpected close if not explicitly stopped by user
                    if (this.mcpServerProcess) { // Check if it was not explicitly set to null by stopServer
                       this.handleServerError(`服务器进程意外退出，退出码: ${code}`); // Use unified error handler
                    } else {
                        // Process was stopped by stopServer, status is already 'Stopped'
                        console.log('MCP server process stopped by user.');
                    }
                });
            }
        } catch (error: any) {
            console.error('Error starting MCP server:', error);
            this.handleServerError(`启动 MCP 服务器时出错: ${error.message}`); // Use unified error handler
        }
    }

    /**
     * 停止正在运行的 MCP 服务器子进程。
     */
    public stopServer(): void {
        if (!this.mcpServerProcess) {
            vscode.window.showInformationMessage('Debug MCP Server is not running.');
            // Ensure status is stopped
            if (this.statusBarManager.getStatus() !== 'stopped') { // Check for 'stopped' status
                 this.statusBarManager.setStatus('stopped', null); // Set status to 'stopped'
            }
            return;
        }

        console.log('Stopping MCP server...');
        this.outputChannel.appendLine('Attempting to stop Debug MCP Server...');
        const processToKill = this.mcpServerProcess;
        this.mcpServerProcess = null; // Set to null BEFORE killing to prevent handleServerError on close
        this.currentPort = null; // Reset current port
        this.statusBarManager.setStatus('stopped', null); // Set status to 'stopped' immediately
        try {
            processToKill.kill('SIGTERM'); // Send SIGTERM signal
            console.log('SIGTERM signal sent to Debug MCP Server.');
            this.outputChannel.appendLine('SIGTERM signal sent to Debug MCP Server. Waiting for exit...');
        } catch (error: any) {
            console.error('Error sending SIGTERM to MCP server process:', error);
            this.outputChannel.appendLine(`Error sending SIGTERM: ${error.message}`);
            // If kill fails, the process might already be gone or in a bad state.
            // handleServerError was already prevented by setting mcpServerProcess to null.
            // Status is already 'Stopped'. Just log the error.
        }
        vscode.window.showInformationMessage('MCP 服务器已停止。');
    }

    /**
     * 生成符合 RooCode/Cline 要求的 MCP 服务器配置 JSON 字符串，并复制到剪贴板。
     */
    public async copyMcpConfigToClipboard(): Promise<void> {
        try {
            // Use currentPort if available, otherwise use the stored port
            const portToUse = this.currentPort ?? getStoredPort(this.context);

            if (!portToUse) {
                 vscode.window.showWarningMessage('MCP Server port is not set. Cannot copy config.');
                 this.outputChannel.appendLine('Attempted to copy config, but port is not set.');
                 return;
            }

            // Generate config based on the determined port
            const mcpConfig = {
                mcpServers: {
                    "vscode-debugger-mcp": { // Server name
                        url: `http://localhost:${portToUse}/mcp`, // Use the determined port
                        headers: {} // Add empty headers
                    }
                }
            };

            const configString = JSON.stringify(mcpConfig, null, 2);
            await vscode.env.clipboard.writeText(configString);
            vscode.window.showInformationMessage(`MCP server configuration (Port: ${portToUse}) copied to clipboard!`);
            this.outputChannel.appendLine(`MCP server configuration (Port: ${portToUse}) copied to clipboard.`);
            console.log('MCP config copied:', configString);

        } catch (error: unknown) {
            const errorMsg = `Failed to copy MCP config: ${error instanceof Error ? error.message : String(error)}`;
            console.error(errorMsg);
            this.outputChannel.appendLine(`Error: ${errorMsg}`);
            vscode.window.showErrorMessage(errorMsg);
            this.outputChannel.show(true);
        }
    }

    /**
     * 新增：处理端口冲突的函数
     */
    private async handlePortConflict(occupiedPort: number): Promise<number | null> {
        const choice = await vscode.window.showWarningMessage(
            `MCP 服务器端口 ${occupiedPort} 已被占用。`,
            { modal: true }, // Modal dialog
            '输入新端口'
        );

        if (choice === '输入新端口') {
            const newPortStr = await vscode.window.showInputBox({
                prompt: `请输入一个新的端口号 (1025-65535)，当前端口 ${occupiedPort} 被占用。`,
                placeHolder: '例如: 6010',
                validateInput: (value) => {
                    if (!value) return '端口号不能为空。';
                    if (!isValidPort(value)) {
                        return '请输入 1025 到 65535 之间的有效端口号。';
                    }
                    return null; // Validation passed
                }
            });

            if (newPortStr) {
                const newPort = parseInt(newPortStr, 10);
                await storePort(this.context, newPort); // Persist the new port
                return newPort;
            }
        }
        // User cancelled or closed the notification
        vscode.window.showInformationMessage('MCP 服务器启动已取消。');
        return null;
    }

     /**
      * 新增：统一的错误处理和状态重置
      */
    private handleServerError(errorMessage?: string): void {
        if (errorMessage) {
           vscode.window.showErrorMessage(`MCP 服务器错误: ${errorMessage}`);
           this.outputChannel.appendLine(`Error: ${errorMessage}`);
           this.outputChannel.show(true);
        }
        this.mcpServerProcess = null;
        this.currentPort = null;
        this.statusBarManager.setStatus('error', null); // Use lowercase 'error'
    }

    /**
     * 重启 MCP 服务器。
     */
    public async restartServer(): Promise<void> {
        console.log('Restarting MCP server...');
        this.outputChannel.appendLine('Restarting Debug MCP Server...');
        this.stopServer(); // 先停止服务器
        // stopServer 已经将 this.mcpServerProcess 设置为 null，
        // 并且其 close 事件处理不会触发 handleServerError，
        // 所以可以直接调用 startServer
        await this.startServer(); // 再启动服务器
    }


    /**
     * 实现 vscode.Disposable 接口，用于在插件停用时清理资源。
     */
    dispose(): void {
        console.log('Disposing McpServerManager...');
        this.stopServer(); // Ensure server is stopped when extension is deactivated
        this.outputChannel.dispose(); // Dispose of the OutputChannel
    }
}