import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events'; // 使用 Node.js 的 EventEmitter

export type ProcessStatus = 'stopped' | 'starting' | 'running' | 'error';

/**
 * 管理子进程的生命周期（启动、停止、重启）和通信。
 * 通过事件暴露进程状态和输出。
 */
export class ProcessManager extends EventEmitter implements vscode.Disposable {
    private process: ChildProcess | null = null;
    private status: ProcessStatus = 'stopped';
    private readonly scriptPath: string;
    private readonly cwd: string;
    private readonly outputChannel: vscode.OutputChannel;
    private currentPort: number | null = null; // 记录当前运行的端口
    private workspacePath: string | null = null; // 记录工作区路径

    constructor(
        extensionPath: string,
        outputChannelName: string = 'Debug MCP Server Process' // 提供默认名称
    ) {
        super();
        this.scriptPath = path.join(extensionPath, 'mcp-server', 'dist', 'server.js');
        this.cwd = path.join(extensionPath, 'mcp-server');
        this.outputChannel = vscode.window.createOutputChannel(outputChannelName);
    }

    /**
     * 获取当前进程状态。
     */
    public getStatus(): ProcessStatus {
        return this.status;
    }

    /**
     * 获取当前运行的端口号。
     */
    public getCurrentPort(): number | null {
        return this.currentPort;
    }

    /**
     * 检查进程是否正在运行。
     */
    public isRunning(): boolean {
        return this.process !== null && this.status === 'running';
    }

    /**
     * 启动子进程。
     * @param port 要监听的端口号。
     * @param workspacePath 当前 VS Code 工作区的路径。
     */
    public start(port: number, workspacePath: string): void {
        if (this.process) {
            this.outputChannel.appendLine('Process already running or starting.');
            return;
        }

        this.currentPort = port; // 记录端口
        this.workspacePath = workspacePath; // 记录工作区路径
        this.setStatus('starting');
        this.outputChannel.appendLine(`Attempting to start process on port ${port}...`);
        this.outputChannel.show(true);

        const nodePath = process.execPath; // 使用当前运行的 Node.js 执行路径

        const env = {
            ...process.env,
            MCP_PORT: port.toString(),
            VSCODE_WORKSPACE_PATH: workspacePath
        };

        try {
            // 启用 IPC 通道: 修改 stdio 选项
            this.process = spawn(nodePath, [this.scriptPath], {
                cwd: this.cwd, // 设置工作目录
                env: env,
                stdio: ['pipe', 'pipe', 'pipe', 'ipc'] // 添加 'ipc'
            });

            this.outputChannel.appendLine(`Spawning process with PID: ${this.process.pid}`);

            // --- 标准输出/错误和进程事件监听器 ---
            this.process.stdout?.on('data', (data: Buffer) => {
                const output = data.toString();
                this.outputChannel.appendLine(`[stdout] ${output.trim()}`);
                this.emit('stdout', output); // 暴露 stdout 数据
                // 检查服务器是否成功启动的特定输出
                if (output.includes(`MCP Server listening on port ${port}`)) {
                    this.setStatus('running');
                    this.outputChannel.appendLine(`Process successfully started, listening on port ${port}.`);
                }
            });

            this.process.stderr?.on('data', (data: Buffer) => {
                const errorOutput = data.toString();
                this.outputChannel.appendLine(`[stderr] ${errorOutput.trim()}`);
                this.emit('stderr', errorOutput); // 暴露 stderr 数据
            });

            this.process.on('error', (err) => {
                this.outputChannel.appendLine(`[error] Failed to start process: ${err.message}`);
                console.error('Failed to start child process:', err);
                this.handleProcessError(`启动进程失败: ${err.message}`);
                this.emit('error', err); // 暴露错误事件
            });

            this.process.on('close', (code, signal) => {
                this.outputChannel.appendLine(`Process exited with code ${code}, signal ${signal}`);
                const wasRunning = this.status === 'running' || this.status === 'starting';
                this.process = null; // 清理进程引用
                this.currentPort = null; // 清理端口
                // 只有在进程不是被明确停止的情况下，才视为错误退出
                if (wasRunning && this.status !== 'stopped') {
                    this.setStatus('error');
                    this.emit('close', code, signal, true); // 暴露关闭事件，标记为意外关闭
                } else {
                    this.setStatus('stopped'); // 确保状态为 stopped
                    this.emit('close', code, signal, false); // 暴露关闭事件，标记为正常关闭
                }
            });

            // --- IPC 消息监听器 ---
            // 注意：这里的 on('message') 是为了接收来自子进程的消息
            // 发送消息给子进程需要使用 this.process.send()
            this.process.on('message', (message: any) => {
                this.outputChannel.appendLine(`[IPC Received] ${JSON.stringify(message)}`);
                this.emit('message', message); // 将接收到的 IPC 消息转发出去
            });

        } catch (error: any) {
            this.outputChannel.appendLine(`[error] Error spawning process: ${error.message}`);
            console.error('Error spawning child process:', error);
            this.handleProcessError(`启动进程时出错: ${error.message}`);
        }
    }

