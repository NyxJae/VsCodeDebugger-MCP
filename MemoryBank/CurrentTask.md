## 任务上下文
- src/mcpServerManager.ts (服务器管理相关代码)
  - 启动服务器: 35-122行
  - 停止服务器: 127-158行
  - 插件停用清理: 203-207行
- src/extension.ts (插件生命周期管理)
  - 插件激活: 13-39行
  - 插件停用: 96-100行
- package.json
  - 使用Node.js内置child_process模块管理进程(无需额外依赖)
- src/extension.ts 13-39行：插件激活时仅初始化McpServerManager和StatusBarManager，未直接调用startServer()
- mcp-server/src/server.ts 46-57行：使用StdioServerTransport，无显式端口配置

## 任务规划：MCP 服务器通信方式切换 (Stdio -> HTTP+SSE)

**目标:** 将 MCP 服务器的通信方式从 Stdio 切换到 HTTP + Server-Sent Events (SSE)，使客户端能够通过 URL 连接到由 VS Code 插件启动和管理的服务器，并更新插件以适应此变化。

**核心流程:**

```mermaid
graph TD
    A[插件: 启动服务器进程] --> B(服务器: 启动 Express 应用);
    B --> C(服务器: 监听 HTTP 端口);
    C --> |stdout: "Server listening on http://localhost:XXXX"| D[插件: 捕获端口号];
    D --> E[插件: 更新状态栏显示端口];
    D --> F[插件: 更新内部状态, 记录基础 URL];
    G[客户端: GET /sse] --> H(服务器: 建立 SSE 连接);
    I[客户端: POST /messages] --> J(服务器: 处理客户端消息);
    H --> K[客户端: 接收服务器消息];
    L[插件: 停止服务器] --> M(服务器: 收到 SIGTERM);
    M --> N(服务器: 关闭 HTTP 服务器并退出);
    N --> O[插件: 监听到进程退出, 更新状态];
```

**实施规划:**

**1. 服务器端修改 (`mcp-server/src/server.ts`)**

*   **目标:** 使用 `SSEServerTransport`，引入 `express` 框架处理 HTTP 请求，监听指定端口，并通过 `stdout` 输出监听信息。
*   **依赖:** 需要在 `mcp-server` 目录下添加 `express` 和 `@types/express` 依赖。
    ```bash
    # 在 mcp-server 目录下执行
    npm install express
    npm install --save-dev @types/express
    ```
