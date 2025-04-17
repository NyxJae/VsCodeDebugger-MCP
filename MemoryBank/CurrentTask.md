## 任务上下文

1. 服务器启动逻辑:
- mcp-server/src/server.ts (1-26行)
- src/mcpServerManager.ts (35-122行) - 插件端通过监听stdout输出"Debug MCP Server Started"判断服务器启动成功

2. SDK启动行为:
- Docs/Doc_MCP_example.md (639-644行) - SDK使用StdioTransport时会在启动后输出"Secure MCP Filesystem Server running on stdio"到stderr

3. JSON-RPC消息格式:
- Docs/Doc_MCP.md (257-295行)
- Docs/Doc_MCP_example.md (1-114行) - 使用@modelcontextprotocol/sdk实现MCP服务器

4. 基础请求处理框架:
- Docs/Doc_MCP.md (300-415行)
- Docs/Doc_MCP_example.md (165-175行) - Server初始化配置
- Docs/Doc_MCP_example.md (444-636行) - 请求处理实现

5. 工具处理框架:
- Docs/Doc_MCP.md (424-584行)
- Docs/Doc_MCP_example.md (336-442行) - 工具注册和描述

## 任务规划 (修正启动信号)

**目标:** 修正 `mcp-server/src/server.ts`，使其在基于 SDK 的服务器成功启动后，在 **stdout** 上输出插件端 (`src/mcpServerManager.ts`) 期望的 `"Debug MCP Server Started"` 消息，以解决插件卡在 "starting..." 状态的问题。

**核心问题:** 插件端监听 `stdout` 的 `"Debug MCP Server Started"` 信号，而当前基于 SDK 的服务器实现（根据示例）可能在 `stderr` 输出不同的启动信息，导致插件无法识别服务器已成功启动。

**修正方案:** 在 `mcp-server/src/server.ts` 的 `main` 函数中，紧随 `await server.start();` 成功执行之后，添加一行代码，通过 `console.log` 向 `stdout` 输出插件所需的启动信号。

**执行步骤:**

1.  **定位修改点:** 打开 `mcp-server/src/server.ts` 文件。
2.  **找到 `main` 函数:** 定位到包含 `await server.start();` 的 `main` 函数。
3.  **添加启动信号输出:** 在 `await server.start();` 这一行的**正下方**，添加以下代码：
    ```typescript
    console.log("Debug MCP Server Started");
    ```
    *   **重要:** 确保这行代码在 `try` 块内部，且在 `server.start()` 成功执行后才运行。

    修改后的 `main` 函数部分示例：
    ```typescript
    async function main() {
      try {
        // logger.info('Starting MCP server with SDK...'); // 可以保留或移除，确保不干扰 stdout
        await server.start();
        // logger.info('MCP server started and listening on stdio.'); // 建议将此日志输出到 stderr 或移除
        console.log("Debug MCP Server Started"); // <-- 添加此行，输出到 stdout
      } catch (error) {
        // logger.error('Failed to start MCP server:', error); // 建议将错误日志输出到 stderr
        console.error('Failed to start MCP server:', error); // 确保错误信息输出到 stderr
        process.exit(1);
      }
    }

    main();
    ```

**预期结果:**

*   当 `mcp-server` 成功启动后，它会在 `stdout` 上打印 `"Debug MCP Server Started"`。
*   插件端的 `mcpServerManager.ts` 能够捕获到这个信号，正确识别服务器已启动，并完成后续的初始化流程。
*   插件不再卡在 "starting..." 状态。

**注意事项:**

*   确保项目中其他地方（尤其是服务器端）的 `console.log` 不会意外输出到 `stdout`，干扰插件的启动信号判断。建议将常规日志和调试信息输出到 `stderr` (使用 `console.error`, `console.warn`, `console.debug` 或专门的日志库配置)。