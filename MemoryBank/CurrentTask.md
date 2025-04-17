## 任务上下文

1. 状态栏菜单实现:
- src/statusBarManager.ts (15行)
- src/extension.ts (36-79行)
- package.json (19-20行)

2. 添加菜单项方法:
- src/extension.ts (45-64行)

3. 获取服务器配置:
- src/mcpServerManager.ts (25-27行)
- mcp-server/src/server.ts (1-26行)

4. Cline配置格式:
- Docs/Doc_MCP.md (665-712行)

## 任务规划

**目标:** 在状态栏菜单中添加一个“复制 客户端配置(RooCode/Cline)”按钮，用于一键复制当前（假设的）MCP 服务器配置到剪贴板。

**实施步骤:**

1.  **定义新命令 (`package.json`)**
    *   在 `contributes.commands` 数组中添加一个新的命令对象。
    *   `command`: `DebugMcpManager.copyMcpConfig` (修改)
    *   `title`: `Debug MCP: Copy MCP Server Config` (修改)
    *   *代码变更示例:*
        ```diff
        --- a/package.json
        +++ b/package.json
        @@ -19,6 +19,10 @@
              "command": "DebugMcpManager.showServerMenu",
              "title": "Debug MCP: Show Server Actions"
            }
+           ,{ // 注意逗号
+             "command": "DebugMcpManager.copyMcpConfig", // 修改
+             "title": "Debug MCP: Copy MCP Server Config" // 修改
+           }
          ]
        }
        ```

2.  **注册新命令 (`src/extension.ts`)**
    *   在 `activate` 函数中，使用 `vscode.commands.registerCommand` 注册 `DebugMcpManager.copyMcpConfig` 命令。
    *   将注册的命令添加到 `context.subscriptions` 中。
    *   关联的处理函数为 `copyMcpConfigHandler` (将在下一步实现)。
    *   *代码变更示例:*
        ```diff
        --- a/src/extension.ts
        +++ b/src/extension.ts
        @@ -29,8 +29,14 @@
         		showServerActionMenu(statusBarManager, mcpServerManager);
         	});

+           // 注册复制 MCP 配置的命令
+           const copyMcpConfigCommand = vscode.commands.registerCommand('DebugMcpManager.copyMcpConfig', () => { // 修改 command ID
+               // 调用处理函数 (将在下一步实现)
+               copyMcpConfigHandler(context); // 修改 handler 名称, 传入 context 以获取路径
+           });
+
         	// 将命令和 manager 实例添加到 context.subscriptions 以便自动清理
-           context.subscriptions.push(showServerMenuCommand, statusBarManager, mcpServerManager);
+           context.subscriptions.push(showServerMenuCommand, copyMcpConfigCommand, statusBarManager, mcpServerManager); // 修改添加的 command 变量名

         }
        ```

