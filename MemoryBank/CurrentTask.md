# 当前任务规划

## 任务目标
根据已收集的上下文信息，为 `stop_debugging` 工具制定详细的开发任务规划，指导后续编码工作。

## 任务上下文
- @/MemoryBank/ProjectBrief.md
- @/Docs/Doc_Debug_Tools.md
- @/src/vscode/debuggerApiWrapper.ts
- @/src/vscode/debugSessionManager.ts
- @/mcp-server/src/toolProviders/debug/index.ts
- @/mcp-server/src/server.ts
- @/Docs/Doc_VsCode_Debug.md
- @/Docs/Doc_MCP_README.md
- @/Docs/Doc_Project_Structure.md
- mcp-server/src/constants.ts:15
- src/constants.ts:15
- src/managers/ipcHandler.ts:70
- src/managers/ipcHandler.ts:149
- src/managers/ipcHandler.ts:181

### `handleRequestFromMCP` 函数代码 (`src/mcpServerManager.ts`)

```typescript
    private async handleRequestFromMCP(request: PluginRequest): Promise<PluginResponse> {
        const { command, requestId, payload } = request;
        let responsePayload: any = null;
        let status: typeof Constants.IPC_STATUS_SUCCESS | typeof Constants.IPC_STATUS_ERROR = Constants.IPC_STATUS_SUCCESS;
        let errorMessage: string | undefined = undefined;

        this.outputChannel.appendLine(`[Coordinator] Handling MCP request: ${requestId} - Command: ${command}`);

        try {
            switch (command) {
                case Constants.IPC_COMMAND_GET_CONFIGURATIONS:
                    responsePayload = { configurations: this.debuggerApiWrapper.getDebuggerConfigurations() };
                    break;
                case Constants.IPC_COMMAND_SET_BREAKPOINT:
                    responsePayload = await this.debuggerApiWrapper.addBreakpoint(payload);
                    break;
                case Constants.IPC_COMMAND_GET_BREAKPOINTS:
                    responsePayload = { breakpoints: this.debuggerApiWrapper.getBreakpoints(), timestamp: new Date().toISOString() };
                    break;
                case Constants.IPC_COMMAND_REMOVE_BREAKPOINT:
                    responsePayload = await this.debuggerApiWrapper.removeBreakpoint(payload);
                    break;
                case Constants.IPC_COMMAND_START_DEBUGGING_REQUEST: // 注意常量名称
                    responsePayload = await this.debuggerApiWrapper.startDebuggingAndWait(payload.configurationName, payload.noDebug ?? false);
                    break;
                case Constants.IPC_COMMAND_CONTINUE_DEBUGGING: { // 使用块作用域
                    this.outputChannel.appendLine(`[Coordinator] Handling 'continue_debugging' request: ${requestId}`);
                    const continueParams = payload as ContinueDebuggingParams;
                    let sessionIdToUse = continueParams.sessionId;

                    if (!sessionIdToUse) {
                        const activeSession = vscode.debug.activeDebugSession;
                        if (activeSession) {
                            sessionIdToUse = activeSession.id;
                            this.outputChannel.appendLine(`[Coordinator] No sessionId provided for continue, using active session: ${sessionIdToUse}`);
                        } else {
                            throw new Error('无法继续执行：未提供 session_id 且当前没有活动的调试会话。');
                        }
                    }
                    // 调用 DebuggerApiWrapper，此时 sessionIdToUse 必为 string
                    responsePayload = await this.debuggerApiWrapper.continueDebuggingAndWait(sessionIdToUse, continueParams.threadId);
                    this.outputChannel.appendLine(`[Coordinator] 'continue_debugging' result for ${requestId}: ${JSON.stringify(responsePayload)}`);
                    break;
                }
                case Constants.IPC_COMMAND_STEP_EXECUTION: { // 使用块作用域
                    this.outputChannel.appendLine(`[Coordinator] Handling '${Constants.IPC_COMMAND_STEP_EXECUTION}' request: ${requestId}`);
                    const stepParams = payload as StepExecutionParams;
                    let sessionIdToUse = stepParams.sessionId;

                    if (!sessionIdToUse) {
                        const activeSession = vscode.debug.activeDebugSession;
                        if (activeSession) {
                            sessionIdToUse = activeSession.id;
                            this.outputChannel.appendLine(`[Coordinator] No sessionId provided for step, using active session: ${sessionIdToUse}`);
                        } else {
                            throw new Error('无法执行单步操作：未提供 session_id 且当前没有活动的调试会话。');
                        }
                    }
                    // 调用 DebuggerApiWrapper 处理单步执行，此时 sessionIdToUse 必为 string
                    responsePayload = await this.debuggerApiWrapper.stepExecutionAndWait(sessionIdToUse, stepParams.thread_id, stepParams.step_type);
                    this.outputChannel.appendLine(`[Coordinator] '${Constants.IPC_COMMAND_STEP_EXECUTION}' result for ${requestId}: ${JSON.stringify(responsePayload)}`);
                    break;
                }
                default:
                    throw new Error(`不支持的命令: ${command}`);
            }
        } catch (error: any) {
            console.error(`[Coordinator] Error handling MCP request ${requestId} (${command}):`, error);
            this.outputChannel.appendLine(`[Coordinator Error] Handling MCP request ${requestId} (${command}): ${error.message}\n${error.stack}`);
            status = Constants.IPC_STATUS_ERROR;
            errorMessage = error.message || '处理请求时发生未知错误';
            // 对于特定错误类型，可以设置不同的 responsePayload
            if (responsePayload && typeof responsePayload === 'object' && responsePayload.status === Constants.IPC_STATUS_ERROR) {
                // 如果 DebuggerApiWrapper 返回的就是错误状态，直接使用它的 message
                errorMessage = responsePayload.message || errorMessage;
            }
            responsePayload = undefined; // 错误时 payload 为 undefined
        }

        return {
            type: Constants.IPC_MESSAGE_TYPE_RESPONSE,
            requestId,
            status,
            payload: status === Constants.IPC_STATUS_SUCCESS ? responsePayload : undefined,
            // 确保 errorMessage 始终是 string
            error: status === Constants.IPC_STATUS_ERROR ? { message: errorMessage || '发生未知错误' } : undefined,
        };
    }
```

