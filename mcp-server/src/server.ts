// 导入路径根据 SDK README 示例调整
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"; // 移除 Stdio
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"; // 导入 SSE Transport
import express, { Request, Response } from "express"; // 导入 express
import http from 'http'; // 导入 http 模块以获取 Server 类型

// import { z } from "zod"; // Zod is not strictly needed for the simple helloWorld tool without schema validation
// import { RequestHandlerExtra } from "@modelcontextprotocol/sdk/server/types.js"; // Attempt to import if needed, otherwise use 'any'

// 端口配置
const DEFAULT_PORT = 6009; // 定义默认端口
const port = parseInt(process.env.MCP_PORT || '', 10) || DEFAULT_PORT;

// 临时使用 console 作为 logger
// 注意：确保日志输出到 stderr，避免干扰 stdout 上的 MCP 通信
const logger = {
  info: (...args: any[]) => console.error('[INFO]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
  warn: (...args: any[]) => console.error('[WARN]', ...args),
  debug: (...args: any[]) => console.error('[DEBUG]', ...args)
};

// 创建服务器实例 (使用 McpServer 构造函数)
const server = new McpServer({
  // transport is connected later
  logger: logger, // Pass logger instance
  name: 'vscode-debugger-mcp', // Use name as per README example
  version: '1.1.0' // Use version as per README example
});

// 定义 helloWorld 工具处理函数 (返回值结构根据 README 调整)
// 修改签名以匹配 server.tool 的期望: (args: SchemaType, extra: RequestHandlerExtra)
async function helloWorldHandler(
    args: {}, // Corresponds to the empty schema {} provided in server.tool
    extra: any // Use 'any' for RequestHandlerExtra if type import is problematic or details aren't needed
): Promise<{ content: { type: "text", text: string }[] }> { // Explicitly type the content element
  logger.info('Executing helloWorld tool', { args, extra }); // Log received args and extra
  // args are unused in this simple tool
  return {
    content: [{ type: "text", text: "HelloWorld" }] // Return structure expected by SDK tool handler
  };
}

// 注册 helloWorld 工具 (使用 server.tool 方法)
server.tool(
  'helloWorld',
  {}, // Pass an empty object {} as the raw shape for the input schema (no input needed)
  helloWorldHandler // Pass the correctly signed handler function
  // description is not directly accepted by McpServer.tool
);

// 启动服务器 (使用 server.connect)
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
    app.post("/messages", async (req: Request, res: Response) => {
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

    // 启动 HTTP 服务器 - 实现动态端口
    let httpServer: http.Server | undefined; // 声明变量以便在回调和错误处理中访问

    const startListening = (listenPort: number) => {
      // 如果是重试，确保之前的实例已关闭（尽管 listen 失败通常会处理）
      if (httpServer && httpServer.listening) {
          try {
              httpServer.close();
          } catch (e) {
              logger.warn('Error closing previous server instance before retry:', e);
          }
      }

      // 创建新的 http server 实例
      // 注意：之前是 app.listen 直接创建并启动，现在分离创建和启动
      httpServer = http.createServer(app);

      httpServer.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          logger.error(`Port ${listenPort} is already in use. Exiting.`);
          process.exit(1); // EADDRINUSE 错误直接退出
        } else {
          logger.error('HTTP server error:', error);
          process.exit(1); // 其他类型的错误直接退出
        }
      });

      httpServer.listen(listenPort, () => {
        const address = httpServer?.address(); // 使用可选链
        // 如果监听成功，获取实际端口
        const actualPort = typeof address === 'string' ? listenPort : address?.port ?? listenPort; // listenPort 作为备选不合适，应为 null 或抛错
        if (!actualPort && actualPort !== 0) { // 端口 0 是有效的
             logger.error('Could not determine the actual listening port. Exiting.');
             process.exit(1);
        }
        const listenUrl = `http://localhost:${actualPort}`;

        // **重要:** 标准输出，用于插件捕获实际监听地址
        console.log(`MCP Server listening on port ${actualPort}`);

        // 标准错误输出，用于日志记录
        logger.info(`MCP server HTTP/SSE interface available at ${listenUrl}`);

        // 成功监听后，将 server 实例附加到 process 以便关闭时访问
        (process as any).httpServer = httpServer;
      });
    };

    // 初始尝试启动监听
    startListening(port);

  } catch (error) {
    logger.error(`Failed to start MCP server on port ${port}:`, error);
    process.exit(1);
  }
}

// 处理服务器关闭 (README doesn't explicitly show McpServer.stop, rely on transport closure or process exit)
// Keep basic signal handling to exit the process
const handleShutdown = (signal: string) => {
    logger.info(`Received ${signal}. Debug MCP Server Stopping...`);
    // 从 process 对象获取 httpServer，类型安全处理
    const httpServerInstance = (process as any).httpServer as http.Server | undefined;

    if (httpServerInstance && httpServerInstance.listening) { // 检查是否存在且正在监听
        logger.info('Closing HTTP server...');
        // 设置超时强制退出计时器
        const shutdownTimeout = setTimeout(() => {
            logger.warn('HTTP server close timed out (5 seconds), forcing exit.');
            process.exit(1); // 超时强制退出
        }, 5000); // 5秒超时

        httpServerInstance.close((err) => {
            clearTimeout(shutdownTimeout); // 关闭成功，清除超时计时器
            if (err) {
                logger.error('Error closing HTTP server:', err);
                process.exit(1); // 关闭出错也退出
            } else {
                logger.info('HTTP server closed successfully.');
                process.exit(0); // 在 HTTP 服务器成功关闭后正常退出进程
            }
        });
    } else {
        // 如果没有 httpServer 实例或实例未在监听状态，直接退出
        logger.info('No active HTTP server found or server not listening, exiting directly.');
        process.exit(0);
    }
};
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));


// 监听未处理的 Promise 拒绝 (Keep unchanged)
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Consider if process needs to exit
  // process.exit(1);
});

// 监听未捕获的异常 (Keep unchanged)
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  // Consider if process needs to exit
  process.exit(1); // Uncaught exceptions should usually cause an exit
});


main(); // Call the main function to start the server