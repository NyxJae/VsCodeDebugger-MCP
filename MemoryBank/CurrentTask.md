## 任务上下文
- **插件如何启动和监控MCP服务器子进程?**
    - 由 `src/mcpServerManager.ts` 协调启动和状态管理。
    - `src/managers/processManager.ts` 使用 `child_process.spawn` 启动 MCP 服务器 (`mcp-server/dist/server.js`)。
    - `ProcessManager` 通过事件 (`statusChange`, `message`, `error`, `close`) 报告子进程状态和输出。
    - `McpServerManager` 监听 `ProcessManager` 的事件更新状态栏和处理 IPC 消息。

- **MCP服务器如何通过SSE发送消息? 消息格式是什么? 发送给谁?**
    - MCP 服务器通过 `mcp-server/src/httpServer.ts` 建立 HTTP/SSE 接口，使用 `@modelcontextprotocol/sdk/server/sse.js` 的 `SSEServerTransport` 处理 `/sse` 连接和 `/messages` POST 请求。
    - 工具执行结果（如 `mcp-server/src/toolProviders/debug/*.ts` 中的日志所示）通过 SSE 发送给连接到 `/sse` 端点的客户端，而非插件。
    - 消息格式遵循 Server-Sent Events 标准，具体内容由 MCP SDK 和工具结果决定。

- **插件端目前是否有机制接收来自MCP服务器进程的消息? (除了标准的stdout/stderr)**
    - 插件端通过 IPC 通道接收来自 MCP 服务器的消息 (`src/managers/processManager.ts` 的 `message` 事件，由 `src/mcpServerManager.ts` 转发至 `src/managers/ipcHandler.ts` 处理)。
    - 此 IPC 通道主要用于请求/响应通信，不用于接收 SSE 消息。SSE 消息通过 HTTP 连接发送。
    - 插件端目前没有建立 SSE 客户端连接来接收 SSE 消息的机制。

- **插件端应该在哪里打印接收到的SSE信息?**
    - `src/mcpServerManager.ts` 中已存在一个 `outputChannel` (`Constants.OUTPUT_CHANNEL_COORDINATOR`)，可用于打印接收到的 SSE 信息，便于调试。

## 相关文件和代码片段
- `src/mcpServerManager.ts`
- `src/managers/processManager.ts`
- `mcp-server/src/httpServer.ts`
- `mcp-server/src/pluginCommunicator.ts`
- `src/managers/ipcHandler.ts`
- `mcp-server/src/toolProviders/debug/getBreakpoints.ts` (日志中提及 SSE 发送)
- `mcp-server/src/toolProviders/debug/removeBreakpoint.ts` (日志中提及 SSE 发送)
- `mcp-server/src/toolProviders/debug/setBreakpoint.ts` (日志中提及 SSE 发送)
- `mcp-server/src/toolProviders/debug/startDebugging.ts` (日志中提及 SSE 发送)
- `mcp-server/src/toolProviders/debug/continueDebugging.ts` (日志中提及 SSE 发送)
- `mcp-server/src/toolProviders/debug/stepExecution.ts` (日志中提及 SSE 发送)
- `mcp-server/src/toolProviders/debug/stopDebugging.ts` (日志中提及 SSE 发送)
- `mcp-server/src/server.ts` (调用 `startHttpServer`)
- `mcp-server/node_modules/@modelcontextprotocol/sdk/server/sse.js` (SSEServerTransport 定义)
36 | - `mcp-server/node_modules/@modelcontextprotocol/sdk/client/sse.js` (SSEClientTransport 定义)

## 任务规划 (修订版 - 插件端作为 SSE 客户端)

**目标:** 使 VS Code 插件能够像标准 MCP 客户端一样，通过建立 SSE 连接来接收并显示 MCP 服务器发送的消息，以便于调试。

**核心思路:**
1.  **插件端:**
    *   引入适用于 Node.js 的 SSE 客户端库 (`eventsource`)。
    *   创建一个新的管理类 (`SseClientManager`)，负责管理到 MCP 服务器 `/sse` 端点的连接。
    *   当 MCP 服务器启动并运行时，自动建立 SSE 连接。
    *   监听 SSE 消息，并将内容打印到指定的 Output Channel。
    *   处理连接的生命周期（启动、停止、错误、重连）。
2.  **MCP 服务器端:**
    *   无需修改，保持现有的 `/sse` 端点逻辑。

**详细步骤:**

**阶段一：插件端准备工作**

1.  **添加依赖:**
    *   **文件:** `package.json` (项目根目录)
    *   **操作:** 在 `dependencies` 中添加 `eventsource` 库及其类型定义。
        ```json
        "dependencies": {
          // ... 其他依赖
          "eventsource": "^2.0.2" // 或最新稳定版
        },
        "devDependencies": {
          // ... 其他开发依赖
          "@types/eventsource": "^1.1.15" // 或对应版本
        }
        ```
    *   **后续操作:** 需要在项目根目录运行 `npm install` 来安装依赖。