### 分析处理逻辑

`handleRequestFromMCP` 函数通过一个 `switch` 语句根据接收到的 `command` 字段来路由请求。它明确列出了支持的命令，包括获取配置、设置/获取/移除断点、启动调试、继续执行和单步执行。对于任何不在这些 `case` 中的命令，函数会进入 `default` 分支并抛出一个错误，错误消息中包含 "不支持的命令"。

这表明 `handleRequestFromMCP` 函数实现了一个基于白名单的命令处理机制。`vscode-debugger-mcp:stopDebugging` 命令不在当前的白名单中，因此会被 `default` 分支拒绝，导致出现 "不支持的命令" 错误。这与日志分析结果一致，错误确实发生在 `mcpServerManager.ts` 的 `handleRequestFromMCP` 函数内部，因为它没有针对 `stopDebugging` 命令的 `case` 分支。

## 任务规划 (更新于 2025-04-24)

**目标:** 实现 `stop_debugging` MCP 工具，允许 AI 代理通过 MCP 服务器停止 VS Code 中的调试会话。**此工具将接受一个可选的 `session_id` 参数**，以保持与其他调试工具的一致性。如果未提供 `session_id`，则默认停止当前活动的调试会话。

**涉及文件:**

*   **创建:**
    *   `mcp-server/src/toolProviders/debug/stopDebugging.ts` (已存在，需修改)