    /**
     * 停止正在运行的子进程。
     */
    public stop(): void {
        if (!this.process) {
            this.outputChannel.appendLine('Process is not running.');
            if (this.status !== 'stopped') {
                 this.setStatus('stopped'); // 确保状态更新
            }
            return;
        }

        this.outputChannel.appendLine('Attempting to stop process...');
        this.setStatus('stopped'); // 先标记为停止状态，避免 close 事件误判为 error
        const processToKill = this.process;
        this.process = null; // 清理引用
        this.currentPort = null; // 清理端口

        try {
            // 尝试优雅地关闭，如果失败或超时，则强制终止
            const killed = processToKill.kill('SIGTERM'); // 尝试 SIGTERM
            if (killed) {
                this.outputChannel.appendLine(`SIGTERM signal sent to process PID: ${processToKill.pid}.`);
                // 可以设置一个超时，如果进程没有在预期时间内退出，则发送 SIGKILL
                // setTimeout(() => {
                //     if (!processToKill.killed) {
                //         this.outputChannel.appendLine(`Process ${processToKill.pid} did not exit after SIGTERM, sending SIGKILL.`);
                //         processToKill.kill('SIGKILL');
                //     }
                // }, 5000); // 5秒超时
            } else {
                 this.outputChannel.appendLine(`Failed to send SIGTERM to process PID: ${processToKill.pid}. It might have already exited.`);
                 // 如果发送失败，可能进程已经退出，状态已在 'close' 事件中处理
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`[error] Error sending signal to process: ${error.message}`);
            console.error('Error sending signal to process:', error);
            // 即使发送信号出错，也应确保状态为 stopped
            if (this.status !== 'stopped') {
                this.setStatus('stopped');
            }
        }
    }

    /**
     * 重启子进程。
     */
    public async restart(): Promise<void> {
        this.outputChannel.appendLine('Restarting process...');
        const previousPort = this.currentPort;
        const previousWorkspacePath = this.workspacePath;

        this.stop();

        // 等待进程完全停止并释放端口
        await new Promise(resolve => setTimeout(resolve, 500)); // 简单的延迟

        if (previousPort !== null && previousWorkspacePath !== null) {
            this.start(previousPort, previousWorkspacePath);
        } else {
            this.outputChannel.appendLine('Cannot restart: previous port or workspace path is unknown.');
            this.setStatus('error'); // 无法重启，标记为错误状态
        }
    }

    /**
     * 发送 IPC 消息给子进程。
     * @param message 要发送的消息对象。
     * @returns 发送成功返回 true，否则返回 false。
     */
    public send(message: any): boolean {
        if (this.process && !this.process.killed && this.process.connected) {
            try {
                // process.send returns boolean immediately based on queuing status
                const queued = this.process.send(message, (error) => { // Callback handles async result
                    if (error) {
                        this.outputChannel.appendLine(`[IPC Send Error Callback] Failed to send message: ${error.message}`);
                        console.error('IPC Send Error Callback:', error);
                        // Callback doesn't return to the caller, just handles async error
                    } else {
                        // Log successful async send completion in the callback
                        this.outputChannel.appendLine(`[IPC Send Success Callback] Message sent successfully (async confirmation).`);
                    }
                });
                this.outputChannel.appendLine(`[IPC Sent] Queued: ${queued} - Message: ${JSON.stringify(message)}`); // Log queuing status
                return queued; // Return the synchronous queuing status
            } catch (error: any) {
                 this.outputChannel.appendLine(`[IPC Send Exception] ${error.message}`);
                 console.error('IPC Send Exception:', error);
                 return false;
            }
        } else {
            this.outputChannel.appendLine('[IPC Send Warning] Cannot send message, process not running or not connected.');
            return false;
        }
    }


    /**
     * 统一处理进程错误，更新状态并发出事件。
     */
    private handleProcessError(errorMessage: string): void {
        this.outputChannel.appendLine(`[Process Error] ${errorMessage}`);
        // 确保进程引用被清理
        if (this.process && !this.process.killed) {
            try {
                this.process.kill('SIGKILL'); // 强制终止
            } catch (e) {
                 console.warn("Error attempting to kill process during error handling:", e);
            }
        }
        this.process = null;
        this.currentPort = null;
        this.setStatus('error');
    }

    /**
     * 设置新的状态并发出 statusChange 事件。
     */
    private setStatus(newStatus: ProcessStatus): void {
        if (this.status !== newStatus) {
            this.status = newStatus;
            this.emit('statusChange', this.status, this.currentPort); // 发出状态变化事件，并附带当前端口
            this.outputChannel.appendLine(`Status changed to: ${newStatus}${this.currentPort ? ` (Port: ${this.currentPort})` : ''}`);
        }
    }

    /**
     * 实现 vscode.Disposable 接口。
     */
    dispose(): void {
        this.outputChannel.appendLine('Disposing ProcessManager...');
        this.stop(); // 确保进程停止
        this.removeAllListeners(); // 移除所有事件监听器
        this.outputChannel.dispose(); // 清理 OutputChannel
    }
}