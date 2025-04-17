# 任务规划

## 核心目标

在 VS Code 状态栏添加一个可交互的项，用于显示和（模拟）控制 MCP 服务器的状态。

## 详细步骤

### 1. 定义状态和模拟状态管理

*   **目的:** 定义 MCP 服务器可能的状态，并创建一个简单的机制来模拟和切换这些状态。
*   **涉及文件:** `src/extension.ts` (或创建一个新的 `src/mcpStatusManager.ts`)
*   **关键标识符:**
    *   定义一个类型 `McpServerStatus = 'stopped' | 'running' | 'starting' | 'error';`
    *   创建一个变量来存储当前模拟状态: `let currentMcpStatus: McpServerStatus = 'stopped';`
    *   创建一个函数来更新状态: `function setMcpStatus(newStatus: McpServerStatus) { currentMcpStatus = newStatus; updateStatusBarItem(); updateContextKey(); }`
    *   创建一个函数获取状态: `function getMcpStatus(): McpServerStatus { return currentMcpStatus; }`
*   **代码示例 (概念):**
    ```typescript
    // 在 extension.ts 或新文件中
    type McpServerStatus = 'stopped' | 'running' | 'starting' | 'error';
    let currentMcpStatus: McpServerStatus = 'stopped';

    function setMcpStatus(newStatus: McpServerStatus): void {
        currentMcpStatus = newStatus;
        // 后续步骤中会调用状态栏更新和上下文更新函数
        updateStatusBarItem();
        updateContextKey();
        console.log(`MCP Status changed to: ${currentMcpStatus}`); // 调试日志
    }

    function getMcpStatus(): McpServerStatus {
        return currentMcpStatus;
    }
    ```

### 2. 创建和初始化状态栏项

*   **目的:** 在 VS Code 状态栏右侧创建一个显示 MCP 状态的项。
*   **涉及文件:** `src/extension.ts`
*   **关键函数/类:**
    *   `vscode.window.createStatusBarItem(alignment, priority)`: 创建状态栏项。
    *   `vscode.StatusBarItem`: 状态栏项对象。
    *   `context.subscriptions.push()`: 注册 `Disposable` 对象。
*   **实现细节:**
    *   在 `activate` 函数中创建 `StatusBarItem`。
    *   设置对齐方式为 `vscode.StatusBarAlignment.Right`。
    *   设置一个合适的优先级 (e.g., 100)。
    *   将创建的 `StatusBarItem` 添加到 `context.subscriptions`。
    *   声明一个全局变量 `let mcpStatusBarItem: vscode.StatusBarItem;`
*   **代码示例 (在 `activate` 函数内):**
    ```typescript
    // 声明全局变量
    let mcpStatusBarItem: vscode.StatusBarItem;

    // 在 activate 函数内
    mcpStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(mcpStatusBarItem);
    // 初始状态设置和显示将在后续步骤完成
    ```

### 3. 实现状态栏项更新逻辑

*   **目的:** 根据当前的模拟状态更新状态栏项的文本、图标和提示信息。
*   **涉及文件:** `src/extension.ts`
*   **关键函数/类:**
    *   `StatusBarItem.text`: 设置显示的文本 (可包含 Octicons: `$(icon-name)` )。
    *   `StatusBarItem.tooltip`: 设置鼠标悬停时的提示信息。
    *   `StatusBarItem.show()`: 显示状态栏项。
    *   `StatusBarItem.hide()`: 隐藏状态栏项 (可选)。
    *   `StatusBarItem.backgroundColor`: (可选) 设置背景色，用于错误状态。
    *   `vscode.ThemeColor`: 用于设置主题颜色。
*   **实现细节:**
    *   创建一个函数 `updateStatusBarItem()`。
    *   在此函数中，根据 `getMcpStatus()` 的返回值，设置 `mcpStatusBarItem` 的 `text` 和 `tooltip`。
    *   使用 `$(debug-stop)` 表示 stopped, `$(debug-start)` 表示 running, `$(loading~spin)` 表示 starting, `$(error)` 表示 error。
    *   在 `activate` 函数的末尾调用 `updateStatusBarItem()` 进行初始化，并调用 `mcpStatusBarItem.show()`。
*   **代码示例 (参考 `Docs/Doc_VsCode_Extention.md:223-243`):**
    ```typescript
    function updateStatusBarItem(): void {
        if (!mcpStatusBarItem) return;
        const status = getMcpStatus();

        switch (status) {
            case 'running':
                mcpStatusBarItem.text = `$(debug-start) Debug-MCP: Running`;
                mcpStatusBarItem.tooltip = `MCP Server is Running. Click to manage.`;
                mcpStatusBarItem.backgroundColor = undefined;
                break;
            case 'starting':
                mcpStatusBarItem.text = `$(loading~spin) Debug-MCP: Starting...`;
                mcpStatusBarItem.tooltip = `MCP Server is Starting...`;
                mcpStatusBarItem.backgroundColor = undefined;
                break;
            case 'error':
                mcpStatusBarItem.text = `$(error) Debug-MCP: Error`;
                mcpStatusBarItem.tooltip = `MCP Server Error. Click to manage.`;
                mcpStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
            case 'stopped':
            default:
                mcpStatusBarItem.text = `$(debug-stop) Debug-MCP: Stopped`;
                mcpStatusBarItem.tooltip = `MCP Server is Stopped. Click to manage.`;
                mcpStatusBarItem.backgroundColor = undefined;
                break;
        }
    }

    // 在 activate 函数末尾调用
    updateStatusBarItem(); // 初始化状态栏显示
    mcpStatusBarItem.show(); // 确保状态栏项可见
    ```

