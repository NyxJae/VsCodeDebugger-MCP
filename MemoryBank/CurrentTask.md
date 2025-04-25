# MCP Server 拆分计划

**任务:** 将 `mcp-server/src/server.ts` 文件拆分成更小、职责更单一的模块，以提高代码的可维护性、可读性和可测试性。

**原始文件:** `mcp-server/src/server.ts` (约 547 行)

**建议的模块拆分:**

1.  **`config.ts`**: 存放端口、日志记录器等配置项。
2.  **`mcpInstance.ts`**: 创建并导出 `McpServer` 实例。
3.  **`toolRegistry.ts`**: 负责所有工具的注册和适配器逻辑。
4.  **`httpServer.ts`**: 管理 Express 应用、SSE 连接、消息路由和 HTTP 服务器生命周期。
5.  **`processHandlers.ts`**: 处理进程信号（SIGINT, SIGTERM）、未捕获异常和 IPC 消息。
6.  **`server.ts` (重构后)**: 作为主入口点，导入并协调其他模块的启动。

**建议的目录结构:**

```
mcp-server/src/
├── config.ts           # 新增
├── mcpInstance.ts      # 新增
├── toolRegistry.ts     # 新增
├── httpServer.ts       # 新增
├── processHandlers.ts  # 新增
├── server.ts           # 修改 (主入口)
├── constants.ts        # (现有)
├── pluginCommunicator.ts # (现有)
├── types.ts            # (现有)
└── toolProviders/      # (现有)
    └── debug/          # (现有)
        └── ...
```

**模块依赖关系图 (Mermaid):**

```mermaid
graph TD
    subgraph "新模块"
        A[server.ts (主入口)]
        B(config.ts)
        C(mcpInstance.ts)
        D(toolRegistry.ts)
        E(httpServer.ts)
        F(processHandlers.ts)
    end

    subgraph "现有模块/目录"
        G[toolProviders/debug/*]
        H[pluginCommunicator.ts]
        I[constants.ts]
        J[types.ts]
    end

    A --> B
    A --> C
    A --> D
    A --> E
    A --> F

    C -- "导入配置" --> B
    D -- "导入 server 实例" --> C
    D -- "导入工具定义" --> G
    D -- "导入常量/类型" --> I
    D -- "导入常量/类型" --> J
    E -- "导入 server 实例" --> C
    E -- "导入 logger" --> B
    E -- "导入常量/类型" --> I
    E -- "导入常量/类型" --> J
    F -- "导入 logger" --> B
    F -- "导入 IPC 处理" --> H
    F -- "导入常量" --> I