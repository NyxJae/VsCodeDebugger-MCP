好的，我们现在来专门为你整理一份关于 **VS Code 调试 API** 的文档。这份文档将聚焦于如何**通过插件代码来控制和交互 VS Code 的调试功能**，这正是你的 VsCode Debugger 工具组所需要的基础。

我们将跳过如何调试你 *自己* 的插件代码（这在上一份文档的“运行和调试插件”部分已提及），而是专注于如何让你的插件成为一个“调试协调者”，响应来自 MCP 服务器（或其他来源）的指令来操作 VS Code 的调试器。

---

## VS Code 调试 API 指南 (为 VsCode Debugger 插件定制)

### 1. 概述

VS Code 提供了一套强大的 API (`vscode.debug`)，允许插件以编程方式与内置的调试功能进行交互。你的插件需要利用这套 API 来实现 VsCode Debugger 工具组定义的各种能力，例如启动调试会话、设置断点、单步执行、检查变量等。

**核心目标:** 让你的插件能够代表 AI 代理（通过 MCP 服务器）向 VS Code 的调试系统发出指令，并获取调试状态信息。

**关键概念:**

*   **调试会话 (`DebugSession`):** 代表一个活动的调试过程（无论是通过 "launch" 启动的还是 "attach" 附加的）。你的插件将主要与这个对象交互来控制调试。
*   **调试配置 (`DebugConfiguration`):** 定义在 `launch.json` 文件中的设置，描述了如何启动一个调试会话（例如，要运行哪个程序、使用哪个调试器类型、传递什么参数）。
*   **断点 (`Breakpoint`, `SourceBreakpoint`, `FunctionBreakpoint`):** 代码中设置的暂停点。插件可以添加、移除和查询断点。
*   **Debug Adapter Protocol (DAP):** VS Code 调试功能的基础协议。虽然你的插件主要通过 `vscode.debug` API 交互，但理解 DAP 的基本概念（如请求 `continue`, `next`, `scopes`, `variables` 等）有助于理解 `DebugSession.customRequest` 的用法。你的插件实际上是在通过 VS Code API 向底层的 *Debug Adapter* 发送 DAP 请求。
*   **调试适配器追踪器 (`DebugAdapterTracker`):** 一个关键机制，允许你的插件**监听**特定调试会话中发送和接收的 DAP 消息。这对于**响应调试器事件**（如 `stopped` 事件）至关重要。

### 2. 关键 API (`vscode.debug`) 详解

#### 2.1 管理调试会话

*   **启动调试 (`vscode.debug.startDebugging`)**
    *   **用途:** 根据 `launch.json` 中的配置名称或一个完整的 `DebugConfiguration` 对象来启动一个新的调试会话或附加到现有进程。
    *   **签名:**
        ```typescript
        vscode.debug.startDebugging(
            folder: vscode.WorkspaceFolder | undefined, // 目标工作区文件夹，通常是当前活动的
            nameOrConfiguration: string | vscode.DebugConfiguration // launch.json 中的配置名称或配置对象
        ): Thenable<boolean>; // 返回一个 Promise，表示启动请求是否成功发送
        ```
    *   **示例 (对应 `start_debugging` 工具):**
        ```typescript
        import * as vscode from 'vscode';

        async function startDebugSession(configName: string) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showErrorMessage("No workspace folder open.");
                return false;
            }
            const folder = workspaceFolders[0]; // 假设使用第一个工作区文件夹

            try {
                const success = await vscode.debug.startDebugging(folder, configName);
                if (success) {
                    vscode.window.showInformationMessage(`Debugging session "${configName}" started successfully.`);
                    // 注意：这只表示启动请求已发送，并不意味着程序已运行或已停止。
                    // 你需要使用 DebugAdapterTracker 来监听后续事件。
                } else {
                    vscode.window.showErrorMessage(`Failed to start debugging session "${configName}". Check launch configuration.`);
                }
                return success;
            } catch (error: any) {
                vscode.window.showErrorMessage(`Error starting debugging: ${error.message}`);
                return false;
            }
        }

        // 在你的命令处理函数或 MCP 请求处理逻辑中调用:
        // await startDebugSession("Python: 当前文件");
        ```
    *   **注意:** `startDebugging` 本身是**异步**的，但它返回的 `boolean` 仅表示启动 *请求* 是否被 VS Code 接受。它**不**等待调试器实际启动、运行或停止。你需要结合事件监听（见下文）来了解会话的真实状态。

