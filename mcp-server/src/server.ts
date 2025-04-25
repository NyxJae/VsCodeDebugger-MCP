import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express, { Request, Response } from "express";
import http from 'http';

import * as DebugTools from './toolProviders/debug';
import { continueDebuggingTool } from './toolProviders/debug/continueDebugging';
import { stepExecutionTool } from './toolProviders/debug/stepExecution';
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

// --- 修改 TOOL_GET_DEBUGGER_CONFIGURATIONS 的注册 ---
server.tool(
    DebugTools.getDebuggerConfigurationsTool.name, // 使用工具对象中的 name
    DebugTools.getDebuggerConfigurationsTool.inputSchema.shape, // 使用工具对象中的 inputSchema
    async (args, extra) => { // 添加适配器函数
        logger.info(`[MCP Server] Executing tool: ${DebugTools.getDebuggerConfigurationsTool.name}`);
        try {
            // 调用工具对象的 execute 方法
            const result = await DebugTools.getDebuggerConfigurationsTool.execute(args);
            logger.info(`[MCP Server] Tool ${DebugTools.getDebuggerConfigurationsTool.name} execution result status: ${result.status}`);

            let responseContent = "";
            let isError = false;

            if (result.status === Constants.IPC_STATUS_SUCCESS && result.configurations) {
                // 将 execute 返回的配置数组适配为 MCP Server 需要的文本格式
                try {
                    responseContent = JSON.stringify(result.configurations, null, 2);
                    logger.debug(`[MCP Server] Tool ${DebugTools.getDebuggerConfigurationsTool.name} success response content generated.`);
                } catch (jsonError) {
                     logger.error(`[MCP Server] Failed to stringify configurations for ${DebugTools.getDebuggerConfigurationsTool.name}:`, jsonError);
                     responseContent = `Error: Failed to serialize configurations result.`;
                     isError = true;
                }
            } else {
                // 处理 execute 返回的错误状态
                responseContent = `Error: ${result.message || 'Failed to get debugger configurations.'}`;
                isError = true;
                logger.warn(`[MCP Server] Tool ${DebugTools.getDebuggerConfigurationsTool.name} execution failed: ${responseContent}`);
            }

            return {
                content: [{ type: 'text', text: responseContent }],
                isError: isError,
            };
        } catch (error: any) {
            logger.error(`[MCP Server] Unhandled error executing tool ${DebugTools.getDebuggerConfigurationsTool.name}:`, error);
            return {
                content: [{ type: 'text', text: `Internal server error executing tool: ${error.message}` }],
                isError: true,
            };
        }
    }
);
// 保留日志，但现在它会在适配器函数内部记录
// logger.info(`[MCP Server] Registered tool: ${DebugTools.getDebuggerConfigurationsTool.name}`); // 可以移除或保留

// --- 修改 TOOL_SET_BREAKPOINT 的注册 ---
server.tool(
    DebugTools.setBreakpointTool.name, // 使用工具对象中的 name
    DebugTools.setBreakpointTool.inputSchema.shape, // 使用工具对象中的 inputSchema
    async (args, extra) => { // 添加适配器函数
        const toolName = DebugTools.setBreakpointTool.name;
        logger.info(`[MCP Server] Executing tool: ${toolName} with args:`, args);
        try {
            // 调用工具对象的 execute 方法
            const result = await DebugTools.setBreakpointTool.execute(args);
            logger.info(`[MCP Server] Tool ${toolName} execution result status: ${result.status}`);

            let responseContent = "";
            let isError = false;

            if (result.status === Constants.IPC_STATUS_SUCCESS && result.breakpoint) {
                // 将 execute 返回的 breakpoint 对象适配为 MCP Server 需要的文本格式
                try {
                    responseContent = JSON.stringify(result.breakpoint, null, 2);
                    logger.debug(`[MCP Server] Tool ${toolName} success response content generated.`);
                } catch (jsonError) {
                     logger.error(`[MCP Server] Failed to stringify breakpoint info for ${toolName}:`, jsonError);
                     responseContent = `Error: Failed to serialize breakpoint result.`;
                     isError = true;
                }
            } else {
                // 处理 execute 返回的错误状态
                responseContent = `Error setting breakpoint: ${result.message || 'Failed to set breakpoint.'}`;
                isError = true;
                logger.warn(`[MCP Server] Tool ${toolName} execution failed: ${responseContent}`);
            }

            return {
                content: [{ type: 'text', text: responseContent }],
                isError: isError,
            };
        } catch (error: any) {
            logger.error(`[MCP Server] Unhandled error executing tool ${toolName}:`, error);
            return {
                content: [{ type: 'text', text: `Internal server error executing tool ${toolName}: ${error.message}` }],
                isError: true,
            };
        }
    }
);