*   **修改:**
    *   `mcp-server/src/toolProviders/debug/stopDebugging.ts`
    *   `mcp-server/src/toolProviders/debug/index.ts` (无需修改，`export *` 已包含)
    *   `mcp-server/src/server.ts`
    *   `mcp-server/src/constants.ts` (无需修改，常量已存在)
    *   `src/vscode/debuggerApiWrapper.ts`
    *   `src/managers/ipcHandler.ts`
    *   `src/constants.ts` (无需修改，常量已存在)
    *   `src/types.ts` (可能需要添加或修改 IPC 消息类型)
    *   `mcp-server/src/types.ts` (可能需要添加或修改 IPC 消息类型)

**实现步骤:**

1.  **类型定义 (`src/types.ts` 和 `mcp-server/src/types.ts`):**
    *   (可选但推荐) 在两个 `types.ts` 文件中定义或更新 `StopDebuggingPayload` 接口，包含可选的 `sessionId`:
      ```typescript
      export interface StopDebuggingPayload {
        sessionId?: string;
      }
      ```

2.  **修改 MCP 工具处理函数 (`mcp-server/src/toolProviders/debug/stopDebugging.ts`):**
    *   导入 `StopDebuggingPayload` 类型 (如果已定义)。
    *   修改 `stopDebuggingSchema` 以接受可选的 `sessionId`:
      ```typescript
      export const stopDebuggingSchema = z.object({
        sessionId: z.string().optional(),
      });
      ```
    *   修改 `handleStopDebugging` 函数签名以匹配新的 schema:
      ```typescript
      export async function handleStopDebugging(
          args: z.infer<typeof stopDebuggingSchema> // 或者 args: StopDebuggingPayload
      ): Promise<{ status: string; message: string }> { ... }
      ```
    *   在 `handleStopDebugging` 内部，修改 `sendRequestToPlugin` 调用，将 `sessionId` (如果存在) 包含在 payload 中：
      ```typescript
      const response: PluginResponse = await sendRequestToPlugin({
           command: Constants.IPC_COMMAND_STOP_DEBUGGING,
           payload: { sessionId: args.sessionId } // 传递 sessionId
      });
      ```

3.  **修改 MCP 工具注册 (`mcp-server/src/server.ts`):**
    *   确保导入的是更新后的 `stopDebuggingSchema`。
    *   在 `server.tool()` 调用中，确认使用的是 `stopDebuggingSchema.shape`。
    *   传递给 `handleStopDebugging` 的 `args` 参数会自动包含从 MCP 客户端接收到的 `sessionId` (如果提供)，因此调用 `await handleStopDebugging(args)` 的逻辑通常**无需**修改。

4.  **修改插件端 API 封装 (`src/vscode/debuggerApiWrapper.ts`):**
    *   `stopDebugging` 方法的签名 `public async stopDebugging(sessionId?: string)` **无需**修改，因为它已经接受可选的 `sessionId`。
    *   调用 `this.debugSessionManager.stopDebugging(sessionId)` 的逻辑**无需**修改。

5.  **修复并修改插件端 IPC 命令处理 (`src/managers/ipcHandler.ts`):**
    *   **关键修复:** 在 `handleIncomingMessage` 函数的 `switch (command)` 语句中，**添加**处理 `Constants.IPC_COMMAND_STOP_DEBUGGING` 的 `case` 分支。之前的错误日志显示此分支缺失。
    *   在新增的 `case Constants.IPC_COMMAND_STOP_DEBUGGING:` 块中：
        *   从 `message.payload` 中提取可选的 `sessionId`：
      ```typescript
      const payloadData = message.payload as StopDebuggingPayload | undefined; // 使用类型断言
      const sessionId = payloadData?.sessionId;
      console.log(`[IpcHandler] stopDebugging: Received sessionId: ${sessionId}`); // 添加日志
      ```
        *   调用 `debuggerApiWrapper.stopDebugging` 时传递提取到的 `sessionId`：
      ```typescript
      const result = await this.debuggerApiWrapper.stopDebugging(sessionId);
      ```
        *   使用 `this.sendResponseToServer` 将 `result` 发送回 MCP 服务器，确保正确处理成功和失败状态，并传递 `message`。参考规划中之前的示例代码进行实现。
        *   添加 `try...catch` 块来捕获调用 `stopDebugging` 时可能发生的同步错误。

