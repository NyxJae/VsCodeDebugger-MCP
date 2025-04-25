import { logger } from './config';
import { handlePluginResponse, PluginResponse } from './pluginCommunicator';
import * as Constants from './constants';
import { closeHttpServer } from './httpServer'; // 导入关闭服务器的函数

/**
 * 处理优雅关闭信号 (SIGINT, SIGTERM)。
 * @param signal 接收到的信号名称。
 */
const handleShutdown = (signal: string) => {
    logger.info(`[Process Handlers] Received ${signal}. Debug MCP Server Stopping...`);

    // 设置关闭超时
    const shutdownTimeout = setTimeout(() => {
        logger.warn('[Process Handlers] Server close timed out (5 seconds), forcing exit.');
        process.exit(1); // 超时强制退出
    }, 5000);

    // 关闭 HTTP 服务器
    closeHttpServer((err) => {
        clearTimeout(shutdownTimeout); // 清除超时计时器
        if (err) {
            logger.error('[Process Handlers] Error during server shutdown:', err);
            process.exit(1); // 关闭出错，非正常退出
        } else {
            logger.info('[Process Handlers] Server shutdown completed successfully.');
            process.exit(0); // 正常退出
        }
    });
};

/**
 * 注册进程级别的事件处理器。
 */
export function registerProcessHandlers() {
    // 处理服务器关闭信号
    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));

    // 监听未处理的 Promise 拒绝
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('[Process Handlers] Unhandled Rejection at:', promise, 'reason:', reason);
      // 考虑是否需要退出进程，取决于应用的健壮性要求
      // process.exit(1);
    });

    // 监听未捕获的异常
    process.on('uncaughtException', (error) => {
      logger.error('[Process Handlers] Uncaught Exception:', error);
      // 未捕获异常通常表示程序处于不稳定状态，建议退出
      process.exit(1);
    });

    // 监听来自插件的 IPC 消息
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
            logger.warn(`[Process Handlers] Received unexpected message structure via IPC:`, message);
        }
    });

    logger.info('[Process Handlers] Process event handlers registered.');
}