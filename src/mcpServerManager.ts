import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { StatusBarManager, McpServerStatus } from './statusBarManager'; // 引入状态栏管理器并导入 McpServerStatus
import { getStoredPort, storePort } from './configManager'; // 导入配置管理函数
import { isPortInUse, isValidPort } from './utils/portUtils'; // 导入端口工具函数

// 定义 IPC 消息接口 (与 CurrentTask.md 一致)
interface PluginRequest {
    type: 'request';
    command: string;
    requestId: string;
    payload: any;
}

interface PluginResponse {
    type: 'response';
    requestId: string;
    status: 'success' | 'error';
    payload?: any;
    error?: { message: string };
}


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
                    const newPortInUse = await isPortInUse(targetPort);
                    if (!newPortInUse) {
                       portAvailable = true;
                    } else {
                        vscode.window.showErrorMessage(`新端口 ${targetPort} 仍然被占用。请检查或尝试其他端口。`);
                        this.handleServerError(); // Use unified error handler
                        return; // Cannot start
                    }
                } else {
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

                const serverPath = path.join(this.context.extensionUri.fsPath, 'mcp-server', 'dist', 'server.js');
                const nodePath = process.execPath;

                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) {
                    vscode.window.showErrorMessage('无法启动 Debug-MCP 服务器：请先打开一个工作区文件夹。');
                    this.statusBarManager.setStatus('error', null);
                    return;
                }
                const workspacePath = workspaceFolders[0].uri.fsPath;
                console.log(`[MCP Server Manager] Workspace path: ${workspacePath}`);

                const env = {
                    ...process.env,
                    MCP_PORT: targetPort.toString(),
                    VSCODE_WORKSPACE_PATH: workspacePath
                };

                // 启用 IPC 通道: 修改 stdio 选项
                this.mcpServerProcess = spawn(nodePath, [serverPath], {
                    env: env,
                    stdio: ['pipe', 'pipe', 'pipe', 'ipc'] // 添加 'ipc'
                });

                console.log(`[MCP Server Manager] Spawning server process with PID: ${this.mcpServerProcess.pid}`);
                this.outputChannel.appendLine(`Spawning server process with PID: ${this.mcpServerProcess.pid}`);

                // --- IPC 消息监听器 ---
                this.mcpServerProcess.on('message', async (message: PluginRequest | any) => {
                    console.log('[Plugin] Received IPC message from server:', message);
                    this.outputChannel.appendLine(`[IPC] Received message: ${JSON.stringify(message)}`);

                    // 检查是否为 setBreakpoint 请求
                    if (message?.type === 'request' && message.command === 'setBreakpoint') {
                        const { requestId, payload } = message;
                        try {
                            const { filePath, lineNumber, columnNumber, condition, hitCondition, logMessage } = payload;

                            // 基本参数校验
                            if (!filePath || typeof lineNumber !== 'number' || lineNumber <= 0) {
                                throw new Error('Invalid setBreakpoint request payload: missing or invalid filePath or lineNumber.');
                            }

                            const uri = vscode.Uri.file(filePath);
                            // 行号在 VS Code API 中是 0-based，用户提供的是 1-based
                            const zeroBasedLine = lineNumber - 1;
                            const zeroBasedColumn = columnNumber ? columnNumber - 1 : 0; // 列号也是 0-based，如果提供的话
                            const position = new vscode.Position(zeroBasedLine, zeroBasedColumn);
                            const location = new vscode.Location(uri, position);

                            const breakpoint = new vscode.SourceBreakpoint(
                                location,
                                true, // enabled
                                condition,
                                hitCondition,
                                logMessage
                            );

                            // 调用 VS Code API 设置断点
                            await vscode.debug.addBreakpoints([breakpoint]);
                            this.outputChannel.appendLine(`[IPC] Added breakpoint via API for request ${requestId}`);

                            // --- 获取断点 ID (折中方案) ---
                            // addBreakpoints 不直接返回 ID，立即查询 breakpoints 列表
                            // 延迟一小段时间再查询，给 VS Code 一点时间更新内部列表
                            await new Promise(resolve => setTimeout(resolve, 100)); // e.g., 100ms delay

                            const currentBreakpoints = vscode.debug.breakpoints;
                            this.outputChannel.appendLine(`[IPC] Current breakpoints count after add: ${currentBreakpoints.length}`);

                            // 查找与刚添加的位置精确匹配的断点
                            const addedBp = currentBreakpoints.find(bp =>
                                bp instanceof vscode.SourceBreakpoint &&
                                bp.location.uri.fsPath === uri.fsPath &&
                                bp.location.range.start.line === zeroBasedLine &&
                                bp.location.range.start.character === zeroBasedColumn // 尝试匹配列号
                            ) as vscode.SourceBreakpoint | undefined;

                            let breakpointId: string | undefined = addedBp?.id;
                            let bpMessage: string;

                            if (breakpointId) {
                                bpMessage = "Breakpoint added, verification pending.";
                                this.outputChannel.appendLine(`[IPC] Found matching breakpoint ID: ${breakpointId}`);
                            } else {
                                // 如果精确匹配失败，尝试只匹配行号（作为备选方案）
                                const addedBpFallback = currentBreakpoints
                                    .filter(bp => bp instanceof vscode.SourceBreakpoint &&
                                                  bp.location.uri.fsPath === uri.fsPath &&
                                                  bp.location.range.start.line === zeroBasedLine)
                                    .pop() as vscode.SourceBreakpoint | undefined; // 取最后一个匹配行的

                                breakpointId = addedBpFallback?.id;
                                if (breakpointId) {
                                    bpMessage = "Breakpoint added (ID found by line match), verification pending.";
                                    this.outputChannel.appendLine(`[IPC] Found matching breakpoint ID by line: ${breakpointId}`);
                                } else {
                                    bpMessage = "Breakpoint added (ID unavailable immediately), verification pending.";
                                    this.outputChannel.appendLine(`[IPC] Could not find matching breakpoint ID immediately.`);
                                }
                            }

                            // --- 构造成功响应 ---
                            const responsePayload = {
                                breakpoint: {
                                    id: breakpointId, // 可能为 undefined
                                    verified: false, // API 限制，初始为 false
                                    source: { path: filePath },
                                    line: lineNumber, // 返回 1-based 行号
                                    column: columnNumber, // 返回请求的列号 (1-based)
                                    message: bpMessage,
                                    timestamp: new Date().toISOString() // 生成时间戳
                                }
                            };
                            this.sendResponseToServer(requestId, 'success', responsePayload);

                        } catch (error: any) {
                            // --- 构造失败响应 ---
                            console.error(`[Plugin] Failed to set breakpoint for request ${requestId}: ${error.message}`);
                            this.outputChannel.appendLine(`[IPC Error] Failed to set breakpoint for request ${requestId}: ${error.message}`);
                            this.sendResponseToServer(requestId, 'error', undefined, { message: `Failed to set breakpoint: ${error.message}` });
                        }
                    } else {
                        // 处理未知或非预期的消息
                        console.warn('[Plugin] Received unknown IPC message type or command:', message);
                        this.outputChannel.appendLine(`[IPC Warning] Received unknown message: ${JSON.stringify(message)}`);
                        // 如果是请求类型但命令未知，可以发送错误响应
                        if (message?.type === 'request' && message.requestId) {
                             this.sendResponseToServer(message.requestId, 'error', undefined, { message: 'Unknown command or invalid message format.' });
                        }
                    }
                });

                // --- 标准输出/错误和进程事件监听器 ---
                this.mcpServerProcess.stdout?.on('data', (data: Buffer) => {
                    const output = data.toString();
                    console.log(`MCP Server stdout: ${output}`);
                    this.outputChannel.appendLine(`[stdout] ${output}`);
                    if (output.includes(`MCP Server listening on port ${targetPort}`)) {
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
                    this.handleServerError(`启动 MCP 服务器进程失败: ${err.message}`);
                });

                this.mcpServerProcess.on('close', (code) => {
                    console.log(`MCP server process exited with code ${code}`);
                    this.outputChannel.appendLine(`MCP server process exited with code ${code}`);
                    if (this.mcpServerProcess) { // Check if it was not explicitly set to null by stopServer
                       this.handleServerError(`服务器进程意外退出，退出码: ${code}`);
                    } else {
                        console.log('MCP server process stopped by user.');
                    }
                });
            }
        } catch (error: any) {
            console.error('Error starting MCP server:', error);
            this.handleServerError(`启动 MCP 服务器时出错: ${error.message}`);
        }
    }

    /**
     * 停止正在运行的 MCP 服务器子进程。
     */
    public stopServer(): void {
        if (!this.mcpServerProcess) {
            vscode.window.showInformationMessage('Debug MCP Server is not running.');
            if (this.statusBarManager.getStatus() !== 'stopped') {
                 this.statusBarManager.setStatus('stopped', null);
            }
            return;
        }

        console.log('Stopping MCP server...');
        this.outputChannel.appendLine('Attempting to stop Debug MCP Server...');
        const processToKill = this.mcpServerProcess;
        this.mcpServerProcess = null; // Set to null BEFORE killing
        this.currentPort = null;
        this.statusBarManager.setStatus('stopped', null);
        try {
            processToKill.kill('SIGTERM');
            console.log('SIGTERM signal sent to Debug MCP Server.');
            this.outputChannel.appendLine('SIGTERM signal sent to Debug MCP Server. Waiting for exit...');
        } catch (error: any) {
            console.error('Error sending SIGTERM to MCP server process:', error);
            this.outputChannel.appendLine(`Error sending SIGTERM: ${error.message}`);
        }
        vscode.window.showInformationMessage('MCP 服务器已停止。');
    }

    /**
     * 生成符合 RooCode/Cline 要求的 MCP 服务器配置 JSON 字符串，并复制到剪贴板。
     */
    public async copyMcpConfigToClipboard(): Promise<void> {
        try {
            const portToUse = this.currentPort ?? getStoredPort(this.context);

            if (!portToUse) {
                 vscode.window.showWarningMessage('MCP Server port is not set. Cannot copy config.');
                 this.outputChannel.appendLine('Attempted to copy config, but port is not set.');
                 return;
            }

            const mcpConfig = {
                mcpServers: {
                    "vscode-debugger-mcp": {
                        url: `http://localhost:${portToUse}/mcp`,
                        headers: {}
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
     * 处理端口冲突的函数
     */
    private async handlePortConflict(occupiedPort: number): Promise<number | null> {
        const choice = await vscode.window.showWarningMessage(
            `MCP 服务器端口 ${occupiedPort} 已被占用。`,
            { modal: true },
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
                    return null;
                }
            });

            if (newPortStr) {
                const newPort = parseInt(newPortStr, 10);
                await storePort(this.context, newPort);
                return newPort;
            }
        }
        vscode.window.showInformationMessage('MCP 服务器启动已取消。');
        return null;
    }

     /**
      * 统一的错误处理和状态重置
      */
    private handleServerError(errorMessage?: string): void {
        if (errorMessage) {
           vscode.window.showErrorMessage(`MCP 服务器错误: ${errorMessage}`);
           this.outputChannel.appendLine(`Error: ${errorMessage}`);
           this.outputChannel.show(true);
        }
        // Ensure process is nullified if it exists and wasn't killed by stopServer
        if (this.mcpServerProcess) {
            try {
                if (!this.mcpServerProcess.killed) {
                    this.mcpServerProcess.kill('SIGTERM'); // Attempt to kill if not already
                }
            } catch (e) {
                console.warn("Error attempting to kill process during error handling:", e);
            }
            this.mcpServerProcess = null;
        }
        this.currentPort = null;
        this.statusBarManager.setStatus('error', null);
    }

    /**
     * 重启 MCP 服务器。
     */
    public async restartServer(): Promise<void> {
        console.log('Restarting MCP server...');
        this.outputChannel.appendLine('Restarting Debug MCP Server...');
        this.stopServer();
        // Add a small delay to ensure the port is released, especially on Windows
        await new Promise(resolve => setTimeout(resolve, 500));
        await this.startServer();
    }

    /**
     * 实现 vscode.Disposable 接口，用于在插件停用时清理资源。
     */
    dispose(): void {
        console.log('Disposing McpServerManager...');
        this.stopServer(); // Ensure server is stopped when extension is deactivated
        this.outputChannel.dispose(); // Dispose of the OutputChannel
    }

    // --- 新增：发送响应给服务器子进程 ---
    private sendResponseToServer(requestId: string, status: 'success' | 'error', payload?: any, error?: { message: string }): void {
        if (this.mcpServerProcess && !this.mcpServerProcess.killed) { // Check if process exists and is not killed
            const responseMessage: PluginResponse = {
                type: 'response',
                requestId: requestId,
                status: status,
                payload: payload,
                error: error
            };
            try {
                this.mcpServerProcess.send(responseMessage, (err) => {
                    if (err) {
                        console.error(`[Plugin] Failed to send IPC response for request ${requestId}:`, err);
                        this.outputChannel.appendLine(`[IPC Error] Failed to send response for request ${requestId}: ${err.message}`);
                        // Consider how to handle send errors, maybe retry or log significantly
                    } else {
                         this.outputChannel.appendLine(`[IPC] Sent response for request ${requestId}: ${status}`);
                    }
                });
            } catch (sendError: any) {
                 console.error(`[Plugin] Error during IPC send for request ${requestId}:`, sendError);
                 this.outputChannel.appendLine(`[IPC Error] Exception during send for request ${requestId}: ${sendError.message}`);
            }
        } else {
            console.warn(`[Plugin] Attempted to send response for request ${requestId}, but server process is not running or killed.`);
            this.outputChannel.appendLine(`[IPC Warning] Cannot send response for ${requestId}, server process unavailable.`);
        }
    }
}
