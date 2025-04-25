import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from './config'; // 导入 logger

// 创建并导出 McpServer 实例
export const server = new McpServer({
  logger: logger,
  name: 'vscode-debugger-mcp',
  version: '1.1.0' // TODO: Consider moving to constants or package.json
});

logger.info(`[MCP Instance] McpServer instance created.`);