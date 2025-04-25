## 任务上下文

### Bug 描述

MCP 服务器成功执行了工具（例如 set_breakpoint），但客户端未能收到最终结果响应。服务器日志显示警告：`[WARN] [MCP Server - set_breakpoint] No active transport or sessionId found in context for requestId ... after receiving IPC response. Cannot confirm target SSE session.`

### 通信流程分析

1.  客户端（VS Code 插件的 SSE 客户端，由 `src/managers/sseClientManager.ts` 管理）通过 SSE 向 MCP Server 发送工具执行请求。请求到达 MCP Server 的 `/messages` 端点 (`mcp-server/src/httpServer.ts`)。
2.  MCP Server 接收到 POST 请求，从请求中获取 `sessionId`，找到对应的 `SSEServerTransport` 实例（存储在 `transports` 对象中），并通过此 transport 将消息传递给 `McpServer` 实例 (`mcp-server/src/httpServer.ts` line 58-77)。
3.  `McpServer` 实例（在 `mcp-server/src/mcpInstance.ts` 中创建）根据消息内容路由到相应的工具处理逻辑（在 `mcp-server/src/toolRegistry.ts` 中注册）。
4.  工具处理逻辑（例如 `setBreakpointTool.execute` 在 `mcp-server/src/toolProviders/debug/setBreakpoint.ts` 中）需要与 VS Code 交互，因此通过 IPC 向插件发送请求（使用 `mcp-server/src/pluginCommunicator.ts` 的 `sendRequestToPlugin`）。
5.  插件主进程（由 `src/extension.ts` 激活，`src/mcpServerManager.ts` 协调，`src/managers/ipcHandler.ts` 处理 IPC 消息）接收到 IPC 请求，调用 `src/vscode/debuggerApiWrapper.ts` 中的相应方法执行 VS Code 调试 API 操作。
6.  插件通过 IPC 将操作结果响应给 MCP Server 子进程（`src/managers/ipcHandler.ts` 的 `sendResponseToServer` 通过 `ProcessManager` 发送）。
7.  MCP Server 子进程接收到 IPC 响应（`mcp-server/src/pluginCommunicator.ts` 的 `handlePluginResponse`）。此时，MCP Server 需要将最终的工具执行结果通过原始的 SSE 连接发送回客户端。

### MCP SDK Protocol 定义 (`mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.d.ts`)

根据 SDK 定义，`Protocol.setRequestHandler` 方法的 `handler` 回调函数签名如下：

```typescript
setRequestHandler<T extends ZodObject<{
    method: ZodLiteral<string>;
}>>(requestSchema: T, handler: (request: z.infer<T>, extra: RequestHandlerExtra) => SendResultT | Promise<SendResultT>): void;
```

其中，`extra` 参数的类型为 `RequestHandlerExtra`，其定义如下：

```typescript
export type RequestHandlerExtra = {
    /**
     * An abort signal used to communicate if the request was cancelled from the sender's side.
     */
    signal: AbortSignal;
    /**
     * The session ID from the transport, if available.
     */
    sessionId?: string;
};
```

这表明 MCP SDK 在调用注册的工具处理函数时，会通过 `extra` 参数传递包含 `sessionId` 的上下文信息。

### 项目中工具注册与执行 (`mcp-server/src/toolRegistry.ts`)

在 `mcp-server/src/toolRegistry.ts` 文件中，工具通过 `server.tool()` 方法注册。注册时提供的回调函数签名与 SDK 定义一致，接收 `args` 和 `extra` 参数：

```typescript
server.tool(
    DebugTools.setBreakpointTool.name,
    DebugTools.setBreakpointTool.inputSchema.shape,
    async (args, extra) => { // extra 参数在这里接收
        // ...
        const result = await DebugTools.setBreakpointTool.execute(args); // **问题所在：调用 execute 时没有传递 extra (context) 参数**
        // ...
    }
);
```

然而，在回调函数内部调用具体工具（如 `DebugTools.setBreakpointTool.execute`）时，只传递了 `args` 参数，而忽略了 `extra` 参数。

### MCP Server 端工具实现 (`mcp-server/src/toolProviders/debug/`)

通过对 `mcp-server/src/toolProviders/debug/` 目录下 `.ts` 文件的搜索，确认了工具的 `execute` 方法签名（例如 `setBreakpoint.ts` 中的 `setBreakpointTool.execute`）目前没有包含 `extra` 参数。这意味着即使在 `toolRegistry.ts` 中传递了 `extra`，工具的 `execute` 方法也无法接收和使用它。

### 插件端 IPC 处理 (`src/managers/ipcHandler.ts`, `src/mcpServerManager.ts`)

插件端通过 `src/managers/ipcHandler.ts` 的 `handleIncomingMessage` 方法处理来自 MCP Server 的 IPC 请求，并将调试相关请求委托给 `src/vscode/debuggerApiWrapper.ts`。`src/mcpServerManager.ts` 中的 `handleRequestFromMCP` 方法也执行类似逻辑。虽然在处理 `continue_debugging` 和 `step_execution` 等命令时，插件端会尝试从 IPC 请求的 `payload` 中获取 `sessionId`（如果未提供则使用当前活动会话的 ID），但这仅用于插件端内部调用 VS Code Debug API 时识别会话。

