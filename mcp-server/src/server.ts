import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express, { Request, Response } from "express";
import http from 'http';

import * as DebugTools from './toolProviders/debug';
import { continueDebuggingTool } from './toolProviders/debug/continueDebugging';
import { stepExecutionTool } from './toolProviders/debug/stepExecution';
import { stopDebuggingSchema, handleStopDebugging } from './toolProviders/debug';
import { handlePluginResponse, PluginResponse } from './pluginCommunicator';
import * as Constants from './constants';
import { StepExecutionParams } from './types';

import { z } from "zod";

// 端口配置
const DEFAULT_PORT = 6009;
const port = parseInt(process.env.MCP_PORT || '', 10) || DEFAULT_PORT;

// 注意：确保日志输出到 stderr，避免干扰 stdout 上的 MCP 通信
const logger = {
  info: (...args: any[]) => console.error('[INFO]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
  warn: (...args: any[]) => console.error('[WARN]', ...args),
  debug: (...args: any[]) => console.error('[DEBUG]', ...args)
};

const server = new McpServer({
  logger: logger,
  name: 'vscode-debugger-mcp',
  version: '1.1.0' // TODO: Consider moving to constants or package.json
});

server.tool(
    Constants.TOOL_GET_DEBUGGER_CONFIGURATIONS,
    {},
    DebugTools.handleGetDebuggerConfigurations
);
logger.info(`[MCP Server] Registered tool: ${Constants.TOOL_GET_DEBUGGER_CONFIGURATIONS}`);

server.tool(
    Constants.TOOL_SET_BREAKPOINT,
    DebugTools.setBreakpointSchema.shape,
    DebugTools.handleSetBreakpoint
);

server.tool(
    Constants.TOOL_GET_BREAKPOINTS,
    DebugTools.getBreakpointsSchema.shape,
    DebugTools.handleGetBreakpoints
);

server.tool(
    Constants.TOOL_REMOVE_BREAKPOINT,
    DebugTools.BaseRemoveBreakpointInputSchema.shape,
    DebugTools.handleRemoveBreakpoint
);

server.tool(
    Constants.TOOL_START_DEBUGGING,
    DebugTools.startDebuggingSchema.shape,
    DebugTools.handleStartDebugging
);

server.tool(
    continueDebuggingTool.name,
    continueDebuggingTool.inputSchema.shape,
    async (args, extra) => {
        logger.info(`[MCP Server] Executing tool: ${continueDebuggingTool.name} with args:`, args);
        try {
            const result = await continueDebuggingTool.execute(args);
            logger.info(`[MCP Server] Tool ${continueDebuggingTool.name} execution result:`, result);

            let responseContent = `Status: ${result.status}`;
            if (result.message) {
                responseContent += `\nMessage: ${result.message}`;
            }
            if (result.status === 'stopped' && result.stop_event_data) {
                try {
                    responseContent += `\nStop Event Data: ${JSON.stringify(result.stop_event_data, null, 2)}`;
                } catch (jsonError) {
                    logger.warn(`[MCP Server] Failed to stringify stop_event_data for ${continueDebuggingTool.name}:`, jsonError);
                    responseContent += `\nStop Event Data: (Error serializing)`;
                }
            }

            return {
                content: [{ type: 'text', text: responseContent }],
                isError: result.status === 'error' || result.status === 'timeout',
            };
        } catch (error: any) {
            logger.error(`[MCP Server] Error executing tool ${continueDebuggingTool.name}:`, error);
            return {
                content: [{ type: 'text', text: `Error executing tool: ${error.message}` }],
                isError: true,
            };
        }
    }
);

server.tool(
    stepExecutionTool.name,
    stepExecutionTool.inputSchema.shape,
    async (args: StepExecutionParams, extra: any) => {
        logger.info(`[MCP Server] Executing tool: ${stepExecutionTool.name} with args:`, args);
        try {
            const result = await stepExecutionTool.execute(args);
            logger.info(`[MCP Server] Tool ${stepExecutionTool.name} execution result:`, result);

            let responseContent = `Status: ${result.status}`;
            if (result.message) {
                responseContent += `\nMessage: ${result.message}`;
            }
            if (result.status === 'stopped' && result.stop_event_data) {
                try {
                    responseContent += `\nStop Event Data: ${JSON.stringify(result.stop_event_data, null, 2)}`;
                } catch (jsonError) {
                    logger.warn(`[MCP Server] Failed to stringify stop_event_data for ${stepExecutionTool.name}:`, jsonError);
                    responseContent += `\nStop Event Data: (Error serializing)`;
                }
            }

            return {
                content: [{ type: 'text', text: responseContent }],
                isError: result.status === 'error' || result.status === 'timeout',
            };
        } catch (error: any) {
            logger.error(`[MCP Server] Error executing tool ${stepExecutionTool.name}:`, error);
            return {
                content: [{ type: 'text', text: `Error executing tool: ${error.message}` }],
                isError: true,
            };
        }
    }
);

server.tool(
    Constants.TOOL_STOP_DEBUGGING,
    stopDebuggingSchema.shape,
    async (args, extra) => {
        logger.info(`[MCP Server] Executing tool: ${Constants.TOOL_STOP_DEBUGGING}`);
        try {
            const result = await handleStopDebugging(args);
            logger.info(`[MCP Server] Tool ${Constants.TOOL_STOP_DEBUGGING} execution result:`, result);
            return {
                content: [{ type: 'text', text: result.message }],
                isError: result.status === 'error',
            };
        } catch (error: any) {
            logger.error(`[MCP Server] Error executing tool ${Constants.TOOL_STOP_DEBUGGING}:`, error);
            return {
                content: [{ type: 'text', text: `执行停止调试工具时出错: ${error.message}` }],
                isError: true,
            };
        }
    }
);


async function main() {
  try {
    logger.info(`Starting MCP server with SDK via HTTP/SSE on port ${port}...`);

    const app = express();
    // 用于存储每个 SSE 连接的 transport 实例
    const transports: { [sessionId: string]: SSEServerTransport } = {};

    // SSE 连接端点
    app.get("/sse", async (req: Request, res: Response) => {
      logger.info(`SSE connection request received from ${req.ip}`);
      const transport = new SSEServerTransport('/messages', res);
      transports[transport.sessionId] = transport;
      logger.info(`SSE transport created with sessionId: ${transport.sessionId}`);

      // 当 SSE 连接关闭时，清理 transport
      res.on("close", () => {
        logger.info(`SSE connection closed for sessionId: ${transport.sessionId}`);
        delete transports[transport.sessionId];
      });

      // 将 transport 连接到 McpServer
      try {
          await server.connect(transport);
          logger.info(`McpServer connected to SSE transport for sessionId: ${transport.sessionId}`);
      } catch (connectError) {
          logger.error(`Failed to connect McpServer to SSE transport for sessionId: ${transport.sessionId}`, connectError);
          if (!res.writableEnded) {
              res.end();
          }
          delete transports[transport.sessionId];
      }
    });

    // 客户端消息 POST 端点
    app.post("/messages", async (req: Request, res: Response) => {
      const sessionId = req.query.sessionId as string;
      logger.debug(`Received POST to /messages for sessionId: ${sessionId}`);
      const transport = transports[sessionId];
      if (transport) {
        try {
          await transport.handlePostMessage(req, res);
          logger.debug(`Successfully handled POST message for sessionId: ${sessionId}`);
        } catch (postError) {
          logger.error(`Error handling POST message for sessionId: ${sessionId}`, postError);
          if (!res.headersSent) {
               res.status(500).send('Error processing message');
           } else if (!res.writableEnded) {
               res.end();
           }
        }
      } else {
        logger.warn(`No active SSE transport found for sessionId: ${sessionId}`);
        res.status(400).send('No active SSE transport found for this session ID');
      }
    });

    // 启动 HTTP 服务器
    let httpServer: http.Server | undefined;

    const startListening = (listenPort: number) => {
      if (httpServer && httpServer.listening) {
          try {
              httpServer.close();
          } catch (e) {
              logger.warn('Error closing previous server instance before retry:', e);
          }
      }

      httpServer = http.createServer(app);

      httpServer.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          logger.error(`Port ${listenPort} is already in use. Exiting.`);
          process.exit(1);
        } else {
          logger.error('HTTP server error:', error);
          process.exit(1);
        }
      });

      httpServer.listen(listenPort, () => {
        const address = httpServer?.address();
        const actualPort = typeof address === 'string' ? listenPort : address?.port ?? listenPort;
        if (!actualPort && actualPort !== 0) {
             logger.error('Could not determine the actual listening port. Exiting.');
             process.exit(1);
        }
        const listenUrl = `http://localhost:${actualPort}`;

        // **重要:** 务必使用标准输出，用于插件端捕获以显示服务器状态,其输出内容不要修改
        console.log(`${Constants.MCP_SERVER_LISTENING_MESSAGE_PREFIX}${actualPort}`);

        // 标准错误输出，用于日志记录
        logger.info(`MCP server HTTP/SSE interface available at ${listenUrl}`);

        // 成功监听后，将 server 实例附加到 process 以便关闭时访问
        (process as any).httpServer = httpServer;
      });
    };

    startListening(port);

  } catch (error) {
    logger.error(`Failed to start MCP server on port ${port}:`, error);
    process.exit(1);
  }
}

