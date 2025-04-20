## 任务上下文

### 1. MCP 工具注册

*   在 `mcp-server/src/server.ts` 中，使用 `server.tool()` 方法注册新的 MCP 工具。
*   方法签名示例：`server.tool(toolName, inputSchema, handlerFunction)`。
*   `toolName` (string): 工具的名称，例如 `'get_debugger_configurations'`。
*   `inputSchema` (object): 定义工具输入参数的 JSON Schema。对于 `get_debugger_configurations`，输入参数为空，因此使用 `{}`。
*   `handlerFunction` (function): 处理工具调用的异步函数。该函数应接收 `args` (根据 inputSchema 解析后的参数) 和 `extra` (包含请求上下文信息) 作为参数，并返回一个 Promise，解析为工具的执行结果。
*   参考文件：`mcp-server/src/server.ts` (L46-L51), `mcp-server/node_modules/@modelcontextprotocol/sdk/README.md` (提供了 SDK 的基本用法示例)。

### 2. 获取工作区路径

*   MCP 服务器 (`mcp-server/src/server.ts`) 是一个独立的 Node.js 进程，由 VS Code 插件 (`src/mcpServerManager.ts`) 启动。
*   服务器进程本身无法直接访问 VS Code API 或获取当前工作区路径。
*   VS Code 插件可以通过 `vscode.workspace.workspaceFolders` 获取当前打开的工作区文件夹信息，包括其文件系统路径 (`uri.fsPath`)。
*   为了让 MCP 服务器知道工作区路径，插件需要在启动服务器子进程时，通过环境变量或命令行参数将工作区路径传递给服务器。
*   当前 `src/mcpServerManager.ts` (L90) 仅通过环境变量 `MCP_PORT` 传递端口。需要修改此逻辑以传递工作区路径。
*   参考文件：`src/mcpServerManager.ts` (L85-L92), `Docs/Doc_VsCode_Debug.md` (L41-L46, 提及 `vscode.workspace.workspaceFolders` 在插件中的用法)。

### 3. 文件读取与解析 (.vscode/launch.json)

*   需要在 MCP 服务器端读取 `.vscode/launch.json` 文件。
*   该文件位于工作区根目录下的 `.vscode` 文件夹内。
*   可以使用 Node.js 内置的 `fs` 模块进行文件读取，推荐使用异步方法如 `fs.promises.readFile`。
*   读取到的文件内容是 JSON 格式的字符串，可以使用 `JSON.parse()` 方法将其解析为 JavaScript 对象。
*   需要处理文件不存在 (`ENOENT` 错误) 和 JSON 格式无效 (`SyntaxError`) 的情况。
*   参考文件：Node.js `fs` 模块文档 (需要查阅), Node.js `JSON.parse` 文档 (需要查阅)。
*   当前工作区未找到 `.vscode/launch.json` 文件，这需要在实现时考虑文件不存在的错误处理。

### 4. 错误处理

*   根据 `MemoryBank/ProjectBrief.md` 中 4.1 节的定义 (L117-L119)，工具失败时应返回 `status: "error"` 和一个 `message` 字段。
*   需要处理的错误场景包括：
    *   无法获取工作区路径 (如果传递机制有问题)。
    *   `.vscode` 文件夹或 `launch.json` 文件不存在。
    *   读取文件时发生其他 I/O 错误。
    *   `launch.json` 文件内容不是有效的 JSON。
    *   解析后的 JSON 结构不符合预期 (例如，没有 `configurations` 数组)。
*   参考文件：`MemoryBank/ProjectBrief.md` (L117-L119)。

### 5. 参考项目文档 (ProjectBrief.md 4.1 节)

*   `MemoryBank/ProjectBrief.md` 的 4.1 节 (L81-L119) 详细定义了 `get_debugger_configurations` 工具的规格。
*   工具类型：同步工具。
*   输入参数：无。
*   成功返回值格式：`{ status: "success", configurations: [...] }`。`configurations` 列表中的每个对象至少包含 `name` (string), `type` (string), `request` (string)，并可包含其他可选属性。
*   失败返回值格式：`{ status: "error", message: string }`。
*   实现时必须严格遵循此节定义的输入输出格式。
*   参考文件：`MemoryBank/ProjectBrief.md` (L81-L119)。

### 6. 其他相关文件

