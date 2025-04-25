好的，没问题。根据你的需求，我将为你整理一份专注于 VS Code 插件开发基础的文档，它将涵盖核心概念、常用 API、开发流程和最佳实践，特别针对你提到的管理 MCP 服务器和状态栏交互等功能点。这份文档将**不包含** Webview、VS Code 调试协议 (DAP) 或 MCP 协议本身的细节，旨在为你后续深入学习打下坚实的 VS Code 插件开发基础。

---

## VS Code 插件开发入门与核心 API 指南 (为 Vscode Debugger 插件定制)

### 1. 简介

Visual Studio Code (VS Code) 插件允许开发者扩展编辑器的功能，从添加简单命令到集成复杂语言服务和外部工具。你的目标是创建一个插件来管理一个外部进程（MCP 服务器）并提供 UI 交互（状态栏、设置面板）。

**核心概念:**

*   **插件清单 (`package.json`):** 定义插件元数据、激活时机、贡献点（命令、设置、菜单项等）的 JSON 文件。
*   **入口文件 (`extension.ts`):** 通常是插件的主要 TypeScript/JavaScript 文件，包含 `activate` 和 `deactivate` 函数。
*   **激活事件 (`activationEvents`):** 在 `package.json` 中定义，告诉 VS Code 何时加载并运行你的插件代码（例如，VS Code 启动完成时、特定命令被调用时）。
*   **贡献点 (`contributes`):** 在 `package.json` 中定义，声明插件向 VS Code 添加的功能，如命令、配置项、菜单项等。
*   **VS Code API (`vscode` 模块):** 一个 Node.js 模块，提供访问和控制 VS Code 编辑器环境的接口。

### 2. 开发环境搭建

1.  **安装 Node.js 和 npm/yarn:** VS Code 插件使用 Node.js 运行时。请确保安装了较新版本的 Node.js (LTS 版本通常是好的选择)。
2.  **安装 Yeoman 和 VS Code Extension Generator:** Yeoman 是一个脚手架工具，`generator-code` 是用于生成 VS Code 插件项目的模板。
    ```bash
    npm install -g yo generator-code
    # 或者使用 yarn
    # yarn global add yo generator-code
    ```
3.  **生成项目骨架:**
    ```bash
    yo code
    ```
    按照提示操作：
    *   选择 `New Extension (TypeScript)`。
    *   输入插件名称 (例如 `Vscode-mcp-manager`)。
    *   输入标识符 (例如 `DebugMcpManager`)。
    *   输入描述。
    *   选择是否初始化 Git 仓库。
    *   选择包管理器 (npm 或 yarn)。

    这将创建一个包含基本结构和配置的插件项目文件夹。

### 3. 插件清单 (`package.json`) 详解

这是插件的“身份证”，位于项目根目录。你需要关注以下关键字段：

*   `name`: 插件的唯一标识符（小写，无空格）。
*   `displayName`: 显示在 VS Code 扩展市场的名称。
*   `description`: 插件的简短描述。
*   `version`: 插件版本号 (遵循 SemVer)。
*   `publisher`: 你在 VS Code Marketplace 上的发布者 ID。
*   `engines`: 指定兼容的 VS Code 版本，例如 `"vscode": "^1.80.0"`。
*   `main`: 指向插件入口文件的路径，通常是 `./out/extension.js` (编译后的 JS 文件)。
*   `activationEvents`: **非常重要**。定义插件何时被激活。对于你的需求，可能需要：
    *   `"onStartupFinished"`: VS Code 完全启动后激活。适合需要检查或自动启动服务器的场景。
    *   `"onCommand:yourCommand.id"`: 当用户执行特定命令时激活。
    *   `"workspaceContains:.vscode/launch.json"`: 当打开的工作区包含特定文件时激活（如果你的服务器与项目配置相关）。
    *   *示例:*
        ```json
        "activationEvents": [
          "onStartupFinished",
          "onCommand:DebugMcpManager.startServer",
          "onCommand:DebugMcpManager.stopServer",
          "onCommand:DebugMcpManager.restartServer",
          "onCommand:DebugMcpManager.showSettings"
        ]
        ```