2.  **创建 SSE 客户端管理类:**
    *   **文件:** `src/managers/sseClientManager.ts` (新建)
    *   **操作:** 创建 `SseClientManager` 类，负责 SSE 连接的建立、管理和事件处理。
        ```typescript
        import * as vscode from 'vscode';
        import EventSource from 'eventsource'; // 导入 eventsource 库
        import { logger } from '../config'; // 假设有共享的 logger
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
                        logger.info(`[SSE Client] Connected to ${this.sseUrl}`);
                        this.clearReconnectTimer(); // 连接成功，清除重连计时器
                    };

                    this.eventSource.onerror = (error: any) => {
                        this.isConnecting = false;
                        // 检查是否是连接错误还是其他错误
                        if (this.eventSource?.readyState === EventSource.CLOSED) {
                            this.outputChannel.appendLine(`[SSE Client] Connection error or closed for ${this.sseUrl}. Will attempt to reconnect.`);
                            logger.error(`[SSE Client] Connection error or closed for ${this.sseUrl}:`, error);
                            this.closeConnection(); // 确保旧连接已关闭
                            this.scheduleReconnect(); // 安排重连
                        } else {
                            // 如果连接仍然打开，可能是其他类型的错误
                            this.outputChannel.appendLine(`[SSE Client] Error on SSE stream: ${JSON.stringify(error)}`);
                            logger.error('[SSE Client] Error on SSE stream:', error);
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
                    logger.error(`[SSE Client] Failed to create EventSource for ${this.sseUrl}:`, e);
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
        ```

**阶段二：集成 SSE 客户端到插件核心逻辑**

3.  **在 McpServerManager 中实例化和管理 SseClientManager:**
    *   **文件:** `src/mcpServerManager.ts`
    *   **操作:**
        *   导入 `SseClientManager`。
        *   在构造函数中创建 `SseClientManager` 实例，并将其添加到 `disposables`。
        *   修改 `processManager.on('statusChange', ...)` 回调：
            *   当状态变为 `running` 且获取到端口号时，调用 `sseClientManager.startListening(port)`。
            *   当状态变为 `stopped` 或 `error` 时，调用 `sseClientManager.stopListening()`。
        ```typescript
        // 顶部导入
        import { SseClientManager } from './managers/sseClientManager'; // 导入 SSE 客户端管理器

        // ...

        export class McpServerManager implements vscode.Disposable {
            // ... (保留现有属性: outputChannel, disposables, context, statusBarManager, processManager, ipcHandler, debuggerApiWrapper)
            private sseClientManager: SseClientManager; // 添加 SSE 客户端管理器实例

            constructor(
                // ... (保留现有参数)
            ) {
                this.outputChannel = vscode.window.createOutputChannel(Constants.OUTPUT_CHANNEL_COORDINATOR);
                this.disposables.push(this.outputChannel);

                // 实例化 SseClientManager
                this.sseClientManager = new SseClientManager(this.outputChannel);
                this.disposables.push(this.sseClientManager); // 添加到 disposables

                // ... (保留 ipcHandler.setDebuggerApiWrapper)

                // 连接 ProcessManager 事件
                this.processManager.on('statusChange', (status: ProcessStatus, port: number | null) => {
                    // 更新状态栏 (保留现有逻辑)
                    let mcpStatus: McpServerStatus;
                    // ... (switch case 映射状态)
                    this.statusBarManager.setStatus(mcpStatus, port);

                    // 根据状态管理 SSE 客户端连接 <--- 新增逻辑
                    if (status === 'running' && port !== null) {
                        this.outputChannel.appendLine(`[Coordinator] Server is running on port ${port}. Starting SSE listener.`);
                        this.sseClientManager.startListening(port);
                    } else if (status === 'stopped' || status === 'error') {
                        this.outputChannel.appendLine(`[Coordinator] Server stopped or encountered an error. Stopping SSE listener.`);
                        this.sseClientManager.stopListening();
                    }
                });

                // 处理来自服务器的 IPC 请求 (保留现有逻辑)
                this.processManager.on('message', (message: PluginRequest | any) => {
                    if (message && message.type === Constants.IPC_MESSAGE_TYPE_REQUEST) {
                        // ... (保留 handleRequestFromMCP 逻辑)
                    } else {
                        this.outputChannel.appendLine(`[Coordinator] Received non-request message via IPC: ${JSON.stringify(message)}`);
                        // 注意：这里不再需要处理 IPC_MESSAGE_TYPE_SSE_EVENT
                    }
                });

                // 处理进程错误和关闭事件 (保留现有逻辑)
                this.processManager.on('error', (err: Error) => {
                    // ...
                    this.sseClientManager.stopListening(); // 服务器进程出错，停止 SSE 监听
                });
                this.processManager.on('close', (code: number | null, signal: NodeJS.Signals | null, unexpected: boolean) => {
                    // ...
                    this.sseClientManager.stopListening(); // 服务器进程关闭，停止 SSE 监听
                });

                // ... (保留 disposables.push)
            }

            // ... (保留 handleRequestFromMCP, isRunning, startServer, stopServer, restartServer, copyMcpConfigToClipboard, handlePortConflict, dispose 方法)

            // 在 dispose 方法中确保 sseClientManager 被 dispose (已通过添加到 disposables 数组实现)
        }
        ```