*   `src/extension.ts` (L11-L13): 插件入口，负责实例化和管理 `McpServerManager`。
*   `src/configManager.ts`: 管理持久化配置，包括 MCP 服务器端口。与本任务直接相关性较低，但了解其存在有助于理解插件端如何管理设置。
*   `src/statusBarManager.ts`: 管理状态栏显示。与本任务直接相关性较低。
*   `src/utils/portUtils.ts`: 端口相关的工具函数。与本任务直接相关性较低。
*   `Docs/Doc_VsCode_Debug.md`: 提供了 VS Code 调试 API 的详细信息，特别是如何在插件端与调试功能交互。虽然本任务是在服务器端读取文件，但这份文档有助于理解 VS Code 调试配置的上下文。
*   `Docs/Doc_Common.md`: 提供了项目文件概览和整体框架描述。

## 任务规划：实现 get_debugger_configurations 工具

本规划旨在指导 `coder` 完成 MCP 服务器中 `get_debugger_configurations` 工具的实现。

**目标:** 实现一个 MCP 工具，该工具能够读取当前 VS Code 工作区下的 `.vscode/launch.json` 文件，解析其中的调试配置，并按照 `ProjectBrief.md` 4.1 节定义的格式返回给客户端。

**涉及文件:**

*   `src/mcpServerManager.ts` (VS Code 插件端)
*   `mcp-server/src/server.ts` (MCP 服务器主文件)
*   `mcp-server/src/toolProviders/debuggerTools.ts` (建议新建，存放工具实现逻辑)

**依赖:**

*   Node.js 内置模块: `fs`, `path`

**详细步骤:**

**1. 传递工作区路径 (插件端修改)**

*   **文件:** `src/mcpServerManager.ts`
*   **目标:** 在启动 MCP 服务器子进程时，将当前工作区路径通过环境变量传递给服务器。
*   **修改点:** 找到 `startServer` 方法中 `spawn` 函数调用的位置 (大约 L85-L92)。
*   **实现:**
    *   在 `spawn` 调用之前，获取工作区路径：
      ```typescript
      import * as vscode from 'vscode'; // 确保导入 vscode

      // ... 在 startServer 方法内 ...
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
          vscode.window.showErrorMessage('无法启动 Debug-MCP 服务器：请先打开一个工作区文件夹。');
          this.statusBarManager.updateStatus('Error: No Workspace'); // 更新状态栏提示
          return; // 提前返回，不启动服务器
      }
      // 暂时只处理第一个工作区, 实际应用中可能需要更复杂的逻辑来处理多工作区情况
      const workspacePath = workspaceFolders[0].uri.fsPath;
      console.log(`[MCP Server Manager] Workspace path: ${workspacePath}`); // 添加日志
      ```
    *   修改 `spawn` 的 `options.env`，添加 `VSCODE_WORKSPACE_PATH`：
      ```typescript
      const serverProcess = spawn(nodePath, [serverScriptPath], {
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'], // 保持 stdio 配置
          env: {
              ...process.env, // 继承当前环境变量
              MCP_PORT: port.toString(), // 保留现有端口环境变量
              VSCODE_WORKSPACE_PATH: workspacePath // 新增工作区路径环境变量
          },
          // cwd: path.dirname(serverScriptPath) // cwd 选项用于设置子进程的工作目录，如果 serverScriptPath 依赖相对路径解析，则需要设置此项。当前实现不依赖此项。
      });
      ```
*   **注意:** 需要导入 `vscode` 模块。确保对 `workspaceFolders` 为空或未定义的情况进行了健壮的处理（例如，显示错误消息并阻止服务器启动）。添加日志以方便调试。

**2. 创建工具 Provider 文件 (服务器端)**

