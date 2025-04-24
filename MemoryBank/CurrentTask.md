## 任务上下文
### mcp-server/src/toolProviders/debug/continueDebugging.ts

该文件定义了 `continue_debugging` 工具。当前 `session_id` 被定义为必需参数。

```typescript
 6 | const ContinueDebuggingParamsSchema = z.object({
 7 |     session_id: z.string().describe("目标调试会话的 ID。必须由 AI Agent 提供。"), // <--- 修改：添加并设为必需
 8 |     thread_id: z.number().int().describe("需要恢复执行的线程的 ID。"),
 9 | });
...
20 |     description: "当调试器暂停时，命令指定线程恢复执行，并等待下一次暂停或结束。需要提供 session_id。",
21 |     inputSchema: ContinueDebuggingParamsSchema,
...
25 |             // --- 修改：直接从参数获取 sessionId ---
26 |             const { session_id: sessionId, thread_id: threadId } = params;
27 |             // --- 移除对 getCurrentActiveSessionId 的调用 ---
28 |             // const activeSessionId = getCurrentActiveSessionId(); // 移除
29 |             // if (!activeSessionId) { // 移除
30 |             //     return { status: "error", message: "当前没有活动的调试会话。" }; // 移除
31 |             // }
...
40 |                     sessionId: sessionId,
41 |                     threadId: threadId,
42 |                 }
### mcp-server/src/toolProviders/debug/stepExecution.ts

该文件定义了 `step_execution` 工具。当前输入参数 Schema 中没有 `session_id`。

```typescript
 9 | const StepExecutionParamsSchema = z.object({
10 |     thread_id: z.number().int().describe('需要执行单步操作的线程的 ID (从 stop_event_data.thread_id 获取)。'),
11 |     step_type: z.enum(['over', 'into', 'out']).describe("指定单步执行的具体类型: 'over', 'into', 'out'。")
12 | });
...
31 |     async execute(params: StepExecutionParams): Promise<z.infer<typeof AsyncDebugResultSchema>> { // <--- 修改参数类型和返回类型
32 |         try {
33 |             console.log(`[MCP Tool] Executing ${TOOL_NAME_STEP_EXECUTION} with params:`, params); // <--- 直接使用 params
...
39 |                     payload: params // <--- 直接传递 params 作为 payload
### mcp-server/src/types.ts

该文件定义了 MCP 服务器使用的各种类型，包括工具的参数类型。

```typescript
51 | // continueDebugging 参数
52 | export interface ContinueDebuggingParams {
53 |     session_id: string; // <--- 修改：添加 session_id
54 |     thread_id: number;
55 | }
...
127 | // step_execution 请求参数 (从 MCP Server 发来)
128 | /**
129 |  * step_execution 工具的输入参数类型
130 |  */
131 | export interface StepExecutionParams {
132 |   /**
133 |    * 需要执行单步操作的线程的 ID (从 stop_event_data.thread_id 获取)。
134 |    */
135 |   thread_id: number;
136 |   /**
137 |    * 指定单步执行的具体类型: 'over', 'into', 'out'。
138 |    */
139 |   step_type: 'over' | 'into' | 'out';
140 | }
### Docs/Doc_Debug_Tools.md

该文档描述了调试工具的规格。其中 `continue_debugging` 和 `step_execution` 工具的输入参数部分需要修改以反映 `session_id` 的可选性。

```markdown
76 | ### 4.6 `continue_debugging` (继续)
77 |
78 | *   **目的:** 当调试器当前处于暂停状态时，命令其恢复执行。程序将继续运行，直到遇到下一个断点、发生未捕获的异常、程序自然结束，或者被其他方式再次暂停。
79 | *   **类型:** 异步工具。
80 | *   **输入参数:**
81 |     *   `session_id` (必需, string): 当前调试会话的唯一 ID。此 ID 必须从之前的 `start_debugging` 工具调用成功后的响应，或任何返回 `status: "stopped"` 的工具响应中的 `stop_event_data.session_id` 获取。
82 |     *   `thread_id` (必需, number): 需要恢复执行的线程的 ID。这个 ID 通常从上一次 `status: "stopped"` 返回的 `stop_event_data.thread_id` 中获取。对于单线程应用，可能只有一个线程 ID；对于多线程应用，需要指定要操作的线程。
...
90 | ### 4.7 `step_execution` (执行单步)
91 |
92 | *   **目的:** 当调试器当前处于暂停状态时，命令其执行一次精细控制的单步操作。根据指定的类型（步过、步入、步出），执行一小段代码后再次暂停。
93 | *   **类型:** 异步工具。
94 | *   **输入参数:**
95 |     *   `thread_id` (必需, number): 需要执行单步操作的线程的 ID。这个 ID 通常从上一次 `status: "stopped"` 返回的 `stop_event_data.thread_id` 中获取。
96 |     *   `step_type` (必需, string): 指定单步执行的具体类型。必须是以下三个值之一：
97 |         *   `"over"`: **步过 (Step Over)**。执行当前行代码。如果当前行包含函数调用，则执行整个函数调用，然后暂停在源代码中的下一行（同一函数内或调用者函数中）。
98 |         *   `"into"`: **步入 (Step Into)**。如果当前行包含函数调用，则进入该函数内部，并暂停在被调用函数的第一个可执行语句上。如果当前行不包含函数调用，则行为类似于步过。
99 |         *   `"out"`: **步出 (Step Out)**。继续执行当前函数的剩余部分，直到函数返回。然后暂停在调用该函数的语句之后的那一行代码上。
### src/vscode/debugSessionManager.ts

该文件负责管理 VS Code 调试会话。其中包含了获取当前活动调试会话的方法。

```typescript
45 |             const session = vscode.debug.activeDebugSession?.id === sessionId ? vscode.debug.activeDebugSession : undefined; // 确保是活动会话
...
88 |             const session = vscode.debug.activeDebugSession?.id === sessionId ? vscode.debug.activeDebugSession : undefined;
...
457 |     public stopDebugging(sessionId?: string): void {
458 |         let sessionToStop: vscode.DebugSession | undefined;
459 |         if (sessionId) {
460 |             sessionToStop = vscode.debug.activeDebugSession?.id === sessionId ? vscode.debug.activeDebugSession : undefined;
461 |             if (!sessionToStop) {
462 |                  console.warn(`[DebugSessionManager] Session ${sessionId} not found or not active.`);
463 |             }
464 |         } else {
465 |             sessionToStop = vscode.debug.activeDebugSession;
466 |         }
```
从代码中可以看出，`vscode.debug.activeDebugSession` 可以获取当前活动的调试会话。
### mcp-server/src/toolProviders/debug/index.ts

该文件负责导出调试工具。

```typescript
1 | // mcp-server/src/toolProviders/debug/index.ts
2 | export * from './getConfigurations';
3 | export * from './setBreakpoint';
4 | export * from './getBreakpoints';
5 | export * from './removeBreakpoint';
6 | export * from './startDebugging'; // 新增导出 startDebugging 相关内容
7 | export * from './continueDebugging'; // 新增导出
8 | export { stepExecutionTool } from './stepExecution'; // 导出 stepExecutionTool (使用命名导出)
9 | // 确保导出了所有需要被外部使用的函数、类型和 Schema
## 任务规划

**目标:** 优化 `continue_debugging` 和 `step_execution` 工具，使 `session_id` 参数变为可选。如果未提供，则自动获取并使用当前活动的 VS Code 调试会话 ID。

**1. 修改文件列表:**

*   `mcp-server/src/toolProviders/debug/continueDebugging.ts`
*   `mcp-server/src/toolProviders/debug/stepExecution.ts`
*   `mcp-server/src/types.ts`
*   `src/vscode/debuggerApiWrapper.ts` (可能需要调整以接收 sessionId)
*   `Docs/Doc_Debug_Tools.md`

**2. 具体修改步骤:**

**2.1 `mcp-server/src/toolProviders/debug/continueDebugging.ts`**

*   **修改 Schema 定义:** 将 `session_id` 设为可选。
    ```typescript
    // 找到 ContinueDebuggingParamsSchema 定义
    const ContinueDebuggingParamsSchema = z.object({
        // session_id: z.string().describe("目标调试会话的 ID。必须由 AI Agent 提供。"), // 旧代码
        session_id: z.string().optional().describe("目标调试会话的 ID。如果省略，将尝试使用当前活动的调试会话。"), // 新代码
        thread_id: z.number().int().describe("需要恢复执行的线程的 ID。"),
    });
    ```
*   **修改 `execute` 方法逻辑:** 获取 `session_id`，如果未提供则尝试获取活动会话 ID。
    ```typescript
    import * as vscode from 'vscode'; // 确保导入 vscode
    // ... 其他导入
    import { ContinueDebuggingParams, AsyncDebugResultSchema } from '../../types'; // 确保导入类型

    // ... tool 定义

    async execute(params: ContinueDebuggingParams): Promise<z.infer<typeof AsyncDebugResultSchema>> {
        try {
            console.log(`[MCP Tool] Executing ${TOOL_NAME_CONTINUE_DEBUGGING} with params:`, params);

            let sessionId = params.session_id;
            const threadId = params.thread_id;

            // 如果 session_id 未提供，尝试获取当前活动会话 ID
            if (!sessionId) {
                const activeSession = vscode.debug.activeDebugSession;
                if (activeSession) {
                    sessionId = activeSession.id;
                    console.log(`[MCP Tool] No session_id provided, using active session: ${sessionId}`);
                } else {
                    console.error('[MCP Tool] Error: No session_id provided and no active debug session found.');
                    return { status: "error", message: "未提供 session_id，且当前没有活动的调试会话。" };
                }
            }

            // 检查 sessionId 是否有效 (虽然上面已处理，双重保险)
            if (!sessionId) {
                 console.error('[MCP Tool] Error: Invalid session ID after attempting to find active session.');
                 return { status: "error", message: "无法确定有效的调试会话 ID。" };
            }

            // --- 调用 VS Code API ---
            // 注意：这里的调用需要确保 debuggerApiWrapper.continueDebugging 接收 sessionId
            const result = await debuggerApiWrapper.continueDebugging(sessionId, threadId);

            console.log(`[MCP Tool] ${TOOL_NAME_CONTINUE_DEBUGGING} execution result:`, result);
            return result; // 直接返回 DebuggerApiWrapper 的结果

        } catch (error: any) {
            console.error(`[MCP Tool] Error executing ${TOOL_NAME_CONTINUE_DEBUGGING}:`, error);
            return { status: "error", message: `执行 continue_debugging 时出错: ${error.message}` };
        }
    }
    // ...
    ```

**2.2 `mcp-server/src/toolProviders/debug/stepExecution.ts`**

*   **修改 Schema 定义:** 添加可选的 `session_id`。
    ```typescript
    const StepExecutionParamsSchema = z.object({
        session_id: z.string().optional().describe("目标调试会话的 ID。如果省略，将尝试使用当前活动的调试会话。"), // 新增
        thread_id: z.number().int().describe('需要执行单步操作的线程的 ID (从 stop_event_data.thread_id 获取)。'),
        step_type: z.enum(['over', 'into', 'out']).describe("指定单步执行的具体类型: 'over', 'into', 'out'。")
    });
    ```
*   **修改 `execute` 方法逻辑:** 获取 `session_id`（同 `continueDebugging`），并将 `sessionId` 传递给底层 API。
    ```typescript
    import * as vscode from 'vscode'; // 确保导入 vscode
    // ... 其他导入
    import { StepExecutionParams, AsyncDebugResultSchema } from '../../types'; // 确保导入类型

    // ... tool 定义

    async execute(params: StepExecutionParams): Promise<z.infer<typeof AsyncDebugResultSchema>> {
        try {
            console.log(`[MCP Tool] Executing ${TOOL_NAME_STEP_EXECUTION} with params:`, params);

            let sessionId = params.session_id;
            const threadId = params.thread_id;
            const stepType = params.step_type;

            // 如果 session_id 未提供，尝试获取当前活动会话 ID
            if (!sessionId) {
                const activeSession = vscode.debug.activeDebugSession;
                if (activeSession) {
                    sessionId = activeSession.id;
                    console.log(`[MCP Tool] No session_id provided, using active session: ${sessionId}`);
                } else {
                    console.error('[MCP Tool] Error: No session_id provided and no active debug session found.');
                    return { status: "error", message: "未提供 session_id，且当前没有活动的调试会话。" };
                }
            }

            // 检查 sessionId 是否有效
            if (!sessionId) {
                 console.error('[MCP Tool] Error: Invalid session ID after attempting to find active session.');
                 return { status: "error", message: "无法确定有效的调试会话 ID。" };
            }

            // --- 调用 VS Code API ---
            // 注意：这里的调用需要确保 debuggerApiWrapper.stepExecution 接收 sessionId
            const result = await debuggerApiWrapper.stepExecution(sessionId, threadId, stepType);

            console.log(`[MCP Tool] ${TOOL_NAME_STEP_EXECUTION} execution result:`, result);
            return result; // 直接返回 DebuggerApiWrapper 的结果

        } catch (error: any) {
            console.error(`[MCP Tool] Error executing ${TOOL_NAME_STEP_EXECUTION}:`, error);
            return { status: "error", message: `执行 step_execution 时出错: ${error.message}` };
        }
    }
    // ...
    ```

**2.3 `mcp-server/src/types.ts`**

*   **修改 `ContinueDebuggingParams` 接口:**
    ```typescript
    export interface ContinueDebuggingParams {
        // session_id: string; // 旧代码
        session_id?: string; // 新代码: 设为可选
        thread_id: number;
    }
    ```
*   **修改 `StepExecutionParams` 接口:**
    ```typescript
    export interface StepExecutionParams {
        session_id?: string; // 新增: 可选的 session_id
        thread_id: number;
        step_type: 'over' | 'into' | 'out';
    }
    ```

**2.4 `src/vscode/debuggerApiWrapper.ts` (潜在修改)**

*   **检查并可能修改 `continueDebugging` 方法签名:** 确保它接收 `sessionId: string` 作为第一个参数。
    ```typescript
    // 示例，具体实现可能不同
    public async continueDebugging(sessionId: string, threadId: number): Promise<AsyncDebugResult> {
        // ... 内部逻辑使用 sessionId 和 threadId 调用 vscode.debug.activeDebugSession.customRequest('continue', ...) 或类似方法
    }
    ```
*   **检查并可能修改 `stepExecution` 方法签名:** 确保它接收 `sessionId: string` 作为第一个参数。
    ```typescript
    // 示例，具体实现可能不同
    public async stepExecution(sessionId: string, threadId: number, stepType: 'over' | 'into' | 'out'): Promise<AsyncDebugResult> {
        // ... 内部逻辑使用 sessionId, threadId, stepType 调用 vscode.debug.activeDebugSession.customRequest('next'/'stepIn'/'stepOut', ...) 或类似方法
    }
    ```
    *注意:* 需要仔细检查 `debuggerApiWrapper.ts` 中这两个函数的当前实现，确保 `sessionId` 被正确用于查找和操作目标调试会话。可能需要使用 `vscode.debug.sessions.find(s => s.id === sessionId)` 来获取特定的会话对象，而不是总是依赖 `vscode.debug.activeDebugSession`。

**3. 更新文档 (`Docs/Doc_Debug_Tools.md`)**

*   **修改 `4.6 continue_debugging` 输入参数:**
    ```markdown
    *   **输入参数:**
        *   `session_id` (可选, string): 目标调试会话的唯一 ID。如果省略，工具将自动尝试使用当前活动的调试会话。如果提供了此 ID，则必须是从之前的 `start_debugging` 工具调用成功后的响应，或任何返回 `status: "stopped"` 的工具响应中的 `stop_event_data.session_id` 获取。
        *   `thread_id` (必需, number): 需要恢复执行的线程的 ID。这个 ID 通常从上一次 `status: "stopped"` 返回的 `stop_event_data.thread_id` 中获取。
    ```
*   **修改 `4.7 step_execution` 输入参数:**
    ```markdown
    *   **输入参数:**
        *   `session_id` (可选, string): 目标调试会话的唯一 ID。如果省略，工具将自动尝试使用当前活动的调试会话。如果提供了此 ID，则必须是从之前的 `start_debugging` 工具调用成功后的响应，或任何返回 `status: "stopped"` 的工具响应中的 `stop_event_data.session_id` 获取。
        *   `thread_id` (必需, number): 需要执行单步操作的线程的 ID。这个 ID 通常从上一次 `status: "stopped"` 返回的 `stop_event_data.thread_id` 中获取。
        *   `step_type` (必需, string): 指定单步执行的具体类型。必须是以下三个值之一：
            *   `"over"`: **步过 (Step Over)**...
            *   `"into"`: **步入 (Step Into)**...
            *   `"out"`: **步出 (Step Out)**...
    ```

**4. (可选) 建议的测试步骤:**

1.  启动一个调试会话。
2.  **测试 `continue_debugging` (无 session_id):** 调用 `continue_debugging` 工具，只提供 `thread_id`。预期：调试器应继续执行，并可能在下一个断点停止或结束。
3.  **测试 `continue_debugging` (有 session_id):** 暂停调试器，获取当前 `session_id` 和 `thread_id`。调用 `continue_debugging` 工具，提供这两个 ID。预期：调试器应继续执行。
4.  **测试 `step_execution` (无 session_id):** 暂停调试器，获取 `thread_id`。调用 `step_execution` 工具，提供 `thread_id` 和 `step_type`。预期：调试器应执行相应的单步操作。
5.  **测试 `step_execution` (有 session_id):** 暂停调试器，获取当前 `session_id` 和 `thread_id`。调用 `step_execution` 工具，提供 `session_id`, `thread_id`, 和 `step_type`。预期：调试器应执行相应的单步操作。
6.  **测试无活动会话:** 确保没有活动的调试会话。调用 `continue_debugging` 或 `step_execution`（不提供 `session_id`）。预期：工具应返回 `status: "error"`，并提示没有活动会话。
7.  **测试无效 session_id:** 调用 `continue_debugging` 或 `step_execution`，提供一个无效或已结束的 `session_id`。预期：工具应返回 `status: "error"`。

**5. 后续步骤:**

*   将此任务规划交给 `coder` 执行代码修改。
*   `coder` 完成后，进行测试验证。
*   (如果需要) 创建 `new_task` 给 `docer` 更新 `Docs/Doc_Debug_Tools.md` (如果 `coder` 未完成此步骤)。