*   `contributes`: **核心部分**。声明插件贡献的功能。
    *   `commands`: 定义用户可以执行的命令。每个命令需要 `command` (唯一 ID) 和 `title` (显示在命令面板中的名称)。
        ```json
        "contributes": {
          "commands": [
            {
              "command": "DebugMcpManager.startServer",
              "title": "Debug MCP: Start Server"
            },
            {
              "command": "DebugMcpManager.stopServer",
              "title": "Debug MCP: Stop Server"
            },
            // ... 其他命令
            {
              "command": "DebugMcpManager.showSettings",
              "title": "Debug MCP: Show Settings Panel"
            }
          ]
        }
        ```
    *   `configuration`: 定义用户可以在 VS Code 设置中配置的选项。
        ```json
        "contributes": {
          "configuration": {
            "title": "Debug MCP Manager", // 设置分类标题
            "properties": {
              "DebugMcpManager.port": {
                "type": "number",
                "default": 8080,
                "description": "Port number for the Debug MCP Server."
              },
              "DebugMcpManager.autoStart": {
                "type": "boolean",
                "default": true,
                "description": "Automatically start the Debug MCP Server when VS Code starts."
              }
            }
          }
        }
        ```
    *   `menus`: 将命令添加到 VS Code 的 UI 元素中，例如命令面板、状态栏。
        ```json
        "contributes": {
          "menus": {
            "commandPalette": [ // 添加到命令面板 (Ctrl+Shift+P)
              {
                "command": "DebugMcpManager.startServer",
                "when": "!DebugMcpManager.serverRunning" // 条件显示 (需要设置 context)
              },
              {
                "command": "DebugMcpManager.stopServer",
                "when": "DebugMcpManager.serverRunning" // 条件显示
              }
            ],
            // 注意：直接在状态栏添加“按钮”是通过 API 创建 StatusBarItem 实现的，
            // 但你可以定义一个命令，然后让 StatusBarItem 点击时执行这个命令。
            // 也可以在这里定义当右键点击状态栏项时出现的菜单项。
            "statusBar/context": [ // 假设你的状态栏项设置了 context key
               {
                 "command": "DebugMcpManager.showSettings",
                 "group": "1_settings@1" // 控制排序
               }
            ]
          }
        }
        ```
    *   `jsonValidation`: (可选) 如果你的插件需要特定的 JSON 文件格式（例如 MCP 客户端配置模板），可以在这里提供 JSON Schema 来进行验证和智能提示。

### 4. 插件入口 (`extension.ts`) 与生命周期

这是插件代码的起点。