### 4. 注册点击命令和设置上下文键

*   **目的:** 定义一个命令，当状态栏项被点击时触发，并设置一个上下文键来反映服务器状态，供 `package.json` 使用。
*   **涉及文件:** `src/extension.ts`, `package.json`
*   **关键函数/类:**
    *   `vscode.commands.registerCommand(commandId, handler)`: 注册命令。
    *   `StatusBarItem.command`: 将命令 ID 赋给状态栏项。
    *   `vscode.commands.executeCommand('setContext', key, value)`: 设置上下文键。
*   **实现细节:**
    *   定义命令 ID，例如 `DebugMcpManager.showServerMenu`。
    *   在 `activate` 中注册此命令，其处理函数将在下一步实现（用于显示 Quick Pick 菜单）。
    *   将此命令 ID 赋值给 `mcpStatusBarItem.command`。
    *   创建一个函数 `updateContextKey()`，根据 `getMcpStatus()` 调用 `setContext('DebugMcpManager.serverStatus', status)`。
    *   在 `activate` 末尾和 `setMcpStatus` 中调用 `updateContextKey()`。
    *   在 `package.json` 的 `contributes.commands` 中添加此命令的定义。
*   **代码示例 (`extension.ts`):**
    ```typescript
    const SHOW_SERVER_MENU_COMMAND_ID = 'DebugMcpManager.showServerMenu';

    function updateContextKey(): void {
        const status = getMcpStatus();
        vscode.commands.executeCommand('setContext', 'DebugMcpManager.serverStatus', status);
    }

    // 在 activate 函数内
    context.subscriptions.push(vscode.commands.registerCommand(SHOW_SERVER_MENU_COMMAND_ID, () => {
        // 下一步实现 Quick Pick 菜单逻辑
        showServerActionMenu();
    }));

    mcpStatusBarItem.command = SHOW_SERVER_MENU_COMMAND_ID;

    // 在 activate 函数末尾调用
    updateContextKey(); // 初始化上下文键
    ```
*   **代码示例 (`package.json`):**
    ```json
    "contributes": {
      "commands": [
        // ... 其他命令 ...
        {
          "command": "DebugMcpManager.showServerMenu",
          "title": "Roocode MCP: Show Server Actions"
          // "category": "Roocode MCP" // 可选分类
        }
      ]
      // ... 其他贡献点 ...
    }
    ```

### 5. 实现 Quick Pick 交互菜单

*   **目的:** 当用户点击状态栏项时，弹出一个包含 "Start Server" 或 "Stop Server" 选项的菜单。
*   **涉及文件:** `src/extension.ts`
*   **关键函数/类:**
    *   `vscode.window.showQuickPick(items, options)`: 显示快速选择菜单。
    *   `vscode.QuickPickItem`: 定义菜单项的接口 (包含 `label`, `description`, `action` 等)。
*   **实现细节:**
    *   创建函数 `showServerActionMenu()`。
    *   在此函数中，根据 `getMcpStatus()` 的结果，动态构建 `QuickPickItem` 数组。
    *   如果状态是 'stopped'，提供 "Start Server" 选项，其 `action` 调用 `setMcpStatus('running')` (或 'starting' 然后 'running' 来模拟过程)。
    *   如果状态是 'running'，提供 "Stop Server" 选项，其 `action` 调用 `setMcpStatus('stopped')`。
    *   调用 `vscode.window.showQuickPick` 显示菜单。
    *   当用户选择一个选项后，执行其关联的 `action`。
*   **代码示例 (参考 `Docs/Doc_VsCode_Extention.md:246-325`):**
    ```typescript
    async function showServerActionMenu(): Promise<void> {
        const status = getMcpStatus();
        const items: vscode.QuickPickItem[] = [];

        if (status === 'running') {
            items.push({
                label: "$(debug-stop) Stop MCP Server",
                description: "Stops the (simulated) MCP server",
                action: () => setMcpStatus('stopped')
            });
            // 可以添加重启等其他选项
        } else if (status === 'stopped' || status === 'error') {
             items.push({
                label: "$(debug-start) Start MCP Server",
                description: "Starts the (simulated) MCP server",
                // 模拟启动过程
                action: () => {
                    setMcpStatus('starting');
                    setTimeout(() => {
                         // 模拟成功启动
                        setMcpStatus('running');
                        // // 模拟启动失败
                        // setMcpStatus('error');
                        // vscode.window.showErrorMessage("Failed to start MCP Server (Simulated)");
                    }, 1500); // 模拟延迟
                }
            });
        }
        // 可以添加一个始终显示的状态信息项
        items.push({
             label: `Current Status: ${status}`,
             description: 'Read-only status information',
             // action: () => {} // 无操作或显示详细信息
        });


        const selectedOption = await vscode.window.showQuickPick(items, {
            placeHolder: "Select an action for the MCP Server",
            title: "Debug-MCP Control"
        });

        if (selectedOption && (selectedOption as any).action) {
            (selectedOption as any).action();
        }
    }
    ```