### 根本原因总结

问题的根本原因在于 MCP Server 在 `mcp-server/src/toolRegistry.ts` 中调用具体工具的 `execute` 方法时，没有将包含原始客户端 `sessionId` 的 `extra` 参数传递进去。这导致工具执行完成后，无法获取正确的 `sessionId` 来通过对应的 `SSEServerTransport` 将最终结果推送回客户端，从而出现客户端收不到响应的 Bug。虽然插件端在处理 IPC 请求时可能获取或使用 `sessionId`，但这并不能弥补 MCP Server 端在发送最终结果时对 `sessionId` 的依赖缺失。

## 任务规划

**目标:** 修复 MCP 服务器在工具执行后无法将响应发送回客户端的 Bug。

**根本原因分析:**
根据 MCP SDK (`@modelcontextprotocol/sdk`) 的 `protocol.d.ts` 定义，`server.tool()` 注册的回调函数会接收一个 `extra` 参数，类型为 `RequestHandlerExtra`，其中包含 `sessionId`。然而，在 `mcp-server/src/toolRegistry.ts` 中，调用具体工具（如 `DebugTools.setBreakpointTool.execute`）时，并未将此 `extra` 参数传递下去。这导致工具执行完成后，MCP Server 内部无法获取到原始请求的 `sessionId`，进而无法找到正确的 SSE 连接（`SSEServerTransport`）将结果发送回对应的客户端。

**解决方案:**
核心思路是确保在整个工具调用链中传递包含 `sessionId` 的上下文信息 (`extra` 参数)。
1.  修改 `mcp-server/src/toolRegistry.ts`，在所有 `server.tool()` 回调函数中，调用具体工具的 `execute` 方法时，将接收到的 `extra` 参数传递给 `execute`。
2.  修改 `mcp-server/src/toolProviders/debug/` 目录下所有工具的 `execute` 方法签名，使其能够接收 `extra: RequestHandlerExtra` 参数。
3.  (虽然当前 Bug 的直接原因是在 `toolRegistry.ts` 中丢失了上下文，但为了代码健壮性和未来扩展) 确保工具内部在需要与插件进行 IPC 通信并等待响应后，能够访问到这个 `extra` 参数，以便在收到 IPC 响应时，能将 `sessionId` 与响应关联起来，最终通过正确的 SSE 连接返回给客户端。*（注：MCP SDK 的 `server.tool` 内部机制应该处理了响应的发送，只要 `execute` 能正确返回结果即可，但确保 `extra` 能被工具内部访问是良好的实践。）*

**受影响文件:**
*   `mcp-server/src/toolRegistry.ts`
*   `mcp-server/src/toolProviders/debug/*.ts` (所有调试工具实现文件)
*   `mcp-server/src/types.ts` (可能需要导入 `RequestHandlerExtra` 类型，或确保其已导出/可用)

**详细步骤:**

1.  **修改 `mcp-server/src/toolRegistry.ts`:**
    *   **导入类型:** 确保 `RequestHandlerExtra` 类型已从 `@modelcontextprotocol/sdk` 导入或在项目中可用。
        ```typescript
        // 在文件顶部添加或确认存在
        import { RequestHandlerExtra } from '@modelcontextprotocol/sdk'; // 或从项目类型定义导入
        ```
    *   **遍历所有 `server.tool(...)` 注册:** 对每个工具（`getConfigurationsTool`, `setBreakpointTool`, `removeBreakpointTool`, `getBreakpointsTool`, `startDebuggingTool`, `continueDebuggingTool`, `stepExecutionTool`, `stopDebuggingTool` 等）的注册回调进行修改。
    *   **传递 `extra` 参数:** 在回调函数 `async (args, extra: RequestHandlerExtra) => { ... }` 内部，找到调用 `DebugTools.<ToolName>.execute(args)` 的地方，修改为 `DebugTools.<ToolName>.execute(args, extra)`。
        *   **示例 (setBreakpointTool):**
            ```diff
            --- a/mcp-server/src/toolRegistry.ts
            +++ b/mcp-server/src/toolRegistry.ts
            @@ -XX,7 +XX,7 @@
             server.tool(
                 DebugTools.setBreakpointTool.name,
                 DebugTools.setBreakpointTool.inputSchema.shape,
            -    async (args) => { // 修改前的签名可能没有显式写 extra
            +    async (args, extra: RequestHandlerExtra) => { // 显式添加 extra 类型
                     const toolName = DebugTools.setBreakpointTool.name;
                     logger.info(`[MCP Server Adapter] Executing tool: ${toolName} with args:`, args);
                     try {
            -            const result = await DebugTools.setBreakpointTool.execute(args);
            +            const result = await DebugTools.setBreakpointTool.execute(args, extra); // 传递 extra
                         logger.info(`[MCP Server Adapter] Tool ${toolName} execution result status: ${result.status}`);
                         // ... 后续处理 result ...
                         // SDK 会自动处理结果发送，无需在此处手动发送
            ```
        *   **对所有其他工具重复此修改。** 确保回调函数的签名包含 `extra: RequestHandlerExtra`。

