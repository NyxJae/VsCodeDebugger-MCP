import express, { Request, Response } from "express";
import http from 'http';
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { server } from './mcpInstance'; // 导入 MCP Server 实例
import { logger, port } from './config'; // 导入 logger 和 port
import * as Constants from './constants';

let httpServer: http.Server | undefined;
const transports: { [sessionId: string]: SSEServerTransport } = {};

/**
 * 启动 MCP Server 的 HTTP/SSE 接口。
 * @param listenPort 要监听的端口。
 */
export function startHttpServer(listenPort: number) {
    logger.info(`[HTTP Server] Starting HTTP/SSE interface on port ${listenPort}...`);

    const app = express();

    // SSE 连接端点
    app.get("/sse", async (req: Request, res: Response) => {
        logger.info(`[HTTP Server] SSE connection request received from ${req.ip}`);
        const transport = new SSEServerTransport('/messages', res);
        transports[transport.sessionId] = transport;
        logger.info(`[HTTP Server] SSE transport created with sessionId: ${transport.sessionId}`);

        // 当 SSE 连接关闭时，清理 transport
        res.on("close", () => {
            logger.info(`[HTTP Server] SSE connection closed for sessionId: ${transport.sessionId}`);
            delete transports[transport.sessionId];
        });

        // 将 transport 连接到 McpServer
        try {
            await server.connect(transport);
            logger.info(`[HTTP Server] McpServer connected to SSE transport for sessionId: ${transport.sessionId}`);
        } catch (connectError) {
            logger.error(`[HTTP Server] Failed to connect McpServer to SSE transport for sessionId: ${transport.sessionId}`, connectError);
            if (!res.writableEnded) {
                res.end();
            }
            delete transports[transport.sessionId];
        }
    });

    // 客户端消息 POST 端点
    app.post("/messages", async (req: Request, res: Response) => {
        const sessionId = req.query.sessionId as string;
        logger.debug(`[HTTP Server] Received POST to /messages for sessionId: ${sessionId}`);
        const transport = transports[sessionId];
        if (transport) {
            try {
                await transport.handlePostMessage(req, res);
                logger.debug(`[HTTP Server] Successfully handled POST message for sessionId: ${sessionId}`);
            } catch (postError) {
                logger.error(`[HTTP Server] Error handling POST message for sessionId: ${sessionId}`, postError);
                if (!res.headersSent) {
                     res.status(500).send('Error processing message');
                 } else if (!res.writableEnded) {
                     res.end();
                 }
            }
        } else {
            logger.warn(`[HTTP Server] No active SSE transport found for sessionId: ${sessionId}`);
            res.status(400).send('No active SSE transport found for this session ID');
        }
    });

    // 启动 HTTP 服务器
    const startListening = (currentPort: number) => {
        if (httpServer && httpServer.listening) {
            try {
                httpServer.close();
            } catch (e) {
                logger.warn('[HTTP Server] Error closing previous server instance before retry:', e);
            }
        }

        httpServer = http.createServer(app);

        httpServer.on('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'EADDRINUSE') {
                logger.error(`[HTTP Server] Port ${currentPort} is already in use. Exiting.`);
                process.exit(1); // 端口占用是严重错误，直接退出
            } else {
                logger.error('[HTTP Server] HTTP server error:', error);
                process.exit(1); // 其他服务器错误也退出
            }
        });

        httpServer.listen(currentPort, () => {
            const address = httpServer?.address();
            const actualPort = typeof address === 'string' ? currentPort : address?.port ?? currentPort;
            if (!actualPort && actualPort !== 0) {
                 logger.error('[HTTP Server] Could not determine the actual listening port. Exiting.');
                 process.exit(1);
            }
            const listenUrl = `http://localhost:${actualPort}`;

            // **重要:** 务必使用标准输出，用于插件端捕获以显示服务器状态,其输出内容不要修改
            console.log(`${Constants.MCP_SERVER_LISTENING_MESSAGE_PREFIX}${actualPort}`);

            // 标准错误输出，用于日志记录
            logger.info(`[HTTP Server] MCP server HTTP/SSE interface available at ${listenUrl}`);

            // 成功监听后，将 server 实例附加到 process 以便关闭时访问
            (process as any).httpServer = httpServer;
        });
    };

    startListening(listenPort);
}

/**
 * 关闭 HTTP 服务器。
 * @param callback 关闭完成后的回调函数。
 */
export function closeHttpServer(callback: (err?: Error) => void) {
    const httpServerInstance = (process as any).httpServer as http.Server | undefined;
    if (httpServerInstance && httpServerInstance.listening) {
        logger.info('[HTTP Server] Closing HTTP server...');
        httpServerInstance.close((err) => {
            if (err) {
                logger.error('[HTTP Server] Error closing HTTP server:', err);
            } else {
                logger.info('[HTTP Server] HTTP server closed successfully.');
            }
            // 清理引用
            (process as any).httpServer = undefined;
            httpServer = undefined;
            callback(err);
        });
    } else {
        logger.info('[HTTP Server] No active HTTP server found or server not listening.');
        callback(); // 没有服务器在运行，直接回调
    }
}