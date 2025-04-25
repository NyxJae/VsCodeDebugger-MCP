# 通用文档
记录每次完成任务后的收获与经验

## 项目代码文件概览
以下是本项目中主要代码文件的作用和简要说明：

### VS Code 插件端 (`src/`)

-   `src/extension.ts`:
    -   **作用:** 插件的入口文件，负责插件的激活 (`activate`) 和去激活 (`deactivate`)。
    -   **主要功能:** 在激活时，创建并协调各个管理器 (`ProcessManager`, `IpcHandler`, `StatusBarManager`, `DebuggerApiWrapper`, `ConfigManager`)。注册 VS Code 命令和事件监听器。
-   `src/mcpServerManager.ts`:
    -   **作用:** 插件端的核心协调器。
    -   **主要功能:** 管理 MCP 服务器的生命周期，协调各个管理器之间的交互，处理来自 MCP 服务器的 IPC 请求。
-   `src/managers/ProcessManager.ts`:
    -   **作用:** 负责管理 MCP 服务器子进程的生命周期。
    -   **主要功能:** 处理子进程的启动、停止、重启，监听子进程输出，处理端口占用检测和用户手动指定端口。
-   `src/managers/IpcHandler.ts`:
    -   **作用:** 负责处理插件与 MCP 服务器之间的 IPC 通信。
    -   **主要功能:** 建立和维护 IPC 连接，接收服务器消息，转发 IPC 请求。
-   `src/managers/StatusBarManager.ts`:
    -   **作用:** 管理 VS Code 状态栏的显示。
    -   **主要功能:** 根据服务器状态更新状态栏文本和图标，处理状态栏项点击事件。
-   `src/configManager.ts`:
    -   **作用:** 管理插件的配置项。
    -   **主要功能:** 读取和写入持久化的用户配置（如端口号、自动启动设置）。
-   `src/vscode/DebuggerApiWrapper.ts`:
    -   **作用:** 封装 VS Code Debug API 的调用。
    -   **主要功能:** 提供设置断点、获取断点等功能的抽象接口。
-   `src/constants.ts`:
    -   **作用:** 存放插件端使用的常量。
-   `src/types.ts`:
    -   **作用:** 存放插件端使用的 TypeScript 类型定义和接口。

### MCP 服务器端 (`mcp-server/src/`)

-   `mcp-server/src/server.ts`:
    -   **作用:** MCP 服务器的入口文件。
    -   **主要功能:** 启动 MCP 服务器，注册 MCP 工具提供者，处理客户端请求。
-   `mcp-server/src/toolProviders/debug/index.ts`:
    -   **作用:** 调试工具组的聚合文件。
    -   **主要功能:** 导入并导出所有具体的调试工具实现。
-   `mcp-server/src/toolProviders/debug/getConfigurations.ts`:
    -   **作用:** 实现获取调试配置的 MCP 工具。
    -   **主要功能:** 读取 `.vscode/launch.json` 文件并返回配置列表。
-   `mcp-server/src/toolProviders/debug/setBreakpoint.ts`:
    -   **作用:** 实现设置断点的 MCP 工具。
    -   **主要功能:** 通过 `pluginCommunicator` 调用插件端命令设置断点。
-   `mcp-server/src/toolProviders/debug/getBreakpoints.ts`:
    -   **作用:** 实现获取所有断点的 MCP 工具。
    -   **主要功能:** 通过 `pluginCommunicator` 调用插件端命令获取断点列表。
-   `mcp-server/src/pluginCommunicator.ts`:
    -   **作用:** 负责 MCP 服务器与 VS Code 插件之间的通信。
    -   **主要功能:** 用于服务器端通过 IPC 调用插件端提供的功能。
-   `mcp-server/src/constants.ts`:
    -   **作用:** 存放 MCP 服务器端使用的常量。

## 项目整体框架
本项目主要包含两个部分：

1.  **VS Code 插件 (`src` 目录):**
    -   负责在 VS Code 环境中运行和管理 MCP 服务器。
    -   提供用户界面交互，如状态栏显示和操作菜单。
    -   通过 `child_process` 模块启动和停止 MCP 服务器进程。
    -   通过 IPC 与 MCP 服务器进行双向通信，接收服务器事件并发送指令。
    -   利用 VS Code Debug API 执行调试操作。
    -   管理插件配置。