2.  **修改 MCP Server 端工具的 `execute` 方法签名:**
    *   **遍历 `mcp-server/src/toolProviders/debug/` 目录下的所有 `.ts` 文件。**
    *   **导入类型:** 在每个工具文件中，确保 `RequestHandlerExtra` 类型已导入。
        ```typescript
        // 在文件顶部添加或确认存在
        import { RequestHandlerExtra } from '@modelcontextprotocol/sdk'; // 或从项目类型定义导入
        import * as zod from 'zod'; // 确保 zod 也已导入
        // ... 其他导入 ...
        ```
    *   **修改 `execute` 方法签名:** 将每个工具 `execute` 方法的签名修改为接收第二个可选参数 `extra?: RequestHandlerExtra`。设为可选是因为直接调用 `execute` 的场景（例如单元测试）可能不提供 `extra`。
        *   **示例 (setBreakpoint.ts):**
            ```diff
            --- a/mcp-server/src/toolProviders/debug/setBreakpoint.ts
            +++ b/mcp-server/src/toolProviders/debug/setBreakpoint.ts
            @@ -1,5 +1,6 @@
             import * as zod from 'zod';
             import { logger } from '../../logger'; // 假设 logger 在这里导入
            +import { RequestHandlerExtra } from '@modelcontextprotocol/sdk'; // 导入类型
             import { pluginCommunicator } from '../../pluginCommunicator';
             import { Constants } from '../../constants';
             import { getAbsoluteFilePath } from '../../utils/pathUtils'; // 假设路径工具导入
            @@ -44,8 +45,8 @@
                  outputSchema: SetBreakpointOutputSchema,

                  async execute(
            -        args: SetBreakpointArgs
            -    ): Promise<z.infer<typeof SetBreakpointOutputSchema>> {
            +        args: SetBreakpointArgs,
            +        extra?: RequestHandlerExtra // 添加可选的 extra 参数
            +    ): Promise<z.infer<typeof SetBreakpointOutputSchema>> {
                      const toolName = this.name;
                      logger.info(`[MCP Tool - ${toolName}] Executing with args:`, args);
                      // 现在可以在函数内部安全地访问 extra?.sessionId 等信息 (如果需要)
            ```
        *   **对所有其他工具文件 (`continueDebugging.ts`, `getBreakpoints.ts`, `getConfigurations.ts`, `removeBreakpoint.ts`, `startDebugging.ts`, `stepExecution.ts`, `stopDebugging.ts`) 重复此签名修改。**

3.  **验证修复:**
    *   **编译:** 运行 `npm run build` 或类似命令编译 MCP Server 和插件。
    *   **启动:** 启动 VS Code 插件（会自动启动 MCP Server）。
    *   **客户端连接:** 使用 Cline 或其他 MCP 客户端连接到服务器。
    *   **测试核心工具:**
        *   调用 `set_breakpoint`。确认客户端收到成功响应，并且服务器日志无 `No active transport or sessionId found` 警告。
        *   调用 `get_breakpoints`。确认客户端收到断点列表。
        *   调用 `remove_breakpoint`。确认客户端收到成功响应。
    *   **测试异步工具 (关键):**
        *   调用 `start_debugging` (选择一个 launch.json 配置)。确认客户端收到 `stopped` 或 `completed` 状态，并且包含 `stop_event_data` (如果适用)。
        *   如果 `start_debugging` 返回 `stopped`，接着调用 `continue_debugging`。确认客户端收到后续的 `stopped` 或 `completed` 状态。
        *   如果 `start_debugging` 返回 `stopped`，接着调用 `step_execution` (例如 `over`)。确认客户端收到 `stopped` 状态。
        *   调用 `stop_debugging`。确认客户端收到成功响应。
    *   **检查日志:** 仔细检查 MCP Server 和插件两端的日志，确保没有与上下文传递或 SSE 响应发送相关的错误或警告。

**(可选) 文档更新:**
*   如果认为有必要，可以给文档编写者 (`docer`) 发送一个新任务，更新 `Docs/Doc_Debug_Tools.md` 或相关开发文档，说明工具 `execute` 方法现在接收 `extra` 参数，并简要解释其目的（传递上下文，特别是 `sessionId`）。
    ```xml
    <new_task>
    <mode>docer</mode>
    <message>请更新 @/Docs/Doc_Debug_Tools.md 文档。在描述调试工具的实现细节时，请说明所有工具的 `execute` 方法现在接收一个可选的第二个参数 `extra`，其类型为 `@modelcontextprotocol/sdk` 中的 `RequestHandlerExtra`。这个参数用于传递来自 MCP 请求的上下文信息，例如 `sessionId`，以确保响应能正确返回给客户端。请在相关章节或工具说明中补充这一点。</message>
    </new_task>
    ```