// --- 修改 TOOL_GET_BREAKPOINTS 的注册 ---
server.tool(
    DebugTools.getBreakpointsTool.name, // 使用工具对象中的 name
    DebugTools.getBreakpointsTool.inputSchema.shape, // 使用工具对象中的 inputSchema
    async (args, extra) => { // 添加适配器函数
        const toolName = DebugTools.getBreakpointsTool.name;
        logger.info(`[MCP Server] Executing tool: ${toolName}`);
        try {
            // 调用工具对象的 execute 方法
            const result = await DebugTools.getBreakpointsTool.execute(args);
            logger.info(`[MCP Server] Tool ${toolName} execution result status: ${result.status}`);

            let responseContent = "";
            let isError = false;

            if (result.status === Constants.IPC_STATUS_SUCCESS && result.breakpoints) {
                // 将 execute 返回的整个结果（包含 timestamp 和 breakpoints 数组）适配为 MCP Server 需要的文本格式
                try {
                    const payloadToSerialize = {
                        timestamp: result.timestamp,
                        breakpoints: result.breakpoints
                    };
                    responseContent = JSON.stringify(payloadToSerialize, null, 2);
                    logger.debug(`[MCP Server] Tool ${toolName} success response content generated.`);
                } catch (jsonError) {
                     logger.error(`[MCP Server] Failed to stringify breakpoints list for ${toolName}:`, jsonError);
                     responseContent = `Error: Failed to serialize breakpoints result.`;
                     isError = true;
                }
            } else {
                // 处理 execute 返回的错误状态
                responseContent = `Error getting breakpoints: ${result.message || 'Failed to get breakpoints.'}`;
                isError = true;
                logger.warn(`[MCP Server] Tool ${toolName} execution failed: ${responseContent}`);
            }

            return {
                content: [{ type: 'text', text: responseContent }],
                isError: isError,
            };
        } catch (error: any) {
            logger.error(`[MCP Server] Unhandled error executing tool ${toolName}:`, error);
            return {
                content: [{ type: 'text', text: `Internal server error executing tool ${toolName}: ${error.message}` }],
                isError: true,
            };
        }
    }
);

// --- 修改 TOOL_REMOVE_BREAKPOINT 的注册 ---
server.tool(
    DebugTools.removeBreakpointTool.name, // 使用工具对象中的 name
    DebugTools.removeBreakpointTool.baseinputSchema.shape, // 使用工具对象中的 inputSchema
    async (args, extra) => { // 添加适配器函数
        const toolName = DebugTools.removeBreakpointTool.name;
        // 注意：输入参数 args 应该已经被 MCP 框架根据 inputSchema 校验过了
        logger.info(`[MCP Server] Executing tool: ${toolName} with validated args:`, args);
        try {
            // 调用工具对象的 execute 方法
            const result = await DebugTools.removeBreakpointTool.execute(args);
            logger.info(`[MCP Server] Tool ${toolName} execution result status: ${result.status}`);

            let responseContent = result.message || (result.status === Constants.IPC_STATUS_SUCCESS ? "操作成功完成。" : "发生未知错误。");
            let isError = result.status !== Constants.IPC_STATUS_SUCCESS;

            if (isError) {
                logger.warn(`[MCP Server] Tool ${toolName} execution failed: ${responseContent}`);
            } else {
                 logger.debug(`[MCP Server] Tool ${toolName} success response content generated.`);
            }

            return {
                content: [{ type: 'text', text: responseContent }],
                isError: isError,
            };
        } catch (error: any) {
            // 这个 catch 理论上不应该执行，因为 execute 内部已经 catch 了
            // 但为了健壮性保留
            logger.error(`[MCP Server] Unhandled error executing tool ${toolName}:`, error);
            return {
                content: [{ type: 'text', text: `Internal server error executing tool ${toolName}: ${error.message}` }],
                isError: true,
            };
        }
    }
);

