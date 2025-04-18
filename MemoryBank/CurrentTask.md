## 任务上下文
- src/mcpServerManager.ts (服务器管理相关代码)
  - 启动服务器: 35-140行 (包含端口检测和错误处理)
  - 停止服务器: 145-190行
  - 插件停用清理: 234-238行
  - 复制配置: 195-229行 (需要修改以使用持久化端口)
- mcp-server/src/server.ts (MCP服务器实现)
  - 端口监听和EADDRINUSE错误处理: 118-177行
  - 默认端口: 12行
- src/statusBarManager.ts (状态栏管理)
  - 显示状态和端口: 66-93行 (需要修改以使用持久化端口)
- src/extension.ts (插件入口和生命周期)
  - 插件激活: 13-39行 (需要修改以读取持久化端口并在启动时使用)
  - 插件停用: 96-100行
  - Quick Pick菜单: 42-93行 (需要添加更改端口的选项)
- Docs/Doc_MCP.md (MCP服务器文档)
  - 客户端配置指南 (mcp_settings.json): 666-711行 (需要更新配置格式)
  - 服务器启停机制: 755-777行
- Docs/Doc_Common.md (通用文档)
  - 项目代码文件概览: 4-45行
- c:/Users/Administrator/AppData/Roaming/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json (客户端配置示例)
  - 当前使用SSE配置，需要修改为stdio配置并包含端口信息

## VS Code API 参考
- `vscode.window.showInformationMessage`: 用于显示通知消息，可以包含按钮。
  - src/test/extension.test.ts: 9行
  - src/mcpServerManager.ts: 147行, 218行
- `vscode.window.showInputBox`: 用于显示输入框，获取用户输入。
  - 未在当前项目中找到使用示例，需要查阅VS Code API文档。
- `ExtensionContext.globalState`: 用于插件全局持久化存储。
  - 未在当前项目中找到使用示例，需要查阅VS Code API文档。

## Node.js 端口检测
- 在mcp-server/src/server.ts中通过监听HTTP服务器的'error'事件并检查错误码'EADDRINUSE'来检测端口占用。

## 任务规划：处理端口占用并持久化端口设置 (V2 - 详细版)

**目标:** 实现 VS Code 插件在启动 MCP 服务器时，对端口占用进行检测和用户交互处理，并将用户选择的端口进行全局持久化，确保插件各部分功能使用一致的端口。

**核心流程图:**

```mermaid
graph TD
    subgraph 插件端 (VS Code Extension)
        A[启动服务器请求] --> B(获取持久化端口 P_stored 或默认端口 P_default);
        B --> C{检测端口 P_target 是否被占用?};
        C --> |否| D[传递 P_target 启动 MCP 服务器进程];
        D --> E{服务器启动成功?};
        E --> |是| F[更新状态栏: Running (Port: P_target)];
        E --> |否| G[更新状态栏: Error, 提示错误];
        C --> |是| H[显示通知: "端口 P_target 被占用"];
        H -- 点击 "输入新端口" --> I[显示 InputBox 获取新端口 P_new];
        I --> J{P_new 是否有效?};
        J --> |是| K[持久化存储 P_new];
        K --> L{检测端口 P_new 是否被占用?};
        L --> |否| M[传递 P_new 启动 MCP 服务器进程];
        M --> N{服务器启动成功?};
        N --> |是| O[更新状态栏: Running (Port: P_new)];
        N --> |否| P[更新状态栏: Error, 提示错误];
        L --> |是| Q[显示错误通知: "新端口 P_new 仍被占用"];
        Q --> R[更新状态栏: Stopped/Error];
        J --> |否 (无效/取消)| R;
        H -- 关闭通知 --> R;
    end

    subgraph 服务器端 (mcp-server)
        S[插件启动进程时传递端口 P_passed] --> T(读取 P_passed);
        T --> U{启动 HTTP 服务器监听 P_passed};
        U --> |成功| V[向 stdout 输出成功信息及端口];
        U --> |失败 (EADDRINUSE等)| W[向 stderr 输出错误信息];
    end

    D --> S;
    M --> S;
    V --> E; % 插件端捕获成功信息
    W --> E; % 插件端捕获错误信息
```

**实施步骤:**

**1. 准备工作与工具函数 (新建 `src/utils/portUtils.ts` 或类似文件)**

