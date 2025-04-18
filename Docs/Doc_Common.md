# 通用文档
记录每次完成任务后的收获与经验

## 项目代码文件概览
以下是本项目中主要代码文件的作用和简要说明：

### `src/extension.ts`
- **作用:** VS Code 插件的入口文件，负责插件的生命周期管理（激活和停用）。
- **主要功能:**
    - 实例化 `StatusBarManager` 和 `McpServerManager`。
    - 注册状态栏项点击命令，用于显示服务器操作菜单。
    - 注册复制 MCP 配置命令。
    - 将 manager 实例和命令添加到订阅中，以便在插件停用时自动清理资源。

### `src/mcpServerManager.ts`
- **作用:** 管理 MCP 服务器子进程的启动、停止和状态。
- **主要功能:**
    - 使用 `child_process` 模块启动和停止 MCP 服务器进程。
    - 监听服务器进程的 `stdout` 和 `stderr`，捕获启动信息（如监听 URL）和错误。
    - 根据服务器进程的状态更新 `StatusBarManager`。
    - 提供复制 MCP 客户端配置到剪贴板的功能。
    - 实现 `vscode.Disposable` 接口，确保在插件停用时停止服务器并清理资源。

### `src/statusBarManager.ts`
- **作用:** 管理 VS Code 状态栏中 MCP 服务器状态的显示和交互。
- **主要功能:**
    - 创建和更新状态栏项的文本、图标和提示信息，反映服务器的当前状态（停止、运行、启动中、错误）。
    - 在服务器运行时显示监听端口号。
    - 注册状态栏项的点击命令，触发显示服务器操作菜单。
    - 更新 VS Code 的上下文键，以便根据服务器状态控制其他 UI 元素的可见性。
    - 实现 `vscode.Disposable` 接口，释放状态栏项资源。

### `mcp-server/src/server.ts`
- **作用:** MCP 服务器的入口文件，使用 `@modelcontextprotocol/sdk` 实现 MCP 服务器功能。
- **主要功能:**
    - 使用 `express` 框架创建 HTTP 服务器。
    - 配置 `/sse` 端点用于建立 SSE 连接。
    - 配置 `/messages` 端点用于接收客户端 POST 消息。
    - 使用 `SSEServerTransport` 处理 SSE 通信。
    - 注册 MCP 工具（目前包含一个 `helloWorld` 工具）。
    - 监听指定端口，并在成功监听后通过 `stdout` 输出监听地址。
    - 处理进程信号（SIGINT, SIGTERM），实现优雅关闭 HTTP 服务器。
    - 实现动态端口分配，如果默认端口被占用，尝试使用随机端口。

## 项目整体框架
本项目主要包含两个部分：

1.  **VS Code 插件 (`src` 目录):**
    -   负责在 VS Code 环境中运行和管理 MCP 服务器。
    -   提供用户界面交互，如状态栏显示和操作菜单。
    -   通过 `child_process` 模块启动和停止 MCP 服务器进程。
    -   监听服务器的输出，捕获关键信息（如监听地址）并更新状态。
    -   提供复制客户端配置的功能。

2.  **MCP 服务器 (`mcp-server` 目录):**
    -   一个独立的 Node.js 应用程序，实现了 Model Context Protocol 服务器。
    -   使用 `@modelcontextprotocol/sdk` 处理 MCP 协议的通信和工具注册。
    -   通过 HTTP + Server-Sent Events (SSE) 与客户端进行通信。
    -   监听一个指定的端口，并处理来自客户端的请求（如工具调用）。
    -   目前包含一个    简单的 `helloWorld` 工具实现。

这两个部分通过进程间通信（插件通过启动子进程并监听其标准输出来获取服务器信息）和网络通信（客户端和插件通过 HTTP/SSE 与服务器交互）协同工作。

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