**错误处理考虑:**

*   **MCP 服务器:** `handleStopDebugging` 捕获通信错误。
*   **插件端:**
    *   `DebuggerApiWrapper.stopDebugging` 捕获 `debugSessionManager` 的错误。
    *   `IpcHandler` 处理 `debuggerApiWrapper` 返回的错误。
    *   `DebugSessionManager.stopDebugging` 需要能正确处理传入的 `sessionId` (如果提供了无效 ID，应能优雅处理或报错)。

**代码示例 (示意修改部分):**

*   `mcp-server/src/toolProviders/debug/stopDebugging.ts`:
    ```typescript
    // ... imports ...
    import { StopDebuggingPayload } from '../../types'; // Assuming type is defined

    export const stopDebuggingSchema = z.object({
      sessionId: z.string().optional(),
    });

    export async function handleStopDebugging(
        args: z.infer<typeof stopDebuggingSchema> // or args: StopDebuggingPayload
    ): Promise<{ status: string; message: string }> {
        console.log('[MCP Server] handleStopDebugging called with args:', args);
        try {
            const response: PluginResponse = await sendRequestToPlugin({
                 command: Constants.IPC_COMMAND_STOP_DEBUGGING,
                 payload: { sessionId: args.sessionId } // Pass sessionId
            });
            // ... rest of the handler ...
        } catch (error: any) {
            // ... error handling ...
        }
    }
    ```

*   `src/managers/ipcHandler.ts` (添加 case 分支):
    ```typescript
    // ... imports ...
    import { StopDebuggingPayload } from '../types'; // Assuming type is defined
    import * as Constants from '../constants'; // 确保导入常量

    // ... inside handleIncomingMessage switch (command) ...
    case Constants.IPC_COMMAND_STOP_DEBUGGING: // **确保添加此 case**
        try {
            const payloadData = message.payload as StopDebuggingPayload | undefined;
            const sessionId = payloadData?.sessionId;
            console.log(`[IpcHandler] Handling '${Constants.IPC_COMMAND_STOP_DEBUGGING}'. SessionId: ${sessionId}`);
            if (!this.debuggerApiWrapper) throw new Error('DebuggerApiWrapper not initialized'); // 防御性检查

            const stopResult = await this.debuggerApiWrapper.stopDebugging(sessionId);
            console.log('[IpcHandler] stopDebugging result:', stopResult);

            this.sendResponseToServer(
                requestId,
                stopResult.status as typeof Constants.IPC_STATUS_SUCCESS | typeof Constants.IPC_STATUS_ERROR, // 类型断言
                stopResult.message ? { message: stopResult.message } : undefined,
                stopResult.status === Constants.IPC_STATUS_ERROR ? { message: stopResult.message || '停止调试时发生未知错误' } : undefined
            );
        } catch (error: any) {
            console.error(`[IpcHandler] Error handling ${Constants.IPC_COMMAND_STOP_DEBUGGING}:`, error);
            this.sendResponseToServer(requestId, Constants.IPC_STATUS_ERROR, undefined, { message: `处理停止调试命令时发生内部错误: ${error.message}` });
        }
        break; // **确保添加 break**
    // ... 其他 case ...
    ```

**后续步骤:**

1.  编码者根据**再次更新后**的此规划，**重点修复** `src/managers/ipcHandler.ts` 中缺失的 `case` 分支。
2.  进行测试，调用 `stop_debugging` 工具（带和不带 `session_id`），确认不再出现 "不支持的命令" 错误，并且功能按预期工作。
3.  测试通过后，再进行最终的代码审查。
4.  （可选）更新相关文档。