// 处理服务器关闭
const handleShutdown = (signal: string) => {
    logger.info(`Received ${signal}. Debug MCP Server Stopping...`);
    const httpServerInstance = (process as any).httpServer as http.Server | undefined;

    if (httpServerInstance && httpServerInstance.listening) {
        logger.info('Closing HTTP server...');
        const shutdownTimeout = setTimeout(() => {
            logger.warn('HTTP server close timed out (5 seconds), forcing exit.');
            process.exit(1);
        }, 5000);

        httpServerInstance.close((err) => {
            clearTimeout(shutdownTimeout);
            if (err) {
                logger.error('Error closing HTTP server:', err);
                process.exit(1);
            } else {
                logger.info('HTTP server closed successfully.');
                process.exit(0);
            }
        });
    } else {
        logger.info('No active HTTP server found or server not listening, exiting directly.');
        process.exit(0);
    }
};
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));


// 监听未处理的 Promise 拒绝
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// 监听未捕获的异常
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});


// 监听来自插件的消息
process.on('message', (message: any) => {
    if (
        message &&
        typeof message === 'object' &&
        message.type === Constants.IPC_MESSAGE_TYPE_RESPONSE &&
        typeof message.requestId === 'string' &&
        (message.status === Constants.IPC_STATUS_SUCCESS || message.status === Constants.IPC_STATUS_ERROR)
    ) {
        handlePluginResponse(message as PluginResponse);
    } else {
        logger.warn(`[MCP Server] Received unexpected message structure via IPC:`, message);
    }
});

main();