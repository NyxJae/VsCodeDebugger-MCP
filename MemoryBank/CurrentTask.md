## 任务上下文
- mcp-server/src/toolProviders/debuggerTools.ts:108 - `setBreakpointSchema` 定义了 `file_path` 参数。
- mcp-server/src/toolProviders/debuggerTools.ts:129-141 - `handleSetBreakpoint` 函数接收 `file_path` 参数，并直接将其作为 payload 发送给插件，没有进行路径解析。
- src/mcpServerManager.ts:133-166 - 插件端接收到 `setBreakpoint` 请求，从 payload 中提取 `filePath`，并直接使用 `vscode.Uri.file(filePath)` 创建 URI。如果 `filePath` 是相对路径，`vscode.Uri.file` 可能会相对于插件的安装目录解析，而不是工作区根目录。
- src/mcpServerManager.ts:103-116 - 插件端获取 VS Code 工作区根目录路径 (`workspaceFolders[0].uri.fsPath`) 并将其作为 `VSCODE_WORKSPACE_PATH` 环境变量传递给 MCP 服务器子进程。
6 | - mcp-server/src/toolProviders/debuggerTools.ts:40 - MCP 服务器端通过 `process.env.VSCODE_WORKSPACE_PATH` 获取工作区路径，但目前仅在 `handleGetDebuggerConfigurations` 中使用，未在 `handleSetBreakpoint` 中用于解析 `file_path`。
7 |
8 | ## 任务规划
9 |
10| **目标:** 修复 `set_breakpoint` 工具处理相对文件路径的问题，确保其能正确解析相对于 VS Code 工作区的路径。
11|
12| **执行步骤:**
13|
14| 1.  **修改 `mcp-server/src/toolProviders/debuggerTools.ts` 文件中的 `handleSetBreakpoint` 函数:**
15|     *   **引入 `path` 模块:** 确认文件顶部已引入 `import * as path from 'path';`。
16|     *   **获取工作区路径:** 在函数开头，读取环境变量 `process.env.VSCODE_WORKSPACE_PATH`。
17|         ```typescript
18|         const workspacePath = process.env.VSCODE_WORKSPACE_PATH;
19|         ```
20|     *   **添加工作区路径校验:** 检查 `workspacePath` 是否存在。如果不存在，应返回错误，提示环境变量未设置。
21|         ```typescript
22|         if (!workspacePath) {
23|             const errorMsg = '无法获取 VS Code 工作区路径 (VSCODE_WORKSPACE_PATH 环境变量未设置)。';
24|             console.error(`[MCP Server] Error in handleSetBreakpoint: ${errorMsg}`);
25|             return {
26|                 status: 'error',
27|                 message: errorMsg,
28|                 content: [{ type: "text", text: errorMsg }],
29|                 isError: true
30|             };
31|         }
32|         ```
33|     *   **解析文件路径:** 在将 `args` 发送给插件之前，解析 `args.file_path`。
34|         *   使用 `path.isAbsolute()` 判断 `args.file_path` 是否已经是绝对路径。
35|         *   如果不是绝对路径，使用 `path.resolve(workspacePath, args.file_path)` 将其解析为基于工作区根目录的绝对路径。
36|         *   将解析后的绝对路径用于后续传递给插件的 `payload`。
37|         ```typescript
38|         let absoluteFilePath = args.file_path; // 默认使用原始路径
39|         if (!path.isAbsolute(args.file_path)) {
40|             console.log(`[MCP Server] Resolving relative path: ${args.file_path} against workspace: ${workspacePath}`);
41|             absoluteFilePath = path.resolve(workspacePath, args.file_path);
42|             console.log(`[MCP Server] Resolved to absolute path: ${absoluteFilePath}`);
43|         } else {
44|             console.log(`[MCP Server] Path is already absolute: ${args.file_path}`);
45|         }
46|
47|         // 更新传递给插件的 payload
48|         const payloadForPlugin = {
49|             ...args, // 包含 line_number, column_number 等其他参数
50|             file_path: absoluteFilePath // 使用解析后的绝对路径
51|         };
52|         ```
53|     *   **更新 `sendRequestToPlugin` 调用:** 确保使用包含已解析路径的 `payloadForPlugin`。
54|         ```typescript
55|         // 修改此行：
56|         // const pluginResponse: PluginResponse = await sendRequestToPlugin({ type: 'setBreakpoint', payload: args });
57|         // 修改为：
58|         const pluginResponse: PluginResponse = await sendRequestToPlugin({ type: 'setBreakpoint', payload: payloadForPlugin });
59|         ```
60|
61| 2.  **审查和测试:**
62|     *   审查代码修改，确保逻辑正确，变量名清晰。
63|     *   （由 Coder 执行）重新编译 MCP 服务器。
64|     *   （由 Coder 执行）通过客户端工具（如 Cline）调用 `set_breakpoint`，分别使用相对路径和绝对路径进行测试，确认断点能正确设置在预期文件的预期位置。
65|     *   （由 Coder 执行）测试 `VSCODE_WORKSPACE_PATH` 未设置时的错误处理。
66|
67| **预期结果:**
68|
69| *   `set_breakpoint` 工具能够正确处理相对路径和绝对路径的文件输入。
70| *   当提供相对路径时，断点会设置在相对于当前 VS Code 工作区根目录的正确文件和行号上。
71| *   当 `VSCODE_WORKSPACE_PATH` 环境变量缺失时，工具会返回明确的错误信息。