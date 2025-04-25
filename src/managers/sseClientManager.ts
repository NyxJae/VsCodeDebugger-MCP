import * as vscode from 'vscode';
import EventSource from 'eventsource'; // 导入 eventsource 库
// import { logger } from '../config'; // 移除 logger 导入
import * as Constants from '../constants'; // 导入常量

/**
 * 管理到 MCP 服务器的 SSE 客户端连接。
 */
export class SseClientManager implements vscode.Disposable {
    private eventSource: EventSource | null = null;
    private sseUrl: string | null = null;
    private outputChannel: vscode.OutputChannel;
    private isConnecting: boolean = false;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private readonly reconnectDelayMs = 5000; // 重连延迟

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.outputChannel.appendLine('[SSE Client] Initialized.');
    }

    /**
     * 启动 SSE 连接。
     * @param port MCP 服务器运行的端口号。
     */
    public startListening(port: number): void {
        if (this.eventSource || this.isConnecting) {
            this.outputChannel.appendLine(`[SSE Client] Already listening or connecting to ${this.sseUrl}.`);
            return;
        }

        this.sseUrl = `http://localhost:${port}/sse`;
        this.outputChannel.appendLine(`[SSE Client] Attempting to connect to ${this.sseUrl}...`);
        this.isConnecting = true;
        this.clearReconnectTimer(); // 清除之前的重连计时器

        try {
            // 注意：EventSource 构造函数可能会立即抛出错误（例如 URL 无效）
            this.eventSource = new EventSource(this.sseUrl);

            this.eventSource.onopen = () => {
                this.isConnecting = false;
                this.outputChannel.appendLine(`[SSE Client] Connected to ${this.sseUrl}`);
                // logger.info(`[SSE Client] Connected to ${this.sseUrl}`); // 替换
                this.outputChannel.appendLine(`[SSE Client] INFO: Connected to ${this.sseUrl}`); // 使用 outputChannel
                this.clearReconnectTimer(); // 连接成功，清除重连计时器
            };

            this.eventSource.onerror = (error: any) => {
                this.isConnecting = false;
                // 检查是否是连接错误还是其他错误
                if (this.eventSource?.readyState === EventSource.CLOSED) {
                    this.outputChannel.appendLine(`[SSE Client] Connection error or closed for ${this.sseUrl}. Will attempt to reconnect.`);
                    // logger.error(`[SSE Client] Connection error or closed for ${this.sseUrl}:`, error); // 替换
                    this.outputChannel.appendLine(`[SSE Client] ERROR: Connection error or closed for ${this.sseUrl}: ${JSON.stringify(error)}`); // 使用 outputChannel
                    this.closeConnection(); // 确保旧连接已关闭
                    this.scheduleReconnect(); // 安排重连
                } else {
                    // 如果连接仍然打开，可能是其他类型的错误
                    this.outputChannel.appendLine(`[SSE Client] Error on SSE stream: ${JSON.stringify(error)}`);
                    // logger.error('[SSE Client] Error on SSE stream:', error); // 替换
                    this.outputChannel.appendLine(`[SSE Client] ERROR: Error on SSE stream: ${JSON.stringify(error)}`); // 使用 outputChannel
                }
            };

            this.eventSource.onmessage = (event: MessageEvent) => {
                this.outputChannel.appendLine('[SSE Client] Received message:');
                // 尝试解析 JSON 数据，如果失败则打印原始数据
                try {
                    const jsonData = JSON.parse(event.data);
                    this.outputChannel.appendLine(`Data: ${JSON.stringify(jsonData, null, 2)}`); // 格式化 JSON 输出
                } catch (e) {
                    this.outputChannel.appendLine(`Data (raw): ${event.data}`);
                }
                // 可以根据 event.type (如果服务器发送了 event 类型) 进行区分
                if (event.type && event.type !== 'message') {
                     this.outputChannel.appendLine(`Event Type: ${event.type}`);
                }
                this.outputChannel.appendLine('---');
            };

            // 可以添加对特定命名事件的监听
            // this.eventSource.addEventListener('tool_result', (event: MessageEvent) => {
            //     this.outputChannel.appendLine('[SSE Client] Received tool_result event:');
            //     this.outputChannel.appendLine(`Data: ${event.data}`);
            //     this.outputChannel.appendLine('---');
            // });

        } catch (e: any) {
            this.isConnecting = false;
            this.outputChannel.appendLine(`[SSE Client] Failed to create EventSource for ${this.sseUrl}: ${e.message}`);
            // logger.error(`[SSE Client] Failed to create EventSource for ${this.sseUrl}:`, e); // 替换
            this.outputChannel.appendLine(`[SSE Client] ERROR: Failed to create EventSource for ${this.sseUrl}: ${e.message}`); // 使用 outputChannel
            this.scheduleReconnect(); // 创建失败也尝试重连
        }
    }

    /**
     * 停止 SSE 连接并清除重连计时器。
     */
    public stopListening(): void {
        this.outputChannel.appendLine('[SSE Client] Stopping listener...');
        this.clearReconnectTimer();
        this.closeConnection();
        this.sseUrl = null; // 清除 URL
    }

    /**
     * 关闭当前 SSE 连接。
     */
    private closeConnection(): void {
         if (this.eventSource) {
            this.outputChannel.appendLine(`[SSE Client] Closing connection to ${this.sseUrl}`);
            this.eventSource.close();
            this.eventSource = null;
        }
        this.isConnecting = false; // 确保连接状态被重置
    }

    /**
     * 安排重连。
     */
    private scheduleReconnect(): void {
        this.clearReconnectTimer(); // 先清除旧的计时器
        if (!this.sseUrl) {
            this.outputChannel.appendLine('[SSE Client] Cannot schedule reconnect: SSE URL is not set.');
            return;
        }
        const urlToReconnect = this.sseUrl; // 捕获当前 URL
        const portMatch = urlToReconnect.match(/:(\d+)\/sse$/);
        if (!portMatch) {
             this.outputChannel.appendLine(`[SSE Client] Cannot parse port from URL for reconnect: ${urlToReconnect}`);
             return;
        }
        const portToReconnect = parseInt(portMatch[1], 10);

        this.outputChannel.appendLine(`[SSE Client] Scheduling reconnect to ${urlToReconnect} in ${this.reconnectDelayMs}ms...`);
        this.reconnectTimer = setTimeout(() => {
            this.outputChannel.appendLine(`[SSE Client] Attempting reconnect to ${urlToReconnect}...`);
            this.reconnectTimer = null; // 清除计时器句柄
            // 重新调用 startListening，但要确保状态正确
            this.eventSource = null; // 确保旧实例被清除
            this.isConnecting = false; // 重置连接状态
            this.startListening(portToReconnect); // 使用捕获的端口重连
        }, this.reconnectDelayMs);
    }

    /**
     * 清除重连计时器。
     */
    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
            this.outputChannel.appendLine('[SSE Client] Cleared reconnect timer.');
        }
    }

    /**
     * 实现 vscode.Disposable 接口。
     */
    dispose(): void {
        this.outputChannel.appendLine('[SSE Client] Disposing...');
        this.stopListening(); // 停止监听并清理资源
    }
}