*   **停止调试 (`vscode.debug.stopDebugging`)**
    *   **用途:** 停止当前活动的调试会话，或者指定一个特定的会话来停止。
    *   **签名:**
        ```typescript
        vscode.debug.stopDebugging(session?: vscode.DebugSession): Thenable<void>;
        ```
    *   **示例 (对应 `stop_debugging` 工具):**
        ```typescript
        import * as vscode from 'vscode';

        async function stopDebugSession() {
            if (vscode.debug.activeDebugSession) {
                await vscode.debug.stopDebugging(vscode.debug.activeDebugSession);
                vscode.window.showInformationMessage("Debugging session stopped.");
            } else {
                vscode.window.showWarningMessage("No active debugging session to stop.");
            }
        }

        // 调用: await stopDebugSession();
        ```

*   **获取活动会话 (`vscode.debug.activeDebugSession`)**
    *   **用途:** 获取当前用户正在交互的调试会话。如果没有活动会话，则为 `undefined`。
    *   **类型:** `vscode.DebugSession | undefined`
    *   **示例:**
        ```typescript
        const currentSession = vscode.debug.activeDebugSession;
        if (currentSession) {
            console.log(`Active debug session: ${currentSession.name} (Type: ${currentSession.type}, ID: ${currentSession.id})`);
            // 可以用 currentSession.id 或 currentSession 本身来操作特定会话
        }
        ```

*   **监听会话生命周期事件**
    *   `vscode.debug.onDidStartDebugSession((session: vscode.DebugSession) => { ... })`: 当一个新的调试会话成功启动时触发。
    *   `vscode.debug.onDidTerminateDebugSession((session: vscode.DebugSession) => { ... })`: 当一个调试会话结束时（正常完成、被停止或出错）触发。
    *   `vscode.debug.onDidChangeActiveDebugSession((session: vscode.DebugSession | undefined) => { ... })`: 当活动调试会话改变时（例如，用户切换了调试目标，或者会话开始/结束）触发。
    *   **示例:**
        ```typescript
        context.subscriptions.push(vscode.debug.onDidStartDebugSession(session => {
            console.log(`Debug session started: ${session.name}`);
            // 在这里可以注册 DebugAdapterTracker (见后文)
            registerTrackerForSession(session);
        }));

        context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(session => {
            console.log(`Debug session terminated: ${session.name}`);
            // 清理与该会话相关的资源
            cleanupTrackerForSession(session);
            // 通知 MCP 服务器会话已结束
            notifyMcpSessionTerminated(session.id);
        }));
        ```

#### 2.2 管理断点