```typescript
import * as vscode from 'vscode';
import { McpServerManager } from './mcpServerManager'; // 假设你将服务器管理逻辑封装

let serverManager: McpServerManager | undefined;
let myStatusBarItem: vscode.StatusBarItem;

// 插件激活时调用，仅调用一次
export function activate(context: vscode.ExtensionContext) {

    console.log('Congratulations, your extension "Debug-mcp-manager" is now active!');

    // 实例化服务器管理器 (包含启动、停止、状态检查等逻辑)
    serverManager = new McpServerManager(context);

    // --- 注册命令 ---
    // 命令的实现需要与 package.json 中定义的 command ID 匹配
    // 使用 context.subscriptions.push 注册 disposable 对象，确保插件停用时资源被释放

    context.subscriptions.push(vscode.commands.registerCommand('DebugMcpManager.startServer', () => {
        serverManager?.start();
        updateStatusBarItem(); // 更新状态栏显示
    }));

    context.subscriptions.push(vscode.commands.registerCommand('DebugMcpManager.stopServer', () => {
        serverManager?.stop();
        updateStatusBarItem();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('DebugMcpManager.restartServer', async () => {
        await serverManager?.restart();
        updateStatusBarItem();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('DebugMcpManager.showSettings', () => {
        showSettingsPanel(); // 显示自定义的设置面板交互
    }));

    // --- 创建和管理状态栏项 ---
    myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100); // 对齐方式和优先级
    myStatusBarItem.command = 'DebugMcpManager.showSettings'; // 点击状态栏项时执行的命令
    context.subscriptions.push(myStatusBarItem); // 添加到 disposables

    // 监听服务器状态变化事件 (假设 serverManager 会发出事件)
    serverManager.onStatusChanged((status) => {
        updateStatusBarItem(status);
        // 设置 context key，用于 package.json 中的 when 条件
        vscode.commands.executeCommand('setContext', 'DebugMcpManager.serverRunning', status === 'running');
    });

    // 初始化状态栏
    updateStatusBarItem(serverManager.getStatus());
    myStatusBarItem.show(); // 显示状态栏项

    // --- 处理自动启动 ---
    const config = vscode.workspace.getConfiguration('DebugMcpManager');
    const autoStart = config.get<boolean>('autoStart');
    if (autoStart) {
        // 这里需要实现检查是否已有其他 MCP 服务器运行的逻辑
        // 如果没有，则启动本插件的服务器
        serverManager.startIfNotRunning(); // 假设有这个方法
    }

    // 监听配置变化
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('DebugMcpManager.port') || e.affectsConfiguration('DebugMcpManager.autoStart')) {
            // 配置变化时可能需要重启服务器或更新行为
            serverManager?.handleConfigurationChange();
            vscode.window.showInformationMessage('Debug MCP settings changed. You might need to restart the server.');
        }
    }));
}

// 插件停用时调用，用于清理资源
export function deactivate(): Thenable<void> | undefined {
    console.log('Deactivating "Debug-mcp-manager"');
    myStatusBarItem?.dispose(); // 销毁状态栏项
    return serverManager?.dispose(); // 停止服务器并清理其他资源
}

// --- 辅助函数 ---

// 更新状态栏项的文本和提示
function updateStatusBarItem(status?: string): void {
    if (!myStatusBarItem) return;
    const currentStatus = status ?? serverManager?.getStatus() ?? 'stopped'; // 获取当前状态

    if (currentStatus === 'running') {
        myStatusBarItem.text = `$(debug-start) Debug MCP`; // 使用 Octicon 图标
        myStatusBarItem.tooltip = `Debug MCP Server is running. Click to manage.`;
        myStatusBarItem.backgroundColor = undefined; // 清除背景色
    } else if (currentStatus === 'starting') {
        myStatusBarItem.text = `$(loading~spin) Starting MCP...`;
        myStatusBarItem.tooltip = `Debug MCP Server is starting...`;
    } else if (currentStatus === 'error') {
        myStatusBarItem.text = `$(error) MCP Error`;
        myStatusBarItem.tooltip = `Debug MCP Server encountered an error. Click to manage.`;
        myStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground'); // 设置错误背景色
    } else { // stopped or other states
        myStatusBarItem.text = `$(debug-stop) Debug MCP`;
        myStatusBarItem.tooltip = `Debug MCP Server is stopped. Click to manage.`;
        myStatusBarItem.backgroundColor = undefined;
    }
}

// 显示设置面板 (使用 Quick Pick 或 Input Box)
async function showSettingsPanel(): Promise<void> {
    const options: { label: string; description?: string; action: () => Promise<void> | void }[] = [];

    const currentStatus = serverManager?.getStatus() ?? 'stopped';
    const config = vscode.workspace.getConfiguration('DebugMcpManager');
    const currentPort = config.get<number>('port');
    const autoStartEnabled = config.get<boolean>('autoStart');

    options.push({ label: `Status: ${currentStatus}`, description: 'Current Debug MCP Server status', action: () => {} }); // 只显示信息

    if (currentStatus === 'running') {
        options.push({ label: '$(debug-stop) Stop Server', description: 'Stop the running Debug MCP Server', action: () => serverManager?.stop() });
        options.push({ label: '$(debug-restart) Restart Server', description: 'Restart the Debug MCP Server', action: () => serverManager?.restart() });
    } else {
        options.push({ label: '$(debug-start) Start Server', description: 'Start the Debug MCP Server', action: () => serverManager?.start() });
    }

    options.push({
        label: `$(gear) Change Port (Current: ${currentPort})`,
        description: 'Set a new port for the Debug MCP Server',
        action: async () => {
            const newPortStr = await vscode.window.showInputBox({
                prompt: 'Enter the new port number for the Debug MCP Server',
                value: String(currentPort),
                validateInput: value => {
                    const portNum = Number(value);
                    return !isNaN(portNum) && portNum > 0 && portNum < 65536 ? null : 'Please enter a valid port number (1-65535)';
                }
            });
            if (newPortStr) {
                const newPort = Number(newPortStr);
                await config.update('port', newPort, vscode.ConfigurationTarget.Global); // 更新全局设置
                vscode.window.showInformationMessage(`Debug MCP Server port updated to ${newPort}. Restart the server for changes to take effect.`);
                // 可能需要 serverManager?.handleConfigurationChange();
            }
        }
    });

    options.push({
        label: autoStartEnabled ? '$(check) Disable Auto Start' : '$(circle-slash) Enable Auto Start',
        description: autoStartEnabled ? 'Prevent server from starting automatically' : 'Start server automatically with VS Code',
        action: async () => {
            await config.update('autoStart', !autoStartEnabled, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Debug MCP Server auto-start ${!autoStartEnabled ? 'enabled' : 'disabled'}.`);
        }
    });

    options.push({
        label: '$(clippy) Copy Client Config Template (Claude Cursor)',
        description: 'Copy a sample MCP client configuration to clipboard',
        action: () => {
            const template = `{
  "mcp_server_url": "http://localhost:${currentPort}"
  // Add other client-specific settings here
}`;
            vscode.env.clipboard.writeText(template);
            vscode.window.showInformationMessage('Client config template copied to clipboard.');
        }
    });
     options.push({
        label: '$(clippy) Copy Client Config Template (Other Client)',
        description: 'Copy a generic MCP client configuration to clipboard',
        action: () => {
            const template = `MCP_SERVER=http://localhost:${currentPort}`; // Example for another format
            vscode.env.clipboard.writeText(template);
            vscode.window.showInformationMessage('Generic client config template copied to clipboard.');
        }
    });


    const selectedOption = await vscode.window.showQuickPick(options, {
        placeHolder: 'Select an action for Debug MCP Server',
        title: 'Debug MCP Manager'
    });

    if (selectedOption && selectedOption.action) {
        await selectedOption.action();
        updateStatusBarItem(); // 更新状态栏以反映可能的变化
    }
}
```

**说明:**

*   `McpServerManager` 类是你需要自己实现的，它封装了启动、停止、重启、获取状态、处理配置变化、检查其他服务器实例等所有与 MCP 服务器进程交互的逻辑。这通常涉及到 Node.js 的 `child_process` 模块来管理外部进程。
*   `context.subscriptions`: 非常重要！所有注册的命令、事件监听器、状态栏项等都应该 `push` 到这里。当插件停用时，VS Code 会自动调用这些对象的 `dispose` 方法，防止内存泄漏。
*   `vscode.commands.executeCommand('setContext', key, value)`: 用于设置一个可以在 `package.json` 的 `when` 子句中使用的上下文变量。这对于根据插件状态（例如服务器是否运行）动态显示/隐藏命令或菜单项非常有用。
*   `showSettingsPanel` 函数使用了 `vscode.window.showQuickPick` 来模拟一个弹出式设置面板，提供各种操作选项。对于需要用户输入的（如更改端口号），使用了 `vscode.window.showInputBox`。
*   状态栏项 (`StatusBarItem`) 的 `text` 可以包含 Octicons 图标 (`$(icon-name)`)，`tooltip` 提供悬停提示，`command` 指定点击时执行的命令 ID。`backgroundColor` 可以用来指示错误状态。
*   配置的读取使用 `vscode.workspace.getConfiguration('yourPrefix').get('settingName')`，更新使用 `config.update('settingName', value, target)`。`target` 通常是 `vscode.ConfigurationTarget.Global` 或 `vscode.ConfigurationTarget.Workspace`。
*   多窗口管理：VS Code 为每个窗口运行一个独立的插件宿主进程。`activate` 函数会在每个窗口加载时运行。你需要设计 `McpServerManager` 来处理这种情况：
    *   **启动时检查:** 在 `activate` 中，启动服务器前检查是否已有全局（或特定端口）的 MCP 服务器在运行。这可能需要使用系统级的方法（如检查特定端口是否被监听，或使用一个共享文件/锁）。
    *   **共享状态:** 如果需要跨窗口共享服务器状态，可能需要更复杂的机制，如使用本地文件、命名管道或一个轻量级的本地服务来同步状态。对于你的需求（只启动一个实例），通常是在启动前进行检查。
    *   **用户手动启动:** 如果用户在一个窗口手动启动，你的逻辑应该能检测到并可能需要提示用户或强制关闭其他实例（如果设计如此）。

### 5. 核心 VS Code API 概览 (与你的需求相关)

*   **`vscode.commands`**
    *   `registerCommand(commandId, callback)`: 注册一个命令。回调函数在命令被触发时执行。返回一个 `Disposable`。
    *   `executeCommand(commandId, ...args)`: 以编程方式执行一个命令（可以是你的插件或其他插件的命令）。
*   **`vscode.window`**
    *   `createStatusBarItem(alignment?, priority?)`: 创建一个新的状态栏项。`alignment` (Left/Right) 和 `priority` (数字，越大越靠右/左) 控制位置。返回 `StatusBarItem`。
    *   `showInformationMessage(message, ...items)` / `showWarningMessage(...)` / `showErrorMessage(...)`: 显示不同级别的通知消息给用户。可以添加按钮 (`items`) 让用户交互。
    *   `showQuickPick(items, options?)`: 显示一个下拉选择列表，让用户从中选择一项。`items` 可以是字符串数组或包含 `label`, `description`, `detail` 的对象数组。非常适合做简单的设置面板或选项选择。
    *   `showInputBox(options?)`: 显示一个输入框，让用户输入文本。可以设置提示、默认值、验证逻辑等。适合获取端口号等信息。
    *   `activeTextEditor`: 获取当前活动的文本编辑器实例。
    *   `onDidChangeActiveTextEditor`: 当活动编辑器改变时触发的事件。
*   **`vscode.workspace`**
    *   `getConfiguration(section?)`: 获取指定部分的配置对象。`section` 通常是 `package.json` 中 `contributes.configuration` 的 `title` 或属性前缀。
    *   `onDidChangeConfiguration`: 当用户更改设置时触发的事件。回调函数接收一个事件对象，可以用 `e.affectsConfiguration('yourPrefix.settingName')` 来检查特定设置是否被更改。
    *   `workspaceFolders`: 获取当前打开的工作区文件夹列表。
    *   `fs`: 提供访问工作区文件的 API (读取、写入、监听文件变化等)。
*   **`vscode.extensions`**
    *   `getExtension(extensionId)`: 获取指定 ID 的已安装插件实例。可以用来检查其他相关插件是否存在或获取其导出的 API。
    *   `onDidChange`: 当插件安装、卸载、启用或禁用时触发的事件。
*   **`vscode.env`**
    *   `appName`: VS Code 的名称 (e.g., "Visual Studio Code")。
    *   `appRoot`: VS Code 安装目录的路径。
    *   `language`: 当前 VS Code 使用的语言。
    *   `sessionId`: 当前 VS Code 会话的唯一 ID。
    *   `machineId`: 机器的唯一 ID。
    *   `clipboard`: 提供读写系统剪贴板的功能 (`readText()`, `writeText()`)。用于实现“复制配置模板”功能。
*   **`vscode.Uri`**: 用于表示文件或资源的统一资源标识符。很多 API 都使用 Uri 对象而不是简单的字符串路径。`Uri.file(path)` 和 `Uri.parse(uriString)` 是常用的创建方法。
*   **`vscode.Disposable`**: 一个具有 `dispose()` 方法的对象。用于管理需要清理的资源（事件监听器、命令、状态栏项等）。`context.subscriptions` 是一个 `Disposable[]`。

### 6. 运行和调试插件

1.  **编译:** 在项目根目录运行 `npm run compile` 或 `yarn compile` (或者使用 `npm run watch` / `yarn watch` 进行自动增量编译)。
2.  **启动调试:** 在 VS Code 中打开你的插件项目文件夹，按 `F5`。这将：
    *   编译你的代码（如果尚未编译）。
    *   启动一个新的 VS Code 窗口，称为 **扩展开发宿主 (Extension Development Host)**。
    *   你的插件将在此新窗口中运行。
3.  **测试:** 在扩展开发宿主窗口中，尝试触发你的命令（通过命令面板 Ctrl+Shift+P），检查状态栏项，更改设置等。
4.  **调试:** 你可以在你的插件代码 (`.ts` 文件) 中设置断点。当代码执行到断点时，原始的 VS Code 窗口（运行调试器的窗口）会暂停，你可以检查变量、单步执行等，就像调试普通 Node.js 应用一样。`console.log` 的输出会显示在原始窗口的“调试控制台”中。

### 7. 最佳实践

*   **异步操作:** VS Code API 大量使用 `Promise`。始终使用 `async/await` 来处理异步操作，避免阻塞主线程。
*   **错误处理:** 使用 `try...catch` 块来捕获和处理潜在的错误，并通过 `vscode.window.showErrorMessage` 向用户提供清晰的反馈。
*   **资源管理 (`Disposable`):** 确保所有注册的命令、事件监听器、状态栏项、终端等都添加到 `context.subscriptions` 中，以便在插件停用时自动清理。
*   **用户反馈:** 对于耗时操作或后台任务，提供明确的反馈（例如，状态栏更新、进度通知）。对于成功或失败的操作，使用信息或错误消息通知用户。
*   **配置:** 合理使用配置项让插件更灵活。监听配置变化并适当地做出反应。
*   **性能:** 避免在 `activate` 函数中执行过多耗时操作。利用激活事件延迟加载，只在需要时激活插件。如果需要执行长时间运行或 CPU 密集型任务，考虑使用 Node.js 的 `worker_threads` 或将其放在单独的进程中（就像你的 MCP 服务器一样）。
*   **代码组织:** 将不同的功能模块化（例如，将 MCP 服务器管理逻辑封装在单独的类或文件中）。

### 8. 发布插件

1.  **获取发布者 ID:** 在 Azure DevOps 上创建一个组织（如果还没有），并获取个人访问令牌 (PAT) 用于发布。
2.  **安装 vsce:** 这是 VS Code 官方的命令行工具，用于打包和发布插件。
    ```bash
    npm install -g vsce
    # or yarn global add vsce
    ```
3.  **登录:**
    ```bash
    vsce login <your-publisher-name>
    ```
    会提示你输入之前创建的 PAT。
4.  **更新 `package.json`:** 确保 `publisher`, `name`, `version`, `repository` 等字段正确无误。建议添加 `icon` 字段指向一个 128x128 的 PNG 图标文件。
5.  **打包:**
    ```bash
    vsce package
    ```
    这会生成一个 `.vsix` 文件，这是插件的安装包。你可以手动分享或安装这个文件。
6.  **发布:**
    ```bash
    vsce publish
    ```    这会将你的插件上传到 VS Code Marketplace。

    *注意:* 每次发布新版本前，需要增加 `package.json` 中的 `version` 号。

---

这份文档为你提供了 VS Code 插件开发的基础知识和针对你项目需求的具体 API 指导。下一步，你需要专注于实现 `McpServerManager` 类，处理与你的 MCP 服务器进程的交互（启动、停止、通信、状态监控），并处理好 VS Code 多窗口环境下的服务器实例管理逻辑。祝你开发顺利！