*   **常量定义:**
    *   `DEFAULT_MCP_PORT = 6009`: 默认端口号。
    *   `MCP_PORT_KEY = 'mcpServerPort'`: 全局状态存储键。
*   **端口校验函数:**
    *   `isValidPort(port: number | string): boolean`: 检查输入是否为 1024-65535 范围内的有效数字。
    ```typescript
    // 示例: src/utils/portUtils.ts
    export function isValidPort(port: number | string): boolean {
        const num = Number(port);
        return Number.isInteger(num) && num > 1024 && num <= 65535;
    }
    ```
*   **端口检测函数:**
    *   `isPortInUse(port: number): Promise<boolean>`: 使用 Node.js `net` 模块异步检测端口是否被占用。
    ```typescript
    // 示例: src/utils/portUtils.ts
    import * as net from 'net';

    export function isPortInUse(port: number): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const server = net.createServer();
            server.once('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    resolve(true); // 端口被占用
                } else {
                    reject(err); // 其他错误
                }
            });
            server.once('listening', () => {
                server.close(() => {
                    resolve(false); // 端口可用
                });
            });
            server.listen(port);
        });
    }
    ```

**2. 持久化端口管理 (`src/extension.ts` 或 `src/configManager.ts`)**

*   **获取/存储端口:**
    *   `getStoredPort(context: vscode.ExtensionContext): number`: 读取全局状态，无效则返回默认值。
    *   `storePort(context: vscode.ExtensionContext, port: number): Promise<void>`: 更新全局状态。
    ```typescript
    // 示例: src/configManager.ts
    import * as vscode from 'vscode';
    import { DEFAULT_MCP_PORT, MCP_PORT_KEY, isValidPort } from './utils/portUtils'; // 假设工具函数在此

    export function getStoredPort(context: vscode.ExtensionContext): number {
        const storedPort = context.globalState.get<number>(MCP_PORT_KEY);
        return storedPort && isValidPort(storedPort) ? storedPort : DEFAULT_MCP_PORT;
    }

    export async function storePort(context: vscode.ExtensionContext, port: number): Promise<void> {
        if (isValidPort(port)) {
            await context.globalState.update(MCP_PORT_KEY, port);
            console.log(`Stored new MCP port: ${port}`);
        } else {
            console.error(`Attempted to store invalid port: ${port}`);
            // 可以考虑抛出错误或显示通知
        }
    }
    ```
*   **在 `activate` 中传递 `context`:** 确保 `mcpServerManager` 和其他需要访问 `globalState` 的模块能获取到 `context`。

**3. 修改服务器启动逻辑 (`src/mcpServerManager.ts`)**

