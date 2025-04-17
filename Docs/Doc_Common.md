# 通用文档
记录每次完成任务后的收获与经验
## xxx

## @modelcontextprotocol/sdk 集成经验：解决 TypeScript 编译错误

### 背景
在 `mcp-server` 项目中，尝试使用 `@modelcontextprotocol/sdk` 重构 `server.ts`。

### 遇到的问题
按照初步规划编写代码后，虽然 SDK 已安装，但在编译时遇到了 TypeScript 错误：
- `Cannot find module '@modelcontextprotocol/sdk'`
- `No matching overload for method 'tool'`

### 排查过程
1. 确认了 SDK 包存在于 `mcp-server/node_modules/@modelcontextprotocol/sdk`
2. 检查了 `mcp-server/tsconfig.json`，未发现明显配置问题
3. 查阅了 SDK 包内的 `README.md` 文件

### 关键发现 (与 README 的差异)
1. **导入路径**：SDK 的 README 示例明确使用了子模块路径并带有 `.js` 扩展名：
   ```typescript
   import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
   ```
   而不是顶层导入

2. **API 使用**：README 中的 API 调用方式与最初尝试的代码有所不同：
   - `new McpServer()`
   - `server.connect()`
   - `server.tool()` 的 handler 函数签名要求接收 `args` 和 `extra` 两个参数

### 解决方法
根据 README 的示例，修改了 `server.ts` 中的：
1. 导入语句
2. API 调用方式
3. 特别是调整了传递给 `server.tool()` 的 handler 函数签名

### 结论/建议
集成 `@modelcontextprotocol/sdk` 时，务必：
1. 仔细参考其官方 `README.md` 文件中的示例代码
2. 特别注意模块导入路径和核心 API 的使用方式
3. 关注函数签名要求，如 `McpServer`, `StdioServerTransport`, `server.tool`, `server.connect` 等

### SDK 文档参考
完整 SDK 文档已添加到项目文档目录中，包含以下主要内容：
- 概述与安装
- 核心概念（Server、Resources、Tools、Prompts）
- 运行服务器（stdio、HTTP with SSE）
- 示例代码（Echo Server、SQLite Explorer）
- 高级用法（Low-Level Server、Writing MCP Clients）

## MCP服务器启动信号与插件端识别

### 问题背景
VS Code插件端（例如`src/mcpServerManager.ts`）通常通过监听子进程（MCP服务器）的`stdout`来判断服务器是否成功启动。

### 标准信号
插件端期望在`stdout`上接收到特定的字符串信号，例如`"Debug MCP Server Started"`，来确认服务器已就绪。

### SDK服务器实现问题
当使用`@modelcontextprotocol/sdk`实现MCP服务器时，默认的启动日志（如`"Secure MCP Filesystem Server running on stdio"`）可能：
- 输出到`stderr`
- 不包含插件期望的信号

### 解决方案
在服务器端的启动逻辑中（例如`mcp-server/src/server.ts`的`main`函数）：
1. 在`await server.connect(transport);`或类似启动方法成功执行后
2. 显式使用`console.log("Debug MCP Server Started");`向`stdout`输出约定的启动信号

### 日志分离建议
- 将其他日志信息（调试信息`logger.info`、错误信息`logger.error`等）配置为输出到`stderr`
- 可通过`console.error`或专门的日志库配置
- 避免干扰`stdout`上的启动信号