2.  **MCP 服务器 (`mcp-server` 目录):**
    -   一个独立的 Node.js 应用程序，实现了 Model Context Protocol 服务器。
    -   使用 `@modelcontextprotocol/sdk` 处理 MCP 协议的通信和工具注册。
    -   通过 stdio 与 AI 客户端进行通信。
    -   通过 IPC 与 VS Code 插件进行双向通信，发送调试事件并接收插件端执行结果。
    -   实现 VsCode Debugger 工具组定义的各种调试工具。

这两个部分通过进程间通信 (IPC) 协同工作。插件启动服务器子进程，并通过 IPC 通道进行双向通信。AI 客户端通过 stdio 与服务器通信，服务器再通过 IPC 与插件通信，插件最终通过 VS Code Debug API 与实际的调试器交互。

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
## Zod Schema 结构与 `.shape` 的使用说明

在 `mcp-server/src/toolProviders/debug/removeBreakpoint.ts` 中，我们为 `remove_breakpoint` 工具的输入参数定义了 Zod Schema。为了同时满足参数结构定义和复杂的校验逻辑（三选一），我们采用了两步结构：

1.  **基础 Schema (`BaseRemoveBreakpointInputSchema`):** 定义了所有可能的输入字段及其基本类型。
    ```typescript
    // mcp-server/src/toolProviders/debug/removeBreakpoint.ts
    export const BaseRemoveBreakpointInputSchema = z.object({
      breakpoint_id: z.number().int().positive().optional().describe('要移除的断点的唯一 ID。'),
      location: LocationSchema.optional().describe('指定要移除断点的位置。'),
      clear_all: z.boolean().optional().describe('如果设置为 true，则尝试移除所有断点。'),
    });
    ```

2.  **精炼 Schema (`RemoveBreakpointInputSchema`):** 在基础 Schema 上应用 `.refine()` 方法，添加了“三选一”的自定义校验逻辑。
    ```typescript
    // mcp-server/src/toolProviders/debug/removeBreakpoint.ts
    export const RemoveBreakpointInputSchema = BaseRemoveBreakpointInputSchema.refine(
      (data) => {
        const providedParams = [data.breakpoint_id, data.location, data.clear_all].filter(
          (param) => param !== undefined
        );
        return providedParams.length === 1;
      },
      {
        message: '必须且只能提供 breakpoint_id、location 或 clear_all 中的一个参数。',
      }
    );
    ```

**为何需要这种结构以及 `.shape` 的作用？**

在 `mcp-server/src/server.ts` 中注册 MCP 工具时，`@modelcontextprotocol/sdk` 的 `server.tool()` 方法需要知道工具输入参数的“形状”（即字段名和类型），以便进行基本的结构校验和生成文档。Zod Schema 通过 `.shape` 属性暴露了这个结构信息。

然而，当我们在 Schema 上使用 `.refine()`、`.transform()` 等方法时，返回的是一个 `ZodEffects` 对象，它封装了原始 Schema 和附加逻辑，但**不再直接暴露原始的 `.shape` 属性**。

因此，如果直接将带有 `.refine()` 的 `RemoveBreakpointInputSchema` 传递给 `server.tool()`，SDK 将无法获取参数的形状信息。

**解决方案：**

通过先定义一个不包含 `.refine()` 的 `BaseRemoveBreakpointInputSchema`，我们可以在注册工具时访问其 `.shape` 属性，将参数结构信息提供给 SDK：

```typescript
// mcp-server/src/server.ts
server.tool(
    Constants.TOOL_REMOVE_BREAKPOINT,
    DebugTools.BaseRemoveBreakpointInputSchema.shape, // 使用基础 Schema 的 .shape
    DebugTools.handleRemoveBreakpoint
);
```

而在工具的实际处理函数 `handleRemoveBreakpoint` 内部，我们使用带有 `.refine()` 校验逻辑的 `RemoveBreakpointInputSchema` 来解析和验证传入的参数，确保满足“三选一”的业务规则。

这种分离基础结构定义和复杂校验逻辑的方式，使得我们既能满足 SDK 对参数形状的要求，又能实现自定义的校验规则。