### 6. 代码组织和清理

*   **目的:** 保持 `extension.ts` 的整洁，并确保资源被正确释放。
*   **涉及文件:** `src/extension.ts`, (可选) `src/statusBarManager.ts`
*   **关键函数/类:**
    *   `deactivate()`: 插件停用时调用的函数。
    *   `Disposable.dispose()`: 释放资源的方法。
*   **实现细节:**
    *   考虑将状态管理 (`currentMcpStatus`, `setMcpStatus`, `getMcpStatus`) 和状态栏更新 (`mcpStatusBarItem`, `updateStatusBarItem`, `updateContextKey`) 逻辑封装到一个单独的类或模块中（例如 `StatusBarManager`）。`activate` 函数负责实例化它，`deactivate` 负责调用其 `dispose` 方法。
    *   确保 `mcpStatusBarItem` 在 `deactivate` 函数中被 `dispose` (如果它没有被添加到 `context.subscriptions`，则需要手动调用；如果添加了，则无需手动调用)。
*   **代码示例 (如果使用单独的类):**
    ```typescript
    // src/statusBarManager.ts (概念)
    export class StatusBarManager implements vscode.Disposable {
        private statusBarItem: vscode.StatusBarItem;
        private currentStatus: McpServerStatus = 'stopped';
        private commandId = 'DebugMcpManager.showServerMenu';

        constructor(private context: vscode.ExtensionContext) {
            this.statusBarItem = vscode.window.createStatusBarItem(/*...*/);
            this.statusBarItem.command = this.commandId;
            context.subscriptions.push(this.statusBarItem);
            this.updateStatusBar();
            this.updateContext();
            this.statusBarItem.show();
        }

        setStatus(newStatus: McpServerStatus): void {
            this.currentStatus = newStatus;
            this.updateStatusBar();
            this.updateContext();
        }

        getStatus(): McpServerStatus { return this.currentStatus; }

        private updateStatusBar(): void { /* ... 更新 statusBarItem.text/tooltip ... */ }
        private updateContext(): void { /* ... 调用 setContext ... */ }

        dispose(): void {
            this.statusBarItem.dispose(); // 虽然已加入 subscriptions，显式调用也无妨
        }
    }

    // src/extension.ts
    import { StatusBarManager } from './statusBarManager';
    let statusBarManager: StatusBarManager;

    export function activate(context: vscode.ExtensionContext) {
        statusBarManager = new StatusBarManager(context);

        context.subscriptions.push(vscode.commands.registerCommand(statusBarManager.commandId, () => {
            showServerActionMenu(statusBarManager); // 将 manager 实例传给菜单函数
        }));
        // ... 其他 activate 逻辑 ...
    }

     export function deactivate() {
        statusBarManager?.dispose(); // 确保清理
     }

     async function showServerActionMenu(manager: StatusBarManager): Promise<void> {
        const status = manager.getStatus();
        // ... 构建菜单项，action 调用 manager.setStatus(...) ...
     }
    ```

## 预期结果

*   VS Code 启动后，状态栏右下角出现 "Debug-MCP: Stopped" 图标和文本。
*   点击该状态栏项，弹出一个菜单。
*   菜单中显示 "Start MCP Server" 选项。
*   点击 "Start MCP Server"，状态栏项变为加载状态 "Debug-MCP: Starting..."，短暂延迟后变为 "Debug-MCP: Running"。
*   再次点击状态栏项，菜单中显示 "Stop MCP Server" 选项。
*   点击 "Stop MCP Server"，状态栏项变回 "Debug-MCP: Stopped"。

## 后续扩展考虑

*   将模拟状态替换为与真实 MCP 服务器进程的交互（通过 IPC）。
*   实现 `McpServerManager` 类来管理子进程。
*   在 Quick Pick 菜单中添加更多选项（重启、查看日志、更改设置等）。
*   处理真实的错误状态。

## 任务上下文
- src/extension.ts:1-26 (VS Code插件激活和命令注册代码)
- Docs/Doc_VsCode_Extention.md:140-243 (状态栏创建和管理代码)
- Docs/Doc_VsCode_Extention.md:179-242 (状态栏项更新和交互代码)
- Docs/Doc_MCP.md:609-619 (MCP服务器状态管理代码)