*   **修改点:**
    *   **导入:** 导入 `SSEServerTransport`, `express`。
        ```typescript
        import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
        // import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"; // 移除 Stdio
        import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"; // 导入 SSE Transport
        import express, { Request, Response } from "express"; // 导入 express
        // ... 其他导入
        ```
    *   **端口配置:** 定义默认端口号，允许通过环境变量配置。
        ```typescript
        const DEFAULT_PORT = 6009; // 定义默认端口
        const port = parseInt(process.env.MCP_PORT || '', 10) || DEFAULT_PORT;
        ```
    *   **`main` 函数重构:**
        *   创建 `express` 应用实例。
        *   设置 `/sse` 端点用于建立 SSE 连接，并将 `SSEServerTransport` 连接到 `McpServer`。
        *   设置 `/messages` 端点用于接收客户端 POST 的消息。
        *   启动 HTTP 服务器监听端口。
        *   修改 `stdout` 输出，包含完整的监听 URL。
        ```typescript
        async function main() {
          try {
            logger.info(`Starting MCP server with SDK via HTTP/SSE on port ${port}...`);

            const app = express();
            // 用于存储每个 SSE 连接的 transport 实例
            const transports: { [sessionId: string]: SSEServerTransport } = {};

            // SSE 连接端点
            app.get("/sse", async (req: Request, res: Response) => {
              logger.info(`SSE connection request received from ${req.ip}`);
              // 注意：SSEServerTransport 构造函数的第二个参数是 Response 对象
              const transport = new SSEServerTransport('/messages', res); // 第一个参数是 postMessagesUrlPath
              transports[transport.sessionId] = transport;
              logger.info(`SSE transport created with sessionId: ${transport.sessionId}`);

              // 当 SSE 连接关闭时，清理 transport
              res.on("close", () => {
                logger.info(`SSE connection closed for sessionId: ${transport.sessionId}`);
                delete transports[transport.sessionId];
                // 可能需要通知 McpServer 断开连接，但 SDK 示例未显示，可能 transport 内部处理
                // server.disconnect(transport); // 如果有此方法
              });

              // 将 transport 连接到 McpServer
              try {
                  await server.connect(transport);
                  logger.info(`McpServer connected to SSE transport for sessionId: ${transport.sessionId}`);
              } catch (connectError) {
                  logger.error(`Failed to connect McpServer to SSE transport for sessionId: ${transport.sessionId}`, connectError);
                  // 关闭响应，防止挂起
                  if (!res.writableEnded) {
                      res.end();
                  }
                  delete transports[transport.sessionId]; // 清理
              }
            });

            // 客户端消息 POST 端点
            // 需要 express.raw() 中间件来读取原始请求体
            app.post("/messages", express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
              const sessionId = req.query.sessionId as string;
              logger.debug(`Received POST to /messages for sessionId: ${sessionId}`);
              const transport = transports[sessionId];
              if (transport) {
                try {
                  // SSEServerTransport 需要处理原始请求和响应对象
                  await transport.handlePostMessage(req, res);
                  logger.debug(`Successfully handled POST message for sessionId: ${sessionId}`);
                } catch (postError) {
                  logger.error(`Error handling POST message for sessionId: ${sessionId}`, postError);
                  if (!res.headersSent) {
                      res.status(500).send('Error processing message');
                  } else if (!res.writableEnded) {
                      // 如果头已发送但未结束，尝试结束
                      res.end();
                  }
                }
              } else {
                logger.warn(`No active SSE transport found for sessionId: ${sessionId}`);
                res.status(400).send('No active SSE transport found for this session ID');
              }
            });

            // 启动 HTTP 服务器
            const httpServer = app.listen(port, () => {
              const address = httpServer.address();
              const actualPort = typeof address === 'string' ? port : address?.port ?? port; // 获取实际监听端口
              const listenUrl = `http://localhost:${actualPort}`;

              // **重要:** 修改 stdout 输出格式，包含 URL，用于插件捕获
              console.log(`Debug MCP Server listening on ${listenUrl}`); // 输出监听信息到 stdout

              logger.info(`MCP server HTTP/SSE interface available at ${listenUrl}`); // 更新日志 (stderr)
            });

            // 添加 HTTP 服务器错误处理
            httpServer.on('error', (error) => {
                logger.error('HTTP server error:', error);
                process.exit(1); // HTTP 监听失败，退出进程
            });

            // 将 httpServer 保存以便后续关闭
            (process as any).httpServer = httpServer; // 附加到 process 对象以便在 handleShutdown 中访问

          } catch (error) {
            logger.error(`Failed to start MCP server on port ${port}:`, error);
            process.exit(1);
          }
        }
        ```
    *   **关闭处理 (`handleShutdown`) 修改:** 增加关闭 HTTP 服务器的逻辑。
        ```typescript
        const handleShutdown = (signal: string) => {
            logger.info(`Received ${signal}. Debug MCP Server Stopping...`);
            const httpServer = (process as any).httpServer;
            if (httpServer) {
                logger.info('Closing HTTP server...');
                httpServer.close(() => {
                    logger.info('HTTP server closed.');
                    // 在 HTTP 服务器关闭后退出进程
                    process.exit(0);
                });
                // 设置超时强制退出，防止服务器无法正常关闭
                setTimeout(() => {
                    logger.warn('HTTP server close timed out, forcing exit.');
                    process.exit(1);
                }, 5000); // 5秒超时
            } else {
                // 如果没有 httpServer，直接退出
                process.exit(0);
            }
            // 注意：不再直接调用 process.exit(0)，而是在 httpServer.close 回调中调用
        };
        process.on('SIGINT', () => handleShutdown('SIGINT'));
        process.on('SIGTERM', () => handleShutdown('SIGTERM'));
        ```

**2. 插件端修改 (`src/mcpServerManager.ts`)**

*   **目标:** 修改服务器启动逻辑以捕获 HTTP 监听 URL，更新状态管理，并调整配置复制功能。
*   **修改点:**
    *   **添加成员变量:** 用于存储当前监听的基础 URL。
        ```typescript
        export class McpServerManager implements vscode.Disposable {
            private serverProcess: ChildProcess | null = null;
            // private currentPort: number | null = null; // 移除 TCP 端口
            private currentBaseUrl: string | null = null; // 新增：存储基础 URL
            // ... 其他成员
        ```
    *   **`startServer` 方法修改:**
        *   **修改 `stdout` 监听器:** 使用正则表达式捕获监听 URL，并在成功后更新状态和 `currentBaseUrl`。
        ```typescript
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
                this.statusBarManager.setStatus('running', port); // 更新状态栏，传入端口
                console.log(`Debug MCP Server successfully started, listening on ${this.currentBaseUrl}.`);
                this.outputChannel.appendLine(`Debug MCP Server successfully started, listening on ${this.currentBaseUrl}.`);
            }
        });
        ```
    *   **`stopServer` 方法修改:** 在服务器停止或启动失败时，重置 `currentBaseUrl`。
        ```typescript
        // 在 'exit' 事件监听器中
        this.serverProcess.on('exit', (code, signal) => {
            // ... (现有逻辑) ...
            this.currentBaseUrl = null; // 重置 URL
            this.serverProcess = null;
        });

        // 在 'error' 事件监听器中
        this.serverProcess.on('error', (err) => {
            // ... (现有逻辑) ...
            this.currentBaseUrl = null; // 重置 URL
            this.serverProcess = null;
        });

        // 在 try...catch 的 catch 块中
        } catch (error: any) {
            // ... (现有逻辑) ...
            this.currentBaseUrl = null; // 重置 URL
            this.serverProcess = null;
        }

        // 在 stopServer 方法的 kill 失败分支中
        if (!killed) {
            // ... (现有逻辑) ...
            this.currentBaseUrl = null; // 重置 URL
            this.serverProcess = null;
        }
        ```
    *   **修改 `copyMcpConfigToClipboard` 方法:** 生成 SSE 连接配置。
        ```typescript
        public async copyMcpConfigToClipboard(): Promise<void> {
            try {
                if (this.statusBarManager.getStatus() !== 'running' || !this.currentBaseUrl) {
                     vscode.window.showWarningMessage('Debug MCP Server is not running or URL is unknown. Cannot copy SSE config.');
                     this.outputChannel.appendLine('Attempted to copy SSE config, but server not running or URL unknown.');
                     return;
                }

                // **修改:** 生成 SSE 配置
                const sseUrl = `${this.currentBaseUrl}/sse`; // 拼接 SSE 端点
                const postUrl = `${this.currentBaseUrl}/messages`; // 拼接消息 POST 端点

                const mcpConfig = {
                    mcpServers: {
                        "vscode-debugger-mcp": { // 保持键名一致
                            // 移除 command, args, host, port
                            sseUrl: sseUrl, // SSE 连接 URL
                            postMessagesUrl: postUrl // 消息 POST URL
                            // env 字段通常不再需要
                        }
                    }
                };

                const configString = JSON.stringify(mcpConfig, null, 2);
                await vscode.env.clipboard.writeText(configString);
                vscode.window.showInformationMessage(`MCP server SSE configuration (URL: ${this.currentBaseUrl}) copied to clipboard!`);
                this.outputChannel.appendLine(`MCP server SSE configuration (URL: ${this.currentBaseUrl}) copied to clipboard.`);
                console.log('MCP SSE config copied:', configString);

            } catch (error) {
                const errorMsg = `Failed to copy MCP SSE config: ${error instanceof Error ? error.message : String(error)}`;
                console.error(errorMsg);
                this.outputChannel.appendLine(`Error: ${errorMsg}`);
                vscode.window.showErrorMessage(errorMsg);
                this.outputChannel.show(true);
            }
        }
        ```

**3. 插件端修改 (`src/statusBarManager.ts`)**

*   **目标:** 修改状态栏管理器以接受并显示端口号（从 URL 中提取）。
*   **修改点:** (与上一个 TCP 规划中的修改相同，因为仍然需要显示端口号)
    *   添加 `currentPort` 成员变量。
    *   修改 `setStatus` 方法接受可选的端口参数。
    *   修改 `updateStatusBar` 方法在 `running` 状态下显示端口号。

**4. 客户端配置指导 (`mcp_settings.json`)**

*   **目标:** 提供给用户的新的配置格式示例。
*   **示例:**
    ```json
    {
      "mcpServers": {
        "vscode-debugger-mcp": {
          "sseUrl": "http://localhost:6009/sse", // 替换为实际监听 URL + /sse
          "postMessagesUrl": "http://localhost:6009/messages" // 替换为实际监听 URL + /messages
        }
      }
    }
    ```
*   **说明:** 指导用户移除原有的 `command`, `args`, `host`, `port` 字段，添加 `sseUrl` 和 `postMessagesUrl`，指向服务器实际监听的地址和对应的端点。插件提供的 "Copy MCP Config" 功能将自动生成此格式。

**5. (可选) 文档更新**

*   考虑更新 `Docs/Doc_MCP.md` 或相关文档，说明新的 HTTP/SSE 连接方式和配置方法。可以创建一个新任务分配给文档编写者。

**总结:**
此规划基于 SDK 提供的 `SSEServerTransport`，将通信方式切换为 HTTP+SSE。服务器端需要引入 `express` 并处理 HTTP 请求。插件端需要调整启动信息捕获逻辑，并更新配置复制功能以生成基于 URL 的配置。状态栏显示逻辑与 TCP 方案类似，仍显示端口号。