// --- 修改 TOOL_START_DEBUGGING 的注册 ---
server.tool(
    DebugTools.startDebuggingTool.name, // 使用工具对象中的 name
    DebugTools.startDebuggingTool.inputSchema.shape, // 使用工具对象中的 inputSchema
    async (args, extra) => { // 添加适配器函数
        const toolName = DebugTools.startDebuggingTool.name;
        logger.info(`[MCP Server] Executing tool: ${toolName} with args:`, args);
        try {
            // 调用工具对象的 execute 方法
            const result = await DebugTools.startDebuggingTool.execute(args);
            logger.info(`[MCP Server] Tool ${toolName} execution result:`, result); // Log the whole result object

            let responseContent = "";
            // Determine error based on status defined in StartDebuggingOutputSchema
            const isError = result.status === 'error' || result.status === 'timeout';

            // 将 execute 返回的整个结果对象适配为 MCP Server 需要的文本格式
            try {
                responseContent = JSON.stringify(result, null, 2);
                if (isError) {
                     logger.warn(`[MCP Server] Tool ${toolName} execution failed. Response: ${responseContent}`);
                } else {
                     logger.debug(`[MCP Server] Tool ${toolName} success response content generated.`);
                }
            } catch (jsonError) {
                 logger.error(`[MCP Server] Failed to stringify start debugging result for ${toolName}:`, jsonError);
                 responseContent = `Error: Failed to serialize start debugging result. Status: ${result.status}, Message: ${result.message || 'N/A'}`;
                 // Ensure isError is true if serialization fails, though it likely indicates a prior error state anyway
                 // isError = true; // This might override a non-error status if only serialization fails, maybe better to just report serialization error.
            }

            return {
                content: [{ type: 'text', text: responseContent }],
                isError: isError,
            };
        } catch (error: any) {
            // Catch errors from the execute call itself (though it should handle its own errors)
            logger.error(`[MCP Server] Unhandled error executing tool ${toolName}:`, error);
            // Format error message consistent with the expected output structure
            const errorResponse = {
                status: 'error', // Assuming unhandled errors fall into 'error' category
                message: `Internal server error executing tool ${toolName}: ${error.message}`
            };
            return {
                // Attempt to stringify the error object
                content: [{ type: 'text', text: JSON.stringify(errorResponse, null, 2) }],
                isError: true,
            };
        }
    }
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

// --- 修改 TOOL_STOP_DEBUGGING 的注册 ---
server.tool(
    DebugTools.stopDebuggingTool.name, // 使用工具对象中的 name
    DebugTools.stopDebuggingTool.inputSchema.shape, // 使用工具对象中的 inputSchema
    async (args: z.infer<typeof DebugTools.stopDebuggingTool.inputSchema>, extra: any) => { // 添加适配器函数, 明确 args 类型
        const toolName = DebugTools.stopDebuggingTool.name;
        logger.info(`[MCP Server] Executing tool: ${toolName} with args:`, args);
        try {
            // 调用工具对象的 execute 方法
            const result = await DebugTools.stopDebuggingTool.execute(args);
            logger.info(`[MCP Server] Tool ${toolName} execution result status: ${result.status}`);

            let responseContent = result.message || (result.status === Constants.IPC_STATUS_SUCCESS ? "停止调试操作已成功请求。" : "停止调试时发生未知错误。");
            let isError = result.status !== Constants.IPC_STATUS_SUCCESS;

            if (isError) {
                logger.warn(`[MCP Server] Tool ${toolName} execution failed: ${responseContent}`);
            } else {
                 logger.debug(`[MCP Server] Tool ${toolName} success response content generated.`);
            }

            return {
                content: [{ type: 'text', text: responseContent }],
                isError: isError,
            };
        } catch (error: any) {
            // 这个 catch 理论上不应该执行，因为 execute 内部已经 catch 了
            logger.error(`[MCP Server] Unhandled error executing tool ${toolName}:`, error);
            const errorResponse = {
                status: Constants.IPC_STATUS_ERROR, // Use constant for status
                message: `Internal server error executing tool ${toolName}: ${error.message}`
            };
            return {
                content: [{ type: 'text', text: JSON.stringify(errorResponse, null, 2) }], // Stringify error object
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