3.  **实现命令处理函数 (`src/extension.ts`)**
    *   在 `src/extension.ts` 文件底部（`deactivate` 函数之前）添加一个新的 `async` 函数 `copyMcpConfigHandler`。
    *   该函数接收 `context: vscode.ExtensionContext` 作为参数。
    *   **获取服务器脚本路径:** 使用 `path.join(context.extensionPath, 'mcp-server', 'dist', 'server.js')` 获取服务器脚本的绝对路径。注意处理 Windows 路径分隔符 `\` 在 JSON 字符串中的转义 (`\\`)。
    *   **定义默认端口:** 使用硬编码的端口号 `6677` (因为服务器当前不监听端口)。
    *   **生成 RooCode/Cline 配置:** 根据 `Docs/Doc_MCP.md` (679-702行) 的格式，创建一个包含 `command`, `args`, `env` 的 JSON 对象，并将其字符串化。
    *   **复制到剪贴板:** 使用 `await vscode.env.clipboard.writeText(configString)`。
    *   **显示提示:** 使用 `vscode.window.showInformationMessage('MCP server configuration (RooCode/Cline format) copied to clipboard!')`。
    *   添加必要的 `import * as path from 'path';`。
    *   *代码实现示例:*
        ```typescript
        // src/extension.ts (添加在文件末尾附近, deactivate 函数之前)
        import * as path from 'path'; // 确保在文件顶部导入 path 模块

        /**
         * 处理复制 MCP 服务器配置 (RooCode/Cline 格式) 到剪贴板的命令。 // 修改描述
         * @param context VS Code 扩展上下文，用于获取扩展路径。
         */
        async function copyMcpConfigHandler(context: vscode.ExtensionContext): Promise<void> { // 修改函数名
            try {
                // 1. 获取服务器脚本的绝对路径
                const serverScriptPath = path.join(context.extensionPath, 'mcp-server', 'dist', 'server.js');
                // 2. 处理路径分隔符，确保在 JSON 字符串中正确转义
                const escapedServerScriptPath = serverScriptPath.replace(/\\/g, '\\\\');
                // 3. 定义默认端口 (硬编码)
                const defaultPort = 6677; // TODO: 未来应从配置或服务器动态获取
                // 4. 生成 RooCode/Cline 配置对象 (mcp_settings.json 格式)
                const mcpConfig = { // 修改变量名
                    mcpServers: {
                        "vscode-debugger-mcp": {
                            command: "node",
                            args: [ escapedServerScriptPath ],
                            env: {}
                        }
                    }
                };
                // 5. 将配置对象转换为格式化的 JSON 字符串
                const configString = JSON.stringify(mcpConfig, null, 2); // 修改变量名
                // 6. 复制到剪贴板
                await vscode.env.clipboard.writeText(configString);
                // 7. 显示成功提示
                vscode.window.showInformationMessage('MCP server configuration (RooCode/Cline format) copied to clipboard!'); // 修改提示信息
                console.log('MCP config (RooCode/Cline format) copied:', configString); // 修改日志信息
            } catch (error) {
                console.error('Failed to copy MCP config (RooCode/Cline format):', error); // 修改错误日志
                vscode.window.showErrorMessage(`Failed to copy MCP config (RooCode/Cline format): ${error instanceof Error ? error.message : String(error)}`); // 修改错误提示
            }
        }
        ```

4.  **添加菜单项 (`src/extension.ts`)**
    *   在 `showServerActionMenu` 函数中，向 `items` 数组添加一个新的 `ActionQuickPickItem`。
    *   `label`: `$(clippy) Copy MCP Config (RooCode/Cline)` (修改)
    *   `description`: `Copy MCP server config (RooCode/Cline format)` (修改)
    *   `action`: `() => vscode.commands.executeCommand('DebugMcpManager.copyMcpConfig')` (修改)
    *   *代码变更示例:*
        ```diff
        --- a/src/extension.ts
        +++ b/src/extension.ts
        @@ -58,6 +58,14 @@
         		} as ActionQuickPickItem);
         	}

+           // 添加复制 MCP 配置 (RooCode/Cline 格式) 的菜单项
+           items.push({
+               label: "$(clippy) Copy MCP Config (RooCode/Cline)", // 修改
+               description: "Copy MCP server config (RooCode/Cline format)", // 修改
+               action: () => vscode.commands.executeCommand('DebugMcpManager.copyMcpConfig') // 修改
+           } as ActionQuickPickItem);
+
         	// 添加一个始终显示的状态信息项
         	items.push({
         		 label: `Current Status: ${status}`,
        ```

**后续考虑:**
*   **端口动态化:** 当服务器实现端口监听和配置后，需要修改 `copyMcpConfigHandler` 以动态获取实际端口号。
*   **配置持久化:** 如果未来允许用户配置端口，需要从 VS Code 配置读取。
*   **多客户端支持:** 可能需要添加更多菜单项和配置生成逻辑。
*   **错误处理:** 完善 `copyMcpConfigHandler` 中的错误处理。
*   **代码重构:** 考虑提取公共函数或通过 `mcpServerManager` 实例获取路径。