*   **添加断点 (`vscode.debug.addBreakpoints`)**
    *   **用途:** 以编程方式添加一个或多个断点。
    *   **签名:**
        ```typescript
        vscode.debug.addBreakpoints(breakpoints: ReadonlyArray<vscode.Breakpoint>): Thenable<void>;
        ```
    *   **示例 (对应 `set_breakpoint` 工具):**
        ```typescript
        import * as vscode from 'vscode';

        async function addSourceBreakpoint(filePath: string, lineNumber: number, condition?: string, hitCondition?: string, logMessage?: string) {
            const uri = vscode.Uri.file(filePath); // 将文件路径转换为 Uri
            const position = new vscode.Position(lineNumber - 1, 0); // 行号基于 0，列号暂设为 0
            const location = new vscode.Location(uri, position);

            const breakpoint = new vscode.SourceBreakpoint(
                location,
                true, // enabled
                condition,
                hitCondition,
                logMessage
            );

            try {
                await vscode.debug.addBreakpoints([breakpoint]);
                vscode.window.showInformationMessage(`Breakpoint added at ${filePath}:${lineNumber}`);
                // 注意：这里无法直接获取新断点的 ID 和 verified 状态。
                // 需要通过 get_breakpoints 或 DebugAdapterTracker 监听 breakpoint 事件来获取。
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to add breakpoint: ${error.message}`);
            }
        }

        // 调用: await addSourceBreakpoint("/path/to/file.py", 42, "count > 10");
        ```

*   **移除断点 (`vscode.debug.removeBreakpoints`)**
    *   **用途:** 移除一个或多个断点。
    *   **签名:**
        ```typescript
        vscode.debug.removeBreakpoints(breakpoints: ReadonlyArray<vscode.Breakpoint>): Thenable<void>;
        ```
    *   **示例 (对应 `remove_breakpoint` 工具):**
        ```typescript
        import * as vscode from 'vscode';

        // 移除需要 Breakpoint 对象，通常先通过 vscode.debug.breakpoints 获取
        async function removeBreakpointById(breakpointIdToRemove: string) { // 断点 ID 通常是字符串
            const bpToRemove = vscode.debug.breakpoints.find(bp => bp.id === breakpointIdToRemove);
            if (bpToRemove) {
                try {
                    await vscode.debug.removeBreakpoints([bpToRemove]);
                    vscode.window.showInformationMessage(`Breakpoint ${breakpointIdToRemove} removed.`);
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Failed to remove breakpoint ${breakpointIdToRemove}: ${error.message}`);
                }
            } else {
                vscode.window.showWarningMessage(`Breakpoint with ID ${breakpointIdToRemove} not found.`);
            }
        }

        async function removeAllBreakpoints() {
             try {
                 await vscode.debug.removeBreakpoints(vscode.debug.breakpoints); // 传入所有当前断点
                 vscode.window.showInformationMessage(`All breakpoints removed.`);
             } catch (error: any) {
                 vscode.window.showErrorMessage(`Failed to remove all breakpoints: ${error.message}`);
             }
        }

        // 调用: await removeBreakpointById("some-internal-id-123");
        // 调用: await removeAllBreakpoints();
        ```

*   **获取所有断点 (`vscode.debug.breakpoints`)**
    *   **用途:** 获取当前 VS Code 中所有已设置断点的只读列表。
    *   **类型:** `ReadonlyArray<Breakpoint>`
    *   **示例 (对应 `get_breakpoints` 工具):**
        ```typescript
        import * as vscode from 'vscode';

        function getAllBreakpointsInfo() {
            const currentBreakpoints = vscode.debug.breakpoints;
            const breakpointInfos = currentBreakpoints.map(bp => {
                let info: any = {
                    id: bp.id, // 注意：Breakpoint 基类没有 id，需要类型断言
                    enabled: bp.enabled,
                    condition: bp.condition,
                    hitCondition: bp.hitCondition,
                    logMessage: bp.logMessage,
                };
                if (bp instanceof vscode.SourceBreakpoint) {
                    info.type = 'source';
                    info.filePath = bp.location.uri.fsPath;
                    info.lineNumber = bp.location.range.start.line + 1; // 转为 1-based
                } else if (bp instanceof vscode.FunctionBreakpoint) {
                    info.type = 'function';
                    info.functionName = bp.functionName;
                }
                // 注意：'verified' 状态不是 Breakpoint API 的一部分，
                // 它通常是 Debug Adapter 在运行时更新的状态，
                // 需要通过 DebugAdapterTracker 监听 'breakpoint' 事件获取。
                return info;
            });
            console.log("Current Breakpoints:", breakpointInfos);
            return breakpointInfos; // 返回给 MCP 服务器
        }

        // 调用: const bps = getAllBreakpointsInfo();
        ```

#### 2.3 控制执行和检查状态 (通过 `DebugSession.customRequest`)

当调试器暂停时，你需要向当前的 `DebugSession` 发送 DAP 命令来控制执行（继续、单步）或查询状态（调用栈、作用域、变量）。这通过 `customRequest` 方法完成。

*   **`DebugSession.customRequest(command: string, args?: any): Thenable<any>`**
    *   **用途:** 向此调试会话关联的 Debug Adapter 发送一个原始的 DAP 请求。
    *   **`command`:** DAP 请求的名称 (例如 `"continue"`, `"next"`, `"stepIn"`, `"stepOut"`, `"stackTrace"`, `"scopes"`, `"variables"`, `"evaluate"`)。
    *   **`args`:** 请求所需的参数对象 (参考 DAP 规范)。
    *   **返回值:** 一个 Promise，解析为 Debug Adapter 对该请求的响应。响应的结构也遵循 DAP 规范。

*   **示例 (对应 `continue_debugging` 工具):**
    ```typescript
    async function continueExecution(sessionId: string, threadId: number) {
        const session = vscode.debug.activeDebugSession; // 或者通过 ID 查找会话
        if (session && session.id === sessionId) {
            try {
                const response = await session.customRequest('continue', { threadId: threadId });
                console.log('Continue request sent. Response:', response);
                // 成功发送请求。现在需要等待 DebugAdapterTracker 报告下一个 'stopped' 事件。
                return { status: "pending" }; // 表示命令已发送，等待结果
            } catch (error: any) {
                console.error('Failed to send continue request:', error);
                return { status: "error", message: error.message };
            }
        } else {
            return { status: "error", message: "Active debug session not found or ID mismatch." };
        }
    }
    // 调用: await continueExecution(activeSession.id, currentThreadId);
    ```

*   **示例 (对应 `step_execution` 工具 - Step Over):**
    ```typescript
    async function stepOver(sessionId: string, threadId: number) {
        const session = vscode.debug.activeDebugSession;
        if (session && session.id === sessionId) {
            try {
                // DAP 命令是 'next'
                const response = await session.customRequest('next', { threadId: threadId });
                console.log('Step Over (next) request sent. Response:', response);
                // 等待 DebugAdapterTracker 报告下一个 'stopped' 事件。
                return { status: "pending" };
            } catch (error: any) {
                console.error('Failed to send step over request:', error);
                return { status: "error", message: error.message };
            }
        } else {
             return { status: "error", message: "Active debug session not found or ID mismatch." };
        }
    }
    // 调用: await stepOver(activeSession.id, currentThreadId);
    // 类似地实现 stepIn (command: 'stepIn') 和 stepOut (command: 'stepOut')
    ```

*   **示例 (获取调用栈 - 对应 `stop_event_data.call_stack` 的来源):**
    ```typescript
    async function getStackTrace(sessionId: string, threadId: number): Promise<any> {
        const session = vscode.debug.activeDebugSession;
        if (session && session.id === sessionId) {
            try {
                const response = await session.customRequest('stackTrace', { threadId: threadId, startFrame: 0, levels: 20 }); // 获取最多 20 帧
                console.log('Stack Trace Response:', response);
                // response.stackFrames 包含了调用栈信息 [{ id, name, source, line, column }, ...]
                // 你需要将这个原始 DAP 响应转换为你的 stop_event_data.call_stack 格式
                return { status: "success", stackFrames: response.stackFrames };
            } catch (error: any) {
                console.error('Failed to get stack trace:', error);
                return { status: "error", message: error.message };
            }
        } else {
             return { status: "error", message: "Active debug session not found or ID mismatch." };
        }
    }
    // 调用: const stackData = await getStackTrace(activeSession.id, currentThreadId);
    ```

*   **示例 (获取作用域 - 对应 `get_scopes` 工具):**
    ```typescript
    async function getScopes(sessionId: string, frameId: number): Promise<any> {
        const session = vscode.debug.activeDebugSession;
        if (session && session.id === sessionId) {
            try {
                const response = await session.customRequest('scopes', { frameId: frameId });
                console.log('Scopes Response:', response);
                // response.scopes 包含了作用域列表 [{ name, variablesReference, expensive, ... }]
                // 转换为你的工具所需格式
                return { status: "success", scopes: response.scopes };
            } catch (error: any) {
                console.error('Failed to get scopes:', error);
                return { status: "error", message: error.message };
            }
        } else {
             return { status: "error", message: "Active debug session not found or ID mismatch." };
        }
    }
    // 调用: const scopesData = await getScopes(activeSession.id, currentFrameId);
    ```

*   **示例 (获取变量 - 对应 `get_variables` 工具):**
    ```typescript
    async function getVariables(sessionId: string, variablesReference: number): Promise<any> {
        const session = vscode.debug.activeDebugSession;
        if (session && session.id === sessionId) {
            try {
                const response = await session.customRequest('variables', { variablesReference: variablesReference });
                console.log('Variables Response:', response);
                // response.variables 包含了变量列表 [{ name, value, type, variablesReference, ... }]
                // 转换为你的工具所需格式
                return { status: "success", variables: response.variables };
            } catch (error: any) {
                console.error('Failed to get variables:', error);
                return { status: "error", message: error.message };
            }
        } else {
             return { status: "error", message: "Active debug session not found or ID mismatch." };
        }
    }
    // 调用: const varsData = await getVariables(activeSession.id, scopeVariablesReference);
    ```

*   **示例 (求值表达式 - 对应 `evaluate_expression` 工具):**
    ```typescript
    async function evaluateExpression(sessionId: string, frameId: number, expression: string, context: 'watch' | 'repl' | 'hover' = 'watch'): Promise<any> {
        const session = vscode.debug.activeDebugSession;
        if (session && session.id === sessionId) {
            try {
                const response = await session.customRequest('evaluate', { expression: expression, frameId: frameId, context: context });
                console.log('Evaluate Response:', response);
                // response 包含了结果 { result, type, variablesReference, ... }
                return { status: "success", result: response.result, type: response.type, variablesReference: response.variablesReference };
            } catch (error: any) {
                console.error('Failed to evaluate expression:', error);
                // 错误响应通常也在 error.message 中包含 DAP 的错误信息
                return { status: "error", message: error.message };
            }
        } else {
             return { status: "error", message: "Active debug session not found or ID mismatch." };
        }
    }
    // 调用: const evalResult = await evaluateExpression(activeSession.id, currentFrameId, "myVar * 2");
    ```

#### 2.4 响应调试器事件 (使用 `DebugAdapterTracker`)

你的 VsCode Debugger 工具组中的异步工具（`start_debugging`, `continue_debugging`, `step_execution`）需要在调试器**停止**时才能返回结果。VS Code 插件**不能**直接监听一个简单的 `onDidStop` 事件。你需要使用 `DebugAdapterTracker` 来拦截和处理来自 Debug Adapter 的 DAP 事件，特别是 `stopped` 事件。

*   **注册追踪器工厂 (`vscode.debug.registerDebugAdapterTrackerFactory`)**
    *   **用途:** 为特定类型的调试会话（或所有会话 `*`）注册一个工厂。当该类型的调试会话启动时，VS Code 会调用这个工厂的 `createDebugAdapterTracker` 方法。
    *   **签名:**
        ```typescript
        vscode.debug.registerDebugAdapterTrackerFactory(
            debugType: string, // 调试类型 (e.g., 'python', 'node', '*')
            factory: vscode.DebugAdapterTrackerFactory
        ): vscode.Disposable;
        ```
    *   **`DebugAdapterTrackerFactory` 接口:**
        ```typescript
        interface DebugAdapterTrackerFactory {
            createDebugAdapterTracker(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterTracker>;
        }
        ```
    *   **`DebugAdapterTracker` 接口:**
        ```typescript
        interface DebugAdapterTracker {
            onWillStartSession?(): void;
            onWillStopSession?(): void;
            onWillReceiveMessage?(message: any): void; // 拦截发往 DA 的消息
            onDidSendMessage?(message: any): void;    // 拦截来自 DA 的消息 (事件和响应)
            onError?(error: Error): void;
            onExit?(code: number | undefined, signal: string | undefined): void;
        }
        ```

*   **示例 (监听 `stopped` 事件):**
    ```typescript
    import * as vscode from 'vscode';

    // 存储每个会话的 tracker 实例和状态
    const sessionTrackers = new Map<string, MyDebugTracker>();

    class MyDebugTracker implements vscode.DebugAdapterTracker {
        private sessionId: string;
        private resolveStopPromise?: (stopEvent: any) => void; // 用于解决等待停止的 Promise

        constructor(session: vscode.DebugSession) {
            this.sessionId = session.id;
            console.log(`Tracker created for session: ${session.name} (${this.sessionId})`);
        }

        // 关键：监听来自 Debug Adapter 的消息
        onDidSendMessage(message: any): void {
            // console.log(`[${this.sessionId}] DA -> VSCode:`, JSON.stringify(message, null, 2));

            // 检查是否是 'stopped' 事件
            if (message.type === 'event' && message.event === 'stopped') {
                console.log(`[${this.sessionId}] Stopped event received! Reason: ${message.body.reason}`);
                const stopEventBody = message.body;

                // 如果有正在等待停止的 Promise，解决它
                if (this.resolveStopPromise) {
                    this.resolveStopPromise(stopEventBody);
                    this.resolveStopPromise = undefined; // 重置
                } else {
                    // 如果没有等待的 Promise，可能需要将事件通知给 MCP 服务器
                    // (例如，用户在 VS Code UI 中点击了暂停)
                    notifyMcpUnexpectedStop(this.sessionId, stopEventBody);
                }

                // --- 在这里可以触发获取调用栈、顶层变量等操作 ---
                // 注意：获取这些信息需要发送 customRequest，这本身是异步的
                // 你需要设计好如何将这些信息与 stopEventBody 组合成你的 stop_event_data
                processStopEvent(this.sessionId, stopEventBody);
            }

            // 还可以监听其他事件，如 'output', 'terminated', 'breakpoint' 等
            if (message.type === 'event' && message.event === 'terminated') {
                 console.log(`[${this.sessionId}] Terminated event received.`);
                 // 确保清理状态
                 cleanupTrackerForSession(vscode.debug.getSession(this.sessionId)); // 获取 session 对象
            }

             if (message.type === 'event' && message.event === 'breakpoint') {
                 console.log(`[${this.sessionId}] Breakpoint event received:`, message.body);
                 // 可以用来更新断点的 'verified' 状态
                 updateBreakpointStatus(this.sessionId, message.body.breakpoint);
             }
        }

        // 监听发往 Debug Adapter 的消息 (可选)
        onWillReceiveMessage(message: any): void {
            // console.log(`[${this.sessionId}] VSCode -> DA:`, JSON.stringify(message));
        }

        onWillStopSession(): void {
            console.log(`[${this.sessionId}] Tracker stopping.`);
            cleanupTrackerForSession(vscode.debug.getSession(this.sessionId));
        }

        onError(error: Error): void {
            console.error(`[${this.sessionId}] Tracker error:`, error);
            // 通知 MCP 服务器出错
            notifyMcpError(this.sessionId, `Tracker error: ${error.message}`);
        }

        onExit(code: number | undefined, signal: string | undefined): void {
            console.log(`[${this.sessionId}] Debug adapter exited. Code: ${code}, Signal: ${signal}`);
            // 通常意味着调试会话非正常结束
             notifyMcpError(this.sessionId, `Debug adapter exited unexpectedly (Code: ${code}, Signal: ${signal})`);
        }

        // 方法：让异步工具 (continue, step) 等待下一次停止
        waitForStop(): Promise<any> {
            return new Promise((resolve) => {
                this.resolveStopPromise = resolve;
                // TODO: 添加超时机制
            });
        }
    }

    // 在 activate 函数中注册工厂
    export function activate(context: vscode.ExtensionContext) {
        // ... 其他 activate 代码 ...

        context.subscriptions.push(vscode.debug.registerDebugAdapterTrackerFactory('*', { // 监听所有类型的调试会话
            createDebugAdapterTracker(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterTracker> {
                const tracker = new MyDebugTracker(session);
                sessionTrackers.set(session.id, tracker);
                return tracker;
            }
        }));

        // ... 注册命令等 ...
    }

    // 清理函数
    function cleanupTrackerForSession(session: vscode.DebugSession | undefined) {
        if (session && sessionTrackers.has(session.id)) {
            console.log(`Cleaning up tracker for session ${session.id}`);
            sessionTrackers.delete(session.id);
            // 可能还需要重置与该会话相关的插件状态
        }
    }

    // --- 如何使用 Tracker ---
    // 在你的 continue_debugging 或 step_execution 实现中:
    async function continueAndWaitForStop(sessionId: string, threadId: number) {
        const tracker = sessionTrackers.get(sessionId);
        const session = vscode.debug.getSession(sessionId);

        if (!tracker || !session) {
            return { status: "error", message: "Session or tracker not found." };
        }

        try {
            // 1. 发送 continue 命令
            await session.customRequest('continue', { threadId: threadId });
            console.log(`[${sessionId}] Continue request sent, waiting for stop...`);

            // 2. 等待 Tracker 捕获到 stopped 事件
            const stopEventBody = await tracker.waitForStop(); // 这个 Promise 由 tracker.onDidSendMessage 解决

            // 3. (可选) 捕获到停止后，立即获取调用栈和顶层变量
            const stackTraceResponse = await session.customRequest('stackTrace', { threadId: stopEventBody.threadId ?? threadId, levels: 1 }); // 只取顶层帧
            let topFrameVariables = null;
            if (stackTraceResponse.stackFrames && stackTraceResponse.stackFrames.length > 0) {
                const topFrameId = stackTraceResponse.stackFrames[0].id;
                const scopesResponse = await session.customRequest('scopes', { frameId: topFrameId });
                // 假设第一个 scope 是 'Locals'
                if (scopesResponse.scopes && scopesResponse.scopes.length > 0) {
                     const localsRef = scopesResponse.scopes[0].variablesReference;
                     const variablesResponse = await session.customRequest('variables', { variablesReference: localsRef });
                     topFrameVariables = {
                         scope_name: scopesResponse.scopes[0].name,
                         variables: variablesResponse.variables // 需要转换格式
                     };
                }
            }


            // 4. 构建并返回你的 stop_event_data
            const stopEventData = buildStopEventData(stopEventBody, stackTraceResponse.stackFrames, topFrameVariables); // 你需要实现这个转换函数
            return { status: "stopped", stop_event_data: stopEventData };

        } catch (error: any) {
            console.error(`[${sessionId}] Error during continue/wait:`, error);
            return { status: "error", message: error.message };
        }
    }

    // 你需要实现 buildStopEventData, notifyMcp*, processStopEvent, updateBreakpointStatus 等辅助函数
    // 来处理与 MCP 服务器的通信和状态管理。
    ```

#### 2.5 获取调试配置

你的 `get_debugger_configurations` 工具需要读取 `launch.json`。虽然 `vscode.debug` API 主要用于 *运行时* 交互，但你可以通过 `vscode.workspace.getConfiguration` 来读取配置。

```typescript
import * as vscode from 'vscode';

function getLaunchConfigurations() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return { status: "error", message: "No workspace folder open." };
    }
    const folder = workspaceFolders[0]; // 假设处理第一个文件夹

    // 读取 'launch' 配置节
    const launchConfig = vscode.workspace.getConfiguration('launch', folder.uri);

    // 获取 'configurations' 数组
    const configurations = launchConfig.get<vscode.DebugConfiguration[]>('configurations');

    if (configurations) {
        // 过滤掉可能不完整的配置，并提取所需信息
        const validConfigs = configurations.filter(c => c.name && c.type && c.request).map(c => ({
            name: c.name,
            type: c.type,
            request: c.request,
            // 可以选择性地包含其他属性
            program: c.program,
            args: c.args,
            // ... 其他你关心的属性
        }));
        return { status: "success", configurations: validConfigs };
    } else {
        return { status: "error", message: "Could not find 'configurations' in launch.json." };
    }
}

// 调用: const configsResult = getLaunchConfigurations();
```

### 3. 重要注意事项

*   **异步性:** 几乎所有 `vscode.debug` API 调用和 `customRequest` 都是异步的，返回 `Thenable` (Promise)。务必使用 `async/await` 正确处理。
*   **错误处理:** `customRequest` 可能会因为 DAP 错误（例如，无效参数、调试器状态不正确）而 reject。必须使用 `try...catch` 捕获这些错误并将其转换为你的工具可以理解的错误消息。
*   **状态管理:** 你的插件需要维护当前调试会话的状态（ID、类型、是否暂停、当前线程 ID、当前帧 ID 等）。`DebugAdapterTracker` 是获取实时事件的关键，但你仍需在每次交互后更新内部状态。
*   **`threadId` 和 `frameId`:** 控制执行和检查状态的操作通常需要 `threadId`。检查作用域、变量和求值表达式需要 `frameId`。这些 ID 通常从 `stopped` 事件的 `body` 或 `stackTrace` 请求的响应中获取。
*   **DAP 规范:** 虽然你通过 VS Code API 交互，但了解 DAP 请求和响应的结构对于使用 `customRequest` 和解析 `DebugAdapterTracker` 接收到的消息非常有帮助。
*   **资源清理:** 确保在 `deactivate` 函数和 `onDidTerminateDebugSession` / `onWillStopSession` 中清理所有与调试相关的资源，特别是注销 `DebugAdapterTracker` 和移除事件监听器。

---

这份文档应该为你提供了足够的基础，让你能够开始在你的 VS Code 插件中实现 VsCode Debugger 工具组所需的核心调试交互逻辑。关键在于理解如何使用 `vscode.debug.startDebugging`, `stopDebugging`, `add/removeBreakpoints` 以及如何通过 `DebugSession.customRequest` 发送 DAP 命令，并利用 `DebugAdapterTrackerFactory` 来响应调试器的 `stopped` 事件。