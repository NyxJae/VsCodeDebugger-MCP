// 导入路径根据 SDK README 示例调整
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"; // 移除 Stdio
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"; // 导入 SSE Transport
import express, { Request, Response } from "express"; // 导入 express
import http from 'http'; // 导入 http 模块以获取 Server 类型

// 导入新的工具处理函数
// 导入新的 Debug 工具模块
import * as DebugTools from './toolProviders/debug';
// 导入 pluginCommunicator 相关函数和接口
import { handlePluginResponse, PluginResponse } from './pluginCommunicator';
import * as Constants from './constants'; // 导入常量

import { z } from "zod"; // 确保 Zod 已导入
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
  name: 'vscode-debugger-mcp', // 直接使用字符串，因为它在 src/constants.ts 中定义
  version: '1.1.0' // Use version as per README example - TODO: Consider moving to constants or package.json
});

// 注册获取调试配置的工具
server.tool(
    Constants.TOOL_GET_DEBUGGER_CONFIGURATIONS, // 使用常量
    {}, // 输入 Schema 为空对象，因为此工具无输入参数
    DebugTools.handleGetDebuggerConfigurations // 指定处理函数
);
logger.info(`[MCP Server] Registered tool: ${Constants.TOOL_GET_DEBUGGER_CONFIGURATIONS}`); // 添加日志

// 注册设置断点的工具
server.tool(
    Constants.TOOL_SET_BREAKPOINT, // 使用常量
    DebugTools.setBreakpointSchema.shape, // 传入 Zod Schema 的 shape
    DebugTools.handleSetBreakpoint // 指定处理函数
);
logger.info(`[MCP Server] Registered tool: ${Constants.TOOL_SET_BREAKPOINT}`); // 添加日志

// 注册获取所有断点的工具
server.tool(
    Constants.TOOL_GET_BREAKPOINTS, // 使用常量
    DebugTools.getBreakpointsSchema.shape, // 输入 Schema
    DebugTools.handleGetBreakpoints // 指定处理函数
);
logger.info(`[MCP Server] Registered tool: ${Constants.TOOL_GET_BREAKPOINTS}`); // 添加日志

// 注册移除断点的工具
server.tool(
    Constants.TOOL_REMOVE_BREAKPOINT, // 使用常量
    DebugTools.BaseRemoveBreakpointInputSchema.shape, // 使用基础 Schema 的 shape
    DebugTools.handleRemoveBreakpoint // 指定处理函数
);
logger.info(`[MCP Server] Registered tool: ${Constants.TOOL_REMOVE_BREAKPOINT}`); // 添加日志

// 注册启动调试的工具
server.tool(
    Constants.TOOL_START_DEBUGGING, // 使用常量
    DebugTools.startDebuggingSchema.shape, // 传入 Zod Schema 的 shape
    DebugTools.handleStartDebugging // 指定处理函数
);
logger.info(`[MCP Server] Registered tool: ${Constants.TOOL_START_DEBUGGING}`); // 添加日志

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

        // **重要:** 标准输出，用于插件捕获实际监听地址,其输出内容不要修改
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


// 监听来自插件的消息
process.on('message', (message: any) => {
    // 检查消息是否符合更新后的 PluginResponse 接口的结构
    if (
        message &&
        typeof message === 'object' &&
        message.type === Constants.IPC_MESSAGE_TYPE_RESPONSE && // 使用常量
        typeof message.requestId === 'string' && // 检查 requestId 字段
        (message.status === Constants.IPC_STATUS_SUCCESS || message.status === Constants.IPC_STATUS_ERROR) // 使用正确的常量名
        // payload 和 error 是可选的，不强制检查
    ) {
        // 确认消息结构符合 PluginResponse，然后处理
        handlePluginResponse(message as PluginResponse);
    } else {
        // 记录接收到未知结构的消息
        logger.warn(`[MCP Server] Received unexpected message structure via IPC:`, message);
    }
    // 可以添加其他类型的消息处理逻辑
});

main(); // Call the main function to start the server