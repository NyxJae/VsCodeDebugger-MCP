## 任务上下文
MemoryBank/ProjectBrief.md:28-34
src/extension.ts:18-59
src/mcpServerManager.ts:221-277
src/configManager.ts:7-13
src/configManager.ts:18-23

## 任务规划

**目标:** 实现插件启动时根据配置自动启动 MCP 服务器的功能。

**核心思路:**
1.  在 `configManager.ts` 中添加用于管理“自动启动”配置项的函数。
2.  在 `extension.ts` 的 `activate` 函数中读取该配置，并在需要时调用 `mcpServerManager.startServer()`。
3.  (可选但推荐) 在状态栏菜单中添加切换自动启动配置的选项。

**详细步骤:**

1.  **定义配置项 Key:**
    *   **文件:** `src/constants.ts`
    *   **操作:** 添加一个新的常量用于存储自动启动配置的 Key。
    ```typescript
    // 在文件末尾添加
    export const AUTO_START_KEY = 'mcpServer.autoStart';
    export const DEFAULT_AUTO_START = false; // 默认不自动启动
    ```

2.  **添加配置管理函数:**
    *   **文件:** `src/configManager.ts`
    *   **操作:** 添加读取和存储自动启动配置的函数。
    ```typescript
    import * as vscode from 'vscode';
    // 确保导入了新的常量
    import { DEFAULT_MCP_PORT, MCP_PORT_KEY, isValidPort, AUTO_START_KEY, DEFAULT_AUTO_START } from './utils/portUtils'; // 假设常量移到 portUtils 或 constants
    // 或者直接从 constants.ts 导入
    // import { AUTO_START_KEY, DEFAULT_AUTO_START } from './constants';

    // ... (保留 getStoredPort 和 storePort 函数) ...

    /**
     * 获取存储的自动启动配置。
     */
    export function getAutoStartConfig(context: vscode.ExtensionContext): boolean {
        // 明确指定类型为 boolean，并提供默认值
        const storedValue = context.globalState.get<boolean>(AUTO_START_KEY);
        // 如果存储的值是 undefined，则返回默认值
        if (storedValue === undefined) {
            return DEFAULT_AUTO_START;
        }
        // 确保返回的是布尔值
        return !!storedValue;
    }

    /**
     * 存储自动启动配置。
     */
    export async function storeAutoStartConfig(context: vscode.ExtensionContext, autoStart: boolean): Promise<void> {
        // 直接存储布尔值
        await context.globalState.update(AUTO_START_KEY, autoStart);
        console.log(`Auto-start config updated to: ${autoStart}`);
    }
    ```
    *   **注意:** 需要确认 `AUTO_START_KEY` 和 `DEFAULT_AUTO_START` 的导入路径是否正确 (可能在 `src/constants.ts` 或 `src/utils/portUtils.ts`)。上述代码假设它们在 `portUtils.ts` 中，请根据实际情况调整。如果它们在 `constants.ts`，则从 `./constants` 导入。

3.  **修改插件激活逻辑:**
    *   **文件:** `src/extension.ts`
    *   **操作:** 在 `activate` 函数末尾添加检查配置并启动服务器的逻辑。
    ```typescript
    // 在文件顶部添加导入
    import { getAutoStartConfig } from './configManager';

    export function activate(context: vscode.ExtensionContext) {
        // ... (保留 activate 函数前面的所有代码) ...

        // 将命令和 manager 实例添加到 context.subscriptions 以便自动清理
        context.subscriptions.push(showServerMenuCommand, copyMcpConfigCommand, statusBarManager, mcpServerManager);

        // --- 添加自动启动逻辑 ---
        const shouldAutoStart = getAutoStartConfig(context);
        outputChannel.appendLine(`[Extension] Auto-start config: ${shouldAutoStart}`);
        if (shouldAutoStart) {
            outputChannel.appendLine('[Extension] Auto-starting MCP server...');
            // 异步启动，不需要等待完成
            mcpServerManager.startServer().catch(error => {
                outputChannel.appendLine(`[Extension] Error during auto-start: ${error.message}`);
                vscode.window.showErrorMessage(`自动启动 MCP 服务器失败: ${error.message}`);
            });
        }
        // --- 自动启动逻辑结束 ---
    }
    ```

4.  **(可选) 更新状态栏菜单:**
    *   **文件:** `src/extension.ts`
    *   **操作:** 在 `showServerActionMenu` 函数中添加切换自动启动的选项。
    ```typescript
    // 在文件顶部添加导入
    import { getStoredPort, storePort, getAutoStartConfig, storeAutoStartConfig } from './configManager'; // 添加 getAutoStartConfig, storeAutoStartConfig

100|     // ... (保留 showServerActionMenu 函数前面的代码) ...
101|
102|     async function showServerActionMenu(context: vscode.ExtensionContext, manager: StatusBarManager, serverManager: McpServerManager): Promise<void> {
103|         const status = manager.getStatus();
104|         const items: vscode.QuickPickItem[] = [];
105|         const isAutoStartEnabled = getAutoStartConfig(context); // 获取当前配置
106|
107|         // ... (保留启停服务器、复制配置、更改端口的代码) ...
108|
109|         // --- 添加切换自动启动选项 ---
110|         const toggleAutoStartItem: ActionQuickPickItem = {
111|             label: isAutoStartEnabled ? "$(check) 禁用自动启动" : "$(circle-slash) 启用自动启动",
112|             description: isAutoStartEnabled ? "插件启动时不再自动开启服务器" : "插件启动时自动开启服务器",
113|             action: async () => {
114|                 const newState = !isAutoStartEnabled;
115|                 await storeAutoStartConfig(context, newState);
116|                 vscode.window.showInformationMessage(`MCP 服务器自动启动已${newState ? '启用' : '禁用'}。`);
117|                 // 可以考虑重新打开菜单以显示更新后的状态，但这可能不必要
118|             }
119|         };
120|         items.push(toggleAutoStartItem);
121|         // --- 切换自动启动选项结束 ---
122|
123|         // ... (保留显示状态信息的代码) ...
124|
125|         const selectedOption = await vscode.window.showQuickPick(items, {
126|             placeHolder: "Select an action for the Debug MCP Server",
127|             title: "Debug-MCP Control"
128|         });
129|
130|         if (selectedOption) {
131|             const actionItem = selectedOption as ActionQuickPickItem;
132|             if (actionItem.action) {
133|                 actionItem.action();
134|             }
135|         }
136|     }
137|     ```
138|
139| 5.  **审查与测试:**
140|     *   检查代码修改是否符合预期。
141|     *   测试场景：
142|         *   首次启动插件（默认不自动启动）。
143|         *   通过菜单启用自动启动，重启 VS Code，检查服务器是否自动启动。
144|         *   通过菜单禁用自动启动，重启 VS Code，检查服务器是否未自动启动。
145|         *   检查状态栏菜单是否正确显示和切换自动启动状态。
146|
147| 6.  **(可选) 文档记录:**
148|     *   **触发:** 确认功能稳定后。
149|     *   **操作:** 使用 `new_task` 工具给 `docer` 模式发布任务，要求更新文档，说明新增的自动启动配置项及其在状态栏菜单中的设置方法。
150|     *   **示例消息:** "请更新项目文档，添加关于 MCP 服务器自动启动功能的说明。包括：1. 新增的 `mcpServer.autoStart` 配置项（存储在全局状态，默认为 false）。2. 如何在状态栏菜单中启用或禁用自动启动。"
151|

用户同意架构师的规划,菜单 里加上 设置是否自启动的按钮,要可持久化