**阶段三：安装依赖和测试**

4.  **安装依赖:**
    *   在项目根目录 (`e:\Project\VsCodeDebugger-MCP`) 打开终端。
    *   运行 `npm install`。

5.  **测试:**
    *   重新加载 VS Code 窗口或重启 VS Code 以加载插件。
    *   确认 MCP 服务器自动启动（或手动启动）。
    *   观察 "Debug MCP Coordinator" Output Channel 的输出：
        *   应看到 `[SSE Client] Initialized.`
        *   当服务器启动后，应看到 `[SSE Client] Attempting to connect to http://localhost:<port>/sse...`
        *   连接成功后，应看到 `[SSE Client] Connected to http://localhost:<port>/sse`
    *   使用 MCP 客户端（如 Cline）连接服务器并执行一个会产生 SSE 输出的工具（例如，任何调试工具）。
    *   观察 "Debug MCP Coordinator" Output Channel，确认是否打印出了 `[SSE Client] Received message:` 以及相应的事件数据。
    *   停止 MCP 服务器，确认 Output Channel 中打印 `[SSE Client] Stopping listener...` 和 `[SSE Client] Closing connection...`。
    *   测试服务器意外关闭或重启时的重连逻辑。
    *   测试网络断开等连接错误场景。

**潜在风险和注意事项:**

*   **依赖安装:** 需要确保 `npm install` 成功执行，并将 `eventsource` 添加到插件的打包配置中（如果需要）。
*   **端口获取:** 确保 `McpServerManager` 在调用 `sseClientManager.startListening` 时能正确获取到服务器运行的端口号。
*   **错误处理和重连:** `SseClientManager` 中的错误处理和重连逻辑需要仔细测试，以确保在各种网络条件下都能稳定工作。避免无限重连或资源泄漏。
*   **资源释放:** 确保 `SseClientManager` 和 `EventSource` 实例在插件停用或服务器停止时被正确 `dispose`。

## 任务审查

**审查时间:** 2025/4/25 下午3:00:00
**审查人:** 架构师 (Roo)
**审查对象:**
- `package.json`
- `src/managers/sseClientManager.ts` (新建)
- `src/mcpServerManager.ts`

**审查结果:** **通过**

**详细说明:**

1.  **符合任务规划:**
    *   `package.json`: 已按规划添加 `eventsource` 依赖及其类型定义。
    *   `src/managers/sseClientManager.ts`: 新建的 `SseClientManager` 类严格按照规划实现了 SSE 连接的建立、消息处理、错误处理、自动重连、关闭和资源释放逻辑。日志记录使用了 `outputChannel`，与规划略有不同但合理。
    *   `src/mcpServerManager.ts`: 成功将 `SseClientManager` 集成到 `McpServerManager` 中，在服务器启动时开始监听 SSE，在服务器停止、出错或关闭时停止监听，并确保了资源的正确释放。

2.  **代码逻辑与健壮性:**
    *   `SseClientManager` 的逻辑清晰，考虑了连接的不同状态 (`connecting`, `open`, `closed`) 和错误场景。
    *   重连机制设计合理，包含延迟和状态重置。
    *   `McpServerManager` 的集成逻辑正确，在合适的时机调用了 `SseClientManager` 的方法。

3.  **代码风格:**
    *   代码风格与项目现有风格保持一致。

4.  **功能影响:**
    *   修改集中在新增的 SSE 客户端功能和其在 `McpServerManager` 中的集成，未发现对现有 IPC 处理、服务器启停、调试命令处理等核心功能产生负面影响。

**结论:** 代码修改质量良好，符合任务规划要求，能够实现目标功能。

## 后续建议：解决类型冲突

**问题描述:** 在集成 `eventsource` 后，TypeScript 可能会报告 TS2403 错误 ("后续变量声明必须属于同一类型")，指出 `MessageEvent` 类型存在冲突。

**根本原因:** 这是因为 `@types/eventsource` 包中的 `dom-monkeypatch.d.ts` 文件尝试修改全局的 `MessageEvent` 类型定义，与 TypeScript 内置的 DOM 类型库或 `@types/node` 中的定义发生冲突。

**建议方案:** 修改项目根目录下的 `tsconfig.json` 文件，在 `compilerOptions` 对象中添加 `"skipLibCheck": true` 选项。

**示例:**
```json
{
  "compilerOptions": {
    // ... 其他选项
    "strict": true,
    "skipLibCheck": true // <--- 添加此行
  },
  // ... include, exclude 等
}
```

**说明:** `"skipLibCheck": true` 会让 TypeScript 跳过对所有库声明文件 (`*.d.ts`) 的类型检查，从而忽略由 `@types/eventsource` 引起的冲突。这是处理此类第三方库类型定义问题的常用方法。