*   **注入 `context`:** 修改 `McpServerManager` 构造函数或方法以接收 `vscode.ExtensionContext`。
*   **重构 `startServer` 方法:**
    ```typescript
    // 伪代码: src/mcpServerManager.ts
    import { getStoredPort, storePort } from './configManager'; // 假设配置管理函数在此
    import { isPortInUse, isValidPort } from './utils/portUtils'; // 假设工具函数在此
    import * as vscode from 'vscode';
    import * as cp from 'child_process';

    export class McpServerManager {
        private context: vscode.ExtensionContext;
        private mcpServerProcess: cp.ChildProcess | null = null;
        private currentPort: number | null = null;
        // ... 其他属性和statusBarManager实例

        constructor(context: vscode.ExtensionContext, statusBarManager: StatusBarManager) {
            this.context = context;
            this.statusBarManager = statusBarManager;
            // ...
        }

        public async startServer(): Promise<void> {
            if (this.mcpServerProcess) {
                vscode.window.showInformationMessage('MCP 服务器已在运行。');
                return;
            }

            let targetPort = getStoredPort(this.context);
            let portAvailable = false;

            try {
                const inUse = await isPortInUse(targetPort);
                if (inUse) {
                    const newPort = await this.handlePortConflict(targetPort);
                    if (newPort !== null) {
                        targetPort = newPort; // 更新目标端口
                        // 再次检测新端口是否可用
                        const newPortInUse = await isPortInUse(targetPort);
                        if (!newPortInUse) {
                           portAvailable = true;
                        } else {
                            vscode.window.showErrorMessage(`新端口 ${targetPort} 仍然被占用。请检查或尝试其他端口。`);
                            this.statusBarManager.setStatus('Error', null); // 更新状态栏
                            return; // 无法启动
                        }
                    } else {
                        // 用户取消或输入无效，不启动服务器
                        this.statusBarManager.setStatus('Stopped', null); // 确保状态栏更新
                        return;
                    }
                } else {
                    portAvailable = true; // 原始端口可用
                }

                if (portAvailable) {
                    this.statusBarManager.setStatus('Starting', targetPort); // 更新状态栏为启动中
                    // 启动服务器进程，传递端口
                    const serverPath = vscode.Uri.joinPath(this.context.extensionUri, 'mcp-server', 'dist', 'server.js').fsPath; // 确保路径正确
                    const nodePath = process.execPath; // 使用当前 VS Code 的 Node.js 路径

                    // 传递端口给服务器进程 (使用环境变量示例)
                    const env = { ...process.env, MCP_PORT: targetPort.toString() };

                    this.mcpServerProcess = cp.spawn(nodePath, [serverPath], { env: env, stdio: ['pipe', 'pipe', 'pipe'] }); // 确保stdio设置正确以捕获输出

                    this.mcpServerProcess.stdout?.on('data', (data) => {
                        const output = data.toString();
                        console.log(`MCP Server stdout: ${output}`);
                        // **关键:** 检查服务器成功启动的特定输出
                        if (output.includes(`MCP Server listening on port ${targetPort}`)) {
                             this.currentPort = targetPort;
                             this.statusBarManager.setStatus('Running', this.currentPort);
                             vscode.window.showInformationMessage(`MCP 服务器已在端口 ${this.currentPort} 启动。`);
                        }
                    });

                    this.mcpServerProcess.stderr?.on('data', (data) => {
                        const errorOutput = data.toString();
                        console.error(`MCP Server stderr: ${errorOutput}`);
                        // 可以根据错误输出判断启动是否失败
                        // vscode.window.showErrorMessage(`启动 MCP 服务器失败: ${errorOutput}`);
                        // this.handleServerError(); // 调用错误处理
                    });

                    this.mcpServerProcess.on('error', (err) => {
                        console.error('Failed to start MCP server process:', err);
                        vscode.window.showErrorMessage(`启动 MCP 服务器进程失败: ${err.message}`);
                        this.handleServerError();
                    });

                    this.mcpServerProcess.on('close', (code) => {
                        console.log(`MCP server process exited with code ${code}`);
                        // 只有在非用户主动停止时才视为错误或意外关闭
                        if (this.mcpServerProcess) { // 检查是否是用户主动停止
                           this.handleServerError(`服务器进程意外退出，退出码: ${code}`);
                        }
                    });
                }
            } catch (error: any) {
                console.error('Error starting MCP server:', error);
                vscode.window.showErrorMessage(`启动 MCP 服务器时出错: ${error.message}`);
                this.statusBarManager.setStatus('Error', null);
            }
        }

        // 新增：处理端口冲突的函数
        private async handlePortConflict(occupiedPort: number): Promise<number | null> {
            const choice = await vscode.window.showWarningMessage(
                `MCP 服务器端口 ${occupiedPort} 已被占用。`,
                { modal: true }, // 模态对话框，阻止其他操作直到用户响应
                '输入新端口'
            );

            if (choice === '输入新端口') {
                const newPortStr = await vscode.window.showInputBox({
                    prompt: `请输入一个新的端口号 (1025-65535)，当前端口 ${occupiedPort} 被占用。`,
                    placeHolder: '例如: 6010',
                    validateInput: (value) => {
                        if (!value) return '端口号不能为空。';
                        if (!isValidPort(value)) {
                            return '请输入 1025 到 65535 之间的有效端口号。';
                        }
                        return null; // 验证通过
                    }
                });

                if (newPortStr) {
                    const newPort = parseInt(newPortStr, 10);
                    await storePort(this.context, newPort); // 持久化新端口
                    return newPort;
                }
            }
            // 用户取消或关闭通知
            vscode.window.showInformationMessage('MCP 服务器启动已取消。');
            return null;
        }

         // 新增或修改：统一的错误处理和状态重置
        private handleServerError(errorMessage?: string): void {
            if (errorMessage) {
               vscode.window.showErrorMessage(`MCP 服务器错误: ${errorMessage}`);
            }
            this.mcpServerProcess = null;
            this.currentPort = null;
            this.statusBarManager.setStatus('Error', null);
        }


        public stopServer(): void {
            if (this.mcpServerProcess) {
                console.log('Stopping MCP server...');
                const processToKill = this.mcpServerProcess;
                this.mcpServerProcess = null; // 先标记为 null，避免 close 事件触发 handleServerError
                this.currentPort = null;
                processToKill.kill(); // 发送 SIGTERM 信号
                this.statusBarManager.setStatus('Stopped', null);
                vscode.window.showInformationMessage('MCP 服务器已停止。');
            } else {
                vscode.window.showInformationMessage('MCP 服务器未在运行。');
            }
        }

        public copyMcpConfigToClipboard(): void {
            const portToUse = this.currentPort ?? getStoredPort(this.context); // 优先用当前运行端口，否则用存储端口
            const config = {
                // 根据实际需要生成配置，确保使用 portToUse
                // 示例 SSE 配置:
                transport: {
                    type: "sse",
                    url: `http://localhost:${portToUse}/mcp`
                }
                // 示例 Stdio 配置 (如果需要):
                // transport: {
                //     type: "stdio"
                // },
                // command: ["node", "path/to/mcp-server/dist/server.js", "--port", portToUse.toString()] // 示例命令行
            };
            const configString = JSON.stringify(config, null, 2);
            vscode.env.clipboard.writeText(configString);
            vscode.window.showInformationMessage(`MCP 配置已复制到剪贴板 (端口: ${portToUse})。`);
        }
        // ... 其他方法 (restartServer 等)
    }
    ```
*   **移除旧的端口占用处理:** 删除 `startServer` 中原有的 `EADDRINUSE` 错误处理和端口递增逻辑。

**4. 修改 MCP 服务器 (`mcp-server/src/server.ts`)**

*   **读取端口:**
    ```typescript
    // 示例: mcp-server/src/server.ts
    import http from 'http';
    import express from 'express';
    import { McpServer, SSEServerTransport } from '@modelcontextprotocol/sdk'; // 假设使用SSE

    // 从环境变量读取端口，提供默认值
    const DEFAULT_PORT = 6009; // 与插件端默认值保持一致或独立
    const port = parseInt(process.env.MCP_PORT || '', 10) || DEFAULT_PORT;

    const app = express();
    const server = http.createServer(app);
    const mcpServer = new McpServer();

    // 设置 SSE Transport
    const sseTransport = new SSEServerTransport(mcpServer, '/mcp'); // 假设端点是 /mcp
    sseTransport.attach(app); // 将 SSE 路由附加到 Express 应用

    // ... (注册你的 MCP 工具 providers)
    // mcpServer.registerToolProvider(...)

    server.listen(port, () => {
        // **关键:** 输出明确的成功信息，包含端口号
        console.log(`MCP Server listening on port ${port}`);
        console.log(`SSE endpoint available at http://localhost:${port}/mcp`);
    });

    server.on('error', (error) => {
        // 输出错误到 stderr，方便插件端捕获
        console.error(`MCP Server error: ${error.message}`);
        process.exit(1); // 发生错误时退出
    });
    ```
*   **移除服务器端端口重试:** 删除之前可能存在的 `EADDRINUSE` 错误处理和端口重试逻辑。

**5. 修改状态栏显示 (`src/statusBarManager.ts`)**

*   **更新 `setStatus` 方法:**
    ```typescript
    // 示例: src/statusBarManager.ts
    import * as vscode from 'vscode';

    export class StatusBarManager {
        private statusBarItem: vscode.StatusBarItem;

        constructor() {
            this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
            this.statusBarItem.command = 'extension.showServerActionMenu'; // 点击时触发的命令
            this.setStatus('Stopped', null); // 初始状态
            this.statusBarItem.show();
        }

        public setStatus(status: 'Starting' | 'Running' | 'Stopped' | 'Error', port: number | null): void {
            let text = 'Debug-MCP: ';
            let tooltip = 'MCP 服务器状态';
            let backgroundColor: vscode.ThemeColor | undefined = undefined;

            switch (status) {
                case 'Starting':
                    text += `Starting (Port: ${port ?? '...'})`;
                    tooltip = 'MCP 服务器正在启动...';
                    backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                    break;
                case 'Running':
                    text += `Running (Port: ${port})`;
                    tooltip = `MCP 服务器正在运行于端口 ${port}`;
                    backgroundColor = undefined; // 默认背景
                    break;
                case 'Stopped':
                    text += 'Stopped';
                    tooltip = 'MCP 服务器已停止';
                    backgroundColor = undefined;
                    break;
                case 'Error':
                    text += 'Error';
                    tooltip = 'MCP 服务器遇到错误';
                    backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                    break;
            }
            this.statusBarItem.text = text;
            this.statusBarItem.tooltip = tooltip;
            this.statusBarItem.backgroundColor = backgroundColor;
        }

        public dispose(): void {
            this.statusBarItem.dispose();
        }
    }
    ```

**6. 修改 Quick Pick 菜单 (`src/extension.ts`)**

*   **添加 "更改端口" 选项:**
    ```typescript
    // 示例: src/extension.ts (showServerActionMenu 函数内)
    import { getStoredPort, storePort } from './configManager'; // 假设配置管理函数在此
    import { isValidPort } from './utils/portUtils'; // 假设工具函数在此
    import * as vscode from 'vscode';

    // ... 其他 QuickPickItem

    const changePortItem: vscode.QuickPickItem & { action: () => Promise<void> } = {
        label: '$(gear) 更改服务器端口',
        description: `当前配置端口: ${getStoredPort(context)}`, // 显示当前存储的端口
        action: async () => {
            const currentPort = getStoredPort(context);
            const newPortStr = await vscode.window.showInputBox({
                prompt: `请输入新的 MCP 服务器端口号 (1025-65535)`,
                placeHolder: `当前: ${currentPort}`,
                value: currentPort.toString(), // 预填当前值
                validateInput: (value) => {
                    if (!value) return '端口号不能为空。';
                    if (!isValidPort(value)) {
                        return '请输入 1025 到 65535 之间的有效端口号。';
                    }
                    if (parseInt(value, 10) === currentPort) {
                        return '新端口不能与当前端口相同。';
                    }
                    return null;
                }
            });

            if (newPortStr) {
                const newPort = parseInt(newPortStr, 10);
                await storePort(context, newPort);
                vscode.window.showInformationMessage(`MCP 服务器端口已更新为 ${newPort}。更改将在下次服务器启动时生效。`);
                // 如果服务器正在运行，可以提示用户重启
                if (mcpServerManager.isRunning()) { // 假设 mcpServerManager 有 isRunning 方法
                     vscode.window.showInformationMessage('请重启 MCP 服务器以应用新的端口设置。', '立即重启').then(selection => {
                         if (selection === '立即重启') {
                             mcpServerManager.restartServer(); // 假设有 restartServer 方法
                         }
                     });
                }
            }
        }
    };

    items.push(changePortItem);

    // ... 后续显示 Quick Pick 的代码
    ```

**7. 文档更新 (创建新任务)**

*   **需要记录的内容:**
    *   端口持久化机制 (`ExtensionContext.globalState`, `MCP_PORT_KEY`)。
    *   端口占用时的通知和交互流程。
    *   如何在状态栏菜单中更改端口。
    *   服务器端如何接收端口（环境变量 `MCP_PORT`）。
    *   更新客户端配置示例 (`mcp_settings.json`)，强调端口配置。
*   **操作:** 使用 `<new_task>` 工具为 `docer` 模式创建一个新任务。

**注意事项:**

*   **错误处理:** 上述伪代码提供了一些基本的错误处理，实际实现中需要更健壮的错误捕获和用户提示。
*   **异步操作:** 大量使用了 `async/await`，确保正确处理 Promise。
*   **状态同步:** 确保 `McpServerManager` 中的 `currentPort` 和 `mcpServerProcess` 状态与实际情况一致，并在服务器启动、停止、出错时正确更新。
*   **依赖安装:** 如果引入了新的依赖（如 `express`），确保在 `mcp-server/package.json` 中添加并安装。
*   **路径问题:** 确保插件端启动服务器时使用的路径 (`serverPath`) 正确指向编译后的 `mcp-server/dist/server.js`。
*   **Node.js 版本:** 确保插件和服务器使用的 Node.js 版本兼容 `net` 模块和 `async/await`。

**下一步:**

在您确认此任务规划后，我将使用 `attempt_completion` 工具结束当前任务。后续的编码工作将由 "编码者" 角色根据此规划进行。