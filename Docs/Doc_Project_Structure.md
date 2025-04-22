# 项目结构文档

本文档旨在描述重构后的项目结构，帮助开发人员快速理解项目的主要组成部分和模块职责。

## 1. 项目主要目录结构

项目主要分为两个部分：

-   `src/`: VS Code 插件端代码。
-   `mcp-server/src/`: MCP 服务器端代码。

```
.
├── Docs/
│   └── Doc_Project_Structure.md  <- 本文档
├── MemoryBank/
│   ├── CurrentTask.md
│   └── ProjectBrief.md
├── mcp-server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── constants.ts
│       ├── pluginCommunicator.ts
│       ├── server.ts
│       └── toolProviders/
│           └── debug/
│               ├── getBreakpoints.ts
│               ├── getConfigurations.ts
│               ├── index.ts
│               └── setBreakpoint.ts
├── package.json
├── tsconfig.json
└── src/
    ├── constants.ts
    ├── extension.ts
    ├── mcpServerManager.ts
    ├── types.ts
    ├── managers/
    │   ├── IpcHandler.ts
    │   └── ProcessManager.ts
    └── vscode/
        └── DebuggerApiWrapper.ts
```

## 2. 关键子目录用途

-   `src/managers/`: 存放插件端的管理器类，负责处理特定的功能领域，如进程管理、IPC 通信等。这些类通常由 `McpServerManager` 协调。
-   `src/vscode/`: 存放与 VS Code API 直接交互的封装，提供对 VS Code 功能的抽象层，例如调试 API 的封装。
-   `mcp-server/src/toolProviders/debug/`: 存放 MCP 服务器的调试工具实现。每个文件通常对应一个具体的调试工具，如获取配置、设置/获取断点等。`index.ts` 文件负责导出这些工具。

## 3. 核心模块/类职责

以下是项目中的一些核心模块和类的职责说明：

### VS Code 插件端 (`src/`)

-   `src/extension.ts`:
    -   插件的入口文件，负责插件的激活 (`activate`) 和去激活 (`deactivate`)。
    -   在激活时，创建 `ProcessManager`, `IpcHandler`, `StatusBarManager`, `DebuggerApiWrapper` 等实例。
    -   创建 `McpServerManager` 实例，并将其他管理器通过依赖注入的方式传递给它。
    -   注册 VS Code 命令和事件监听器。
-   `src/mcpServerManager.ts`:
    -   插件端的核心协调器。
    -   管理 MCP 服务器的生命周期（启动、停止、重启）。
    -   协调 `ProcessManager`, `IpcHandler`, `StatusBarManager` 等管理器之间的交互。
    -   监听 `ProcessManager` 的进程事件（如启动、停止、输出），并根据事件更新状态或通知其他模块。
    -   处理来自 MCP 服务器的 IPC 请求，并将其转发给相应的管理器（如 `DebuggerApiWrapper`）。
-   `src/managers/ProcessManager.ts`:
    -   负责管理 MCP 服务器子进程的生命周期。
    -   处理子进程的启动、停止和重启逻辑。
    -   监听子进程的 `stdout`, `stderr` 输出，并将其转发到 VS Code 的 Output Channel。
    -   通过事件机制通知 `McpServerManager` 进程状态的变化。
    -   处理端口占用检测和用户手动指定端口的逻辑。
-   `src/managers/IpcHandler.ts`:
    -   负责处理插件与 MCP 服务器之间的 IPC 通信。
    -   建立和维护与服务器的 IPC 连接。
    -   接收服务器发送的 IPC 消息。
    -   将接收到的 IPC 请求转发给 `McpServerManager` 进行处理。
    -   发送插件端对服务器的请求。
-   `src/managers/StatusBarManager.ts`:
    -   负责管理 VS Code 状态栏的显示。
    -   根据 MCP 服务器的状态（启动中、运行中、停止）更新状态栏的文本和图标。
    -   处理状态栏项的点击事件，可能弹出设置面板。
-   `src/configManager.ts`:
    -   负责管理插件的配置项，如 MCP 服务器的端口号和是否自动启动。
    -   读取和写入持久化的用户配置。
    -   提供获取和更新配置的方法。
-   `src/vscode/DebuggerApiWrapper.ts`:
    -   封装了 VS Code Debug API 的调用。
    -   提供设置断点 (`setBreakpoint`)、获取所有断点 (`getBreakpoints`) 等功能的抽象接口。
    -   处理与 VS Code 调试会话的交互细节，例如断点的验证和管理。
-   `src/constants.ts`:
    -   存放插件端使用的常量，例如命令 ID、状态栏文本等。
-   `src/types.ts`:
    -   存放插件端使用的 TypeScript 类型定义和接口，例如 IPC 消息的结构。

### MCP 服务器端 (`mcp-server/src/`)

-   `mcp-server/src/server.ts`:
    -   MCP 服务器的入口文件。
    -   使用 `@modelcontextprotocol/sdk` 启动标准的 MCP 服务器。
    -   注册 MCP 工具提供者，特别是调试工具组。
    -   处理客户端（如 AI 代理）通过 HTTP/SSE 发送的 MCP 请求。
    -   协调工具的执行。
-   `mcp-server/src/toolProviders/debug/index.ts`:
    -   调试工具组的聚合文件。
    -   导入 `getConfigurations`, `setBreakpoint`, `getBreakpoints` 等具体的调试工具实现。
    -   将这些工具作为 MCP 工具提供者导出，供 `server.ts` 注册。
-   `mcp-server/src/toolProviders/debug/getConfigurations.ts`:
    -   实现 `get_debugger_configurations` MCP 工具。
    -   负责读取当前 VS Code 工作区下的 `.vscode/launch.json` 文件。
    -   解析 `launch.json` 内容，并返回调试配置列表给客户端。
-   `mcp-server/src/toolProviders/debug/setBreakpoint.ts`:
    -   实现 `set_breakpoint` MCP 工具。
    -   接收客户端提供的文件路径、行号等信息。
    -   通过 `pluginCommunicator` 调用插件端的 `vscode-debugger-mcp:setBreakpoint` 命令，在 VS Code 中设置断点。
    -   返回设置断点的结果（包括断点 ID 和验证状态）。
-   `mcp-server/src/toolProviders/debug/getBreakpoints.ts`:
    -   实现 `get_breakpoints` MCP 工具。
    -   通过 `pluginCommunicator` 调用插件端的 `vscode-debugger-mcp:getBreakpoints` 命令，获取 VS Code 中当前所有已设置的断点。
    -   返回断点列表给客户端。
-   `mcp-server/src/pluginCommunicator.ts`:
    -   负责 MCP 服务器与 VS Code 插件之间的通信。
    -   用于服务器端调用插件端提供的功能（通过 IPC）。
    -   例如，调用插件端的命令来与 VS Code Debug API 交互。
-   `mcp-server/src/constants.ts`:
    -   存放 MCP 服务器端使用的常量，如端口号、IPC 命令名称等。

本文档简要概述了项目的结构和核心模块。更详细的信息请参考具体的源代码文件。