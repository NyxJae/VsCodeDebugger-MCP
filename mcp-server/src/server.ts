import { logger, port } from './config'; // 导入配置
import { registerTools } from './toolRegistry'; // 导入工具注册函数
import { startHttpServer } from './httpServer'; // 导入 HTTP 服务器启动函数
import { registerProcessHandlers } from './processHandlers'; // 导入进程处理注册函数

/**
 * 主函数，初始化并启动 MCP 服务器。
 */
async function main() {
  try {
    logger.info(`[Main] Starting MCP server process...`);

    // 1. 注册进程事件处理器 (如 SIGINT, unhandledRejection)
    registerProcessHandlers();

    // 2. 注册所有 MCP 工具
    // 注意：McpServer 实例在 mcpInstance.ts 中创建，并在 toolRegistry 中导入和使用
    registerTools();

    // 3. 启动 HTTP/SSE 服务器接口
    startHttpServer(port);

    // McpServer 实例本身不需要在这里显式启动或连接，
    // 连接逻辑已移至 httpServer.ts 中的 SSE 端点处理部分。

  } catch (error) {
    logger.error(`[Main] Failed to start MCP server on port ${port}:`, error);
    process.exit(1); // 启动过程中发生致命错误，退出
  }
}

// 启动服务器
main();