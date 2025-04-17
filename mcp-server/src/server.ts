// 导入路径根据 SDK README 示例调整
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// import { z } from "zod"; // Zod is not strictly needed for the simple helloWorld tool without schema validation
// import { RequestHandlerExtra } from "@modelcontextprotocol/sdk/server/types.js"; // Attempt to import if needed, otherwise use 'any'

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
    logger.info('Starting MCP server with SDK...');
    const transport = new StdioServerTransport(); // Create transport
    await server.connect(transport); // Connect transport to start listening
    console.log("Debug MCP Server Started"); // Output the startup signal to stdout
    logger.info('MCP server connected via stdio.'); // Keep this log on stderr
  } catch (error) {
    logger.error('Failed to connect MCP server:', error); // Updated error message
    process.exit(1);
  }
}

// 处理服务器关闭 (README doesn't explicitly show McpServer.stop, rely on transport closure or process exit)
// Keep basic signal handling to exit the process
const handleShutdown = (signal: string) => {
    logger.info(`Received ${signal}. Debug MCP Server Stopping...`);
    // transport.close() or server.disconnect() might be needed, but not shown in README
    // For now, just exit the process
    process.exit(0);
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