*   **文件:** `mcp-server/src/toolProviders/debuggerTools.ts` (新建)
*   **目标:** 创建一个单独的文件来存放调试器相关工具的实现逻辑，保持 `server.ts` 清洁。
*   **内容:**
    ```typescript
    import * as fs from 'fs/promises'; // 使用 promises API
    import * as path from 'path';
    import { McpToolExtra } from '@modelcontextprotocol/sdk'; // 确认 SDK 是否导出此类型，若无则省略或自定义

    // 定义期望的 launch.json 配置项结构 (至少包含必要的字段)
    interface LaunchConfiguration {
        name: string;
        type: string;
        request: string;
        [key: string]: any; // 允许其他任意属性
    }

    // 定义期望的 launch.json 顶层结构
    interface LaunchJson {
        version?: string; // version 字段通常存在但可选
        configurations: LaunchConfiguration[];
    }

    // 定义工具处理函数的类型 (如果 SDK 没有提供明确类型，可以自定义)
    type GetDebuggerConfigurationsArgs = Record<string, never>; // 空对象表示无输入参数
    type GetDebuggerConfigurationsResult =
        | { status: 'success'; configurations: LaunchConfiguration[] }
        | { status: 'error'; message: string };

    /**
     * 处理 get_debugger_configurations MCP 工具请求。
     * 读取 VS Code 工作区的 .vscode/launch.json 文件并返回其配置。
     * @param args - 工具输入参数 (空)。
     * @param extra - MCP 工具附加信息 (未使用)。
     * @returns 返回包含配置列表或错误信息的 Promise。
     */
    export async function handleGetDebuggerConfigurations(
        args: GetDebuggerConfigurationsArgs,
        extra: McpToolExtra // extra 参数包含 MCP 请求的附加信息，此工具当前未使用该信息
    ): Promise<GetDebuggerConfigurationsResult> {
        console.log('[MCP Server] Handling get_debugger_configurations request...');

        const workspacePath = process.env.VSCODE_WORKSPACE_PATH;

        if (!workspacePath) {
            const errorMsg = '无法获取 VS Code 工作区路径，请确保插件已正确设置 VSCODE_WORKSPACE_PATH 环境变量。';
            console.error(`[MCP Server] Error: ${errorMsg}`);
            return { status: 'error', message: errorMsg };
        }
        console.log(`[MCP Server] Workspace path received: ${workspacePath}`);

        const launchJsonPath = path.join(workspacePath, '.vscode', 'launch.json');
        console.log(`[MCP Server] Attempting to read launch.json from: ${launchJsonPath}`);

        try {
            const fileContent = await fs.readFile(launchJsonPath, 'utf-8');
            console.log('[MCP Server] Successfully read launch.json content.');

            try {
                // 移除 JSON 文件开头的注释 (常见于 launch.json)
                // 这是一个简单的实现，可能无法处理所有类型的注释，但能处理常见的 // 和 /* */
                const jsonStringWithoutComments = fileContent.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
                const parsedJson: unknown = JSON.parse(jsonStringWithoutComments);
                console.log('[MCP Server] Successfully parsed launch.json content (after removing comments).');

                // 类型守卫和结构验证
                if (
                    typeof parsedJson === 'object' &&
                    parsedJson !== null &&
                    'configurations' in parsedJson &&
                    Array.isArray((parsedJson as LaunchJson).configurations)
                ) {
                    const launchJson = parsedJson as LaunchJson;

                    // 过滤并提取所需信息, 确保 name, type, request 存在
                    const validConfigurations = launchJson.configurations.filter(
                        config => typeof config.name === 'string' && typeof config.type === 'string' && typeof config.request === 'string'
                    );

                    // 提取所有字段，符合 ProjectBrief 的可选要求
                    const resultConfigurations = validConfigurations.map(config => ({ ...config }));


                    console.log(`[MCP Server] Found ${resultConfigurations.length} valid configurations.`);
                    return { status: 'success', configurations: resultConfigurations };
                } else {
                    const errorMsg = 'launch.json 文件格式错误：缺少有效的 "configurations" 数组或结构不正确。';
                    console.error(`[MCP Server] Error: ${errorMsg}`);
                    return { status: 'error', message: errorMsg };
                }
            } catch (parseError) {
                if (parseError instanceof SyntaxError) {
                    const errorMsg = `launch.json 文件格式错误: ${parseError.message}`;
                    console.error(`[MCP Server] Error parsing launch.json: ${errorMsg}`);
                    return { status: 'error', message: errorMsg };
                }
                // 处理其他可能的解析错误
                const errorMsg = `解析 launch.json 时发生意外错误: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
                console.error(`[MCP Server] ${errorMsg}`);
                // 对于未知错误，最好也返回给客户端
                return { status: 'error', message: errorMsg };
            }
        } catch (readError: any) { // 使用 any 或 unknown 并进行检查
            if (readError.code === 'ENOENT') {
                // 文件或目录不存在
                const errorMsg = `无法在 ${workspacePath}${path.sep}.vscode${path.sep} 目录下找到 launch.json 文件。`;
                console.warn(`[MCP Server] ${errorMsg}`);
                // 根据 ProjectBrief 定义，找不到文件是错误
                return { status: 'error', message: errorMsg };
            } else {
                // 其他文件读取错误
                const errorMsg = `读取 launch.json 文件时出错: ${readError.message}`;
                console.error(`[MCP Server] Error reading launch.json: ${errorMsg}`);
                return { status: 'error', message: errorMsg };
            }
        }
    }
    ```
*   **注意:**
    *   使用 `fs.promises` 进行异步文件读取。
    *   添加了详细的 `console.log` 并带有 `[MCP Server]` 前缀以区分日志来源。
    *   实现了更健壮的错误处理逻辑，包括环境变量检查、文件未找到、读取错误、JSON 解析错误（增加了注释移除逻辑）、结构验证失败。
    *   对解析后的 `configurations` 数组中的每个配置项进行了基本验证（确保 `name`, `type`, `request` 存在且为字符串）。
    *   返回格式严格遵循 `ProjectBrief.md` 4.1 节的定义。

**3. 注册工具 (服务器端修改)**

*   **文件:** `mcp-server/src/server.ts`
*   **目标:** 导入新的处理函数并注册 `get_debugger_configurations` 工具。
*   **修改点:** 在文件顶部导入，并在 `server.tool()` 调用区域添加注册逻辑。
*   **实现:**
    *   导入处理函数：
      ```typescript
      import { handleGetDebuggerConfigurations } from './toolProviders/debuggerTools'; // 确认路径相对于 server.ts 正确
      ```
    *   注册工具 (确保在 `server.listen()` 之前调用)：
      ```typescript
      // ... 其他 import 和 server 实例创建 ...

      // 注册 Hello World 工具 (示例，保留或移除)
      // server.tool('hello_world', {}, async (args, extra) => {
      //     console.log('Handling hello_world request...');
      //     return { status: 'success', message: 'Hello World from MCP Server!' };
      // });
      // console.log('[MCP Server] Registered tool: hello_world');

      // 注册获取调试配置的工具
      server.tool(
          'get_debugger_configurations', // 工具名称，与 ProjectBrief 一致
          {}, // 输入 Schema 为空对象，因为此工具无输入参数
          handleGetDebuggerConfigurations // 指定处理函数
      );
      console.log('[MCP Server] Registered tool: get_debugger_configurations');

      // ... 启动服务器逻辑 (server.listen) ...
      ```
*   **注意:** 确保导入路径正确。添加日志确认工具已注册。

**4. 测试**

*   **准备:**
    *   在你的 VS Code 工作区中创建 `.vscode/launch.json` 文件，包含不同类型的配置项（包括格式正确和可能格式错误的）。
    *   可以创建一个没有 `.vscode` 文件夹或 `launch.json` 的工作区用于测试文件未找到的情况。
*   **执行:**
    *   重新构建并运行 VS Code 插件 (`npm run compile` & F5)。
    *   观察 VS Code 的 "输出" 面板 (选择 "Debug-MCP" 或 "Extension Host") 和 MCP 服务器的控制台日志。
    *   确保插件端成功获取并传递了工作区路径。
    *   确保服务器端成功启动并注册了 `get_debugger_configurations` 工具。
    *   使用 MCP 客户端 (如 Cline) 连接到服务器。
    *   调用 `get_debugger_configurations` 工具。
*   **验证场景:**
    *   **场景 1: `launch.json` 存在且格式正确:**
        *   预期客户端收到 `status: "success"` 和包含正确配置信息的 `configurations` 数组。
        *   检查服务器日志，确认读取和解析成功。
    *   **场景 2: `.vscode` 目录或 `launch.json` 文件不存在:**
        *   预期客户端收到 `status: "error"` 和类似 "无法找到 launch.json 文件" 的 `message`。
        *   检查服务器日志，确认捕获到 `ENOENT` 错误。
    *   **场景 3: `launch.json` 存在但 JSON 格式错误 (例如，缺少逗号):**
        *   预期客户端收到 `status: "error"` 和包含 `SyntaxError` 信息的 `message`。
        *   检查服务器日志，确认捕获到 `SyntaxError`。
    *   **场景 4: `launch.json` 存在且 JSON 有效，但缺少 `configurations` 数组或其结构不正确:**
        *   预期客户端收到 `status: "error"` 和类似 "缺少有效的 'configurations' 数组" 的 `message`。
        *   检查服务器日志，确认结构验证失败。
    *   **场景 5: (可选) 插件未能传递 `VSCODE_WORKSPACE_PATH` 环境变量:**
        *   预期客户端收到 `status: "error"` 和关于环境变量未设置的 `message`。
        *   检查服务器日志，确认捕获到环境变量缺失的错误。

**总结:**

该规划提供了实现 `get_debugger_configurations` 工具的详细步骤，涵盖了插件端和服务器端的修改。重点在于正确传递工作区路径、健壮的文件读取与解析、严格的错误处理以及遵循项目规范。通过创建独立的 provider 文件提高了代码的可维护性。详细的日志记录和测试场景有助于确保功能的正确性和稳定性。