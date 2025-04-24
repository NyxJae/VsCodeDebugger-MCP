## 任务上下文 (已简化)
- **常量定义:**
    - `mcp-server/src/constants.ts`: `IPC_COMMAND_STEP_EXECUTION` 常量定义 (行 14)。
- **问题定位:**
    - `src/mcpServerManager.ts`: `handleRequestFromMCP` 方法 (行 145-170) 缺少处理 `IPC_COMMAND_STEP_EXECUTION` 的 case。
- **相关实现:**
    - `src/managers/ipcHandler.ts`: `handleIncomingMessage` 方法已包含处理 `IPC_COMMAND_STEP_EXECUTION` 的 case (行 112-130)。
    - `src/vscode/debuggerApiWrapper.ts`: 包含 `stepExecutionAndWait` 方法定义 (行 87-100)。
    - `src/vscode/debugSessionManager.ts`: 包含 `stepExecutionAndWait` 方法定义 (行 83-126)。
- **类型定义:**
    - `src/types.ts`: 定义了 `StepExecutionParams` (行 33-48) 和 `StepExecutionResult` (行 49-62) 类型。

## 任务规划

**目标:** 修复 `step_execution` 工具因 `mcpServerManager` 缺少命令处理 case 而导致的 "不支持的命令" 错误。

**主要步骤:**

1.  **修改 `src/mcpServerManager.ts`:**
    *   **导入所需类型和常量:**
        *   确保从 `src/types.ts` 导入 `StepExecutionParams` 和 `StepExecutionResult`。
        *   确保从 `src/constants.ts` 导入 `IPC_COMMAND_STEP_EXECUTION`。
        ```typescript
        // 在文件顶部添加或确认以下导入
        import { StepExecutionParams, StepExecutionResult } from './types'; // 确认路径正确
        import * as Constants from './constants';
        ```
    *   **在 `handleRequestFromMCP` 方法的 `switch` 语句中添加 `IPC_COMMAND_STEP_EXECUTION` case:**
        *   在 `case Constants.IPC_COMMAND_CONTINUE_DEBUGGING:` 之后，`default:` 之前添加新的 case。
        *   调用 `this.debuggerApiWrapper.stepExecutionAndWait` 处理请求。
        *   使用 `payload as StepExecutionParams` 进行类型断言。
        *   将返回的 `StepExecutionResult` 赋值给 `responsePayload`。
        *   添加日志记录。

        ```typescript
        // 在 handleRequestFromMCP 方法的 switch 语句 (约 L167 之后) 添加:
        case Constants.IPC_COMMAND_STEP_EXECUTION: // 新增 case
            this.outputChannel.appendLine(`[Coordinator] Handling '${Constants.IPC_COMMAND_STEP_EXECUTION}' request: ${requestId}`);
            const stepParams = payload as StepExecutionParams; // 类型断言
            // 调用 DebuggerApiWrapper 处理单步执行
            responsePayload = await this.debuggerApiWrapper.stepExecutionAndWait(stepParams.thread_id, stepParams.step_type);
            this.outputChannel.appendLine(`[Coordinator] '${Constants.IPC_COMMAND_STEP_EXECUTION}' result for ${requestId}: ${JSON.stringify(responsePayload)}`);
            // 注意: responsePayload 已经是 StepExecutionResult 类型，包含 status 和可能的 stop_event_data 或 message
            // 后续的 try...catch 和返回逻辑会根据 responsePayload.status (如果存在) 或捕获的错误来设置最终的 PluginResponse 状态和错误信息
            break;
        ```

2.  **审查和测试:**
    *   审查修改后的 `src/mcpServerManager.ts` 代码，确保逻辑正确，类型匹配。
    *   (后续由 Coder 完成) 重新构建插件。
    *   (后续由 Coder 完成) 运行测试场景，调用 `step_execution` 工具，确认不再出现 "不支持的命令" 错误，并且单步执行功能按预期工作。

**流程图 (修复流程):**

```mermaid
graph TD
    A[开始修复任务] --> B{审查 CurrentTask.md 上下文};
    B --> C{确认 mcpServerManager.ts 缺少 case};
    C --> D[制定修复计划: 添加 case];
    D --> E[更新 CurrentTask.md 任务规划];
    E --> F[执行代码修改 (Coder)];
    F --> G[构建和测试 (Coder)];
    G --> H{错误是否修复?};
    H -- 是 --> I[完成任务];
    H -- 否 --> F;
```