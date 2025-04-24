# 当前任务

开发 `continue_debugging` 工具

## 任务上下文

MemoryBank/ProjectBrief.md (lines 244-256)
Docs/Doc_Debug_Tools.md (lines 77-83)
Docs/Doc_VsCode_Debug.md (lines 247-266) - VS Code API `customRequest('continue', ...)`
Docs/Doc_VsCode_Debug.md (lines 379-568) - 使用 `DebugAdapterTracker` 监听 `stopped` 事件
mcp-server/src/toolProviders/debug/
mcp-server/src/pluginCommunicator.ts
mcp-server/src/types.ts
src/vscode/debuggerApiWrapper.ts
src/vscode/debugSessionManager.ts
src/vscode/debugStateProvider.ts

## 任务规划 (已重写，解决 sessionId 和命令不匹配问题)

### 1. 核心问题与目标

*   **问题 1 (用户疑问):** `sessionId` 的来源和传递机制不清晰。
*   **问题 2 (工具失败):** `continue_debugging` 工具调用失败，插件端日志显示 "不支持的命令: continue_debugging"。
*   **根本原因:**
    *   `sessionId` 未能在调试停止时正确返回给调用方 (AI Agent)。
    *   MCP 服务器发送给插件的 `continue_debugging` 命令字符串与插件期望接收的不一致。
*   **目标:**
    1.  **明确 `sessionId` 传递:** 确保 `start_debugging` 和其他返回 `stopped` 状态的工具在响应中包含 `sessionId`，并要求 AI Agent 在调用 `continue_debugging` 等工具时传入此 ID。
    2.  **修复命令不匹配:** 统一 MCP 服务器和插件端使用的 `continue_debugging` 命令字符串。
    3.  **实现 `continue_debugging`:** 使工具能够基于 AI Agent 提供的 `sessionId` 和 `threadId` 正常工作。

### 2. `sessionId` 传递机制说明 (供 AI Agent 参考)

1.  **获取 `sessionId`:** 当调用 `start_debugging` 工具成功启动调试并暂停，或任何调试工具（包括 `continue_debugging` 自身）的执行结果状态为 `"stopped"` 时，其响应负载 (`payload` 或 `stop_event_data`) **必须包含** 当前调试会话的 `sessionId`。
2.  **保存 `sessionId`:** AI Agent (客户端) 需要从上述响应中提取并**保存**这个 `sessionId`。
3.  **传递 `sessionId`:** 在调用需要特定调试会话上下文的工具时（例如 `continue_debugging`, `get_stack_trace`, `evaluate_expression` 等），AI Agent **必须** 将之前保存的对应会话的 `sessionId` 作为参数（通常是 `session_id` 或 `sessionId`）传递给 MCP 工具。

### 3. 文件修改规划

#### 3.1 添加 `sessionId` 到停止事件数据

*   **文件:** `src/types.ts`
    *   **操作:** 修改 `StopEventData` 接口，添加 `session_id` 字段。
    *   **代码:**
        ```diff
         // src/types.ts
         export interface StopEventData {
        +    session_id: string; // 新增：当前调试会话的 ID
             timestamp: string; // ISO 8601 UTC
             reason: string; // "breakpoint", "exception", "step", etc.
             thread_id: number;

        ```
*   **文件:** `src/vscode/debugStateProvider.ts`
    *   **操作:** 修改 `buildStopEventData` 函数，在返回的对象中包含 `session.id`。
    *   **代码:**
        ```diff
         // src/vscode/debugStateProvider.ts
         import * as vscode from 'vscode';
         import * as path from 'path';
        -import { StopEventData, VariableInfo, StackFrameInfo } from '../types';
        +import { StopEventData, VariableInfo, StackFrameInfo } from '../types'; // 确认导入 StopEventData

         export class DebugStateProvider {
             // ... constructor ...

             public async buildStopEventData(session: vscode.DebugSession, stopBody: any): Promise<StopEventData> {
                 const timestamp = new Date().toISOString();
                 const threadId = stopBody.threadId;
        +        const sessionId = session.id; // 获取 sessionId

                 // ... (获取 callStack 和 topFrameVariables 的逻辑不变) ...

                 // 3. 构建 StopEventData 对象
                 const sourceInfo = callStack[0] ? {
                     path: callStack[0].file_path,
                     name: path.basename(callStack[0].file_path) || callStack[0].file_path
                 } : null;

                 return {
        +            session_id: sessionId, // <--- 添加 sessionId
                     timestamp,
                     reason: stopBody.reason || 'unknown',
                     thread_id: threadId,

        ```

#### 3.2 修正 IPC 命令不匹配

*   **文件:** `mcp-server/src/toolProviders/debug/continueDebugging.ts`
    *   **操作:** 修改 `execute` 函数中调用 `sendRequestToPlugin` 的部分，确保发送的 `command` (或 `type`，建议统一为 `command`) 包含正确的前缀 `'vscode-debugger-mcp:'`。
    *   **建议:** 在 MCP 服务器端也定义命令常量，例如在 `mcp-server/src/constants.ts` (如果不存在则创建) 中定义 `IPC_COMMAND_CONTINUE_DEBUGGING = 'vscode-debugger-mcp:continue_debugging'`，然后导入使用。
    *   **代码 (假设常量已定义并导入):**
        ```diff
         // mcp-server/src/toolProviders/debug/continueDebugging.ts
         import { z } from 'zod';
         import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
        -import { ContinueDebuggingParams, StartDebuggingResponsePayload } from '../../types';
        +import { ContinueDebuggingParams, StartDebuggingResponsePayload } from '../../types'; // 确认导入
        +import { IPC_COMMAND_CONTINUE_DEBUGGING } from '../../constants'; // <--- 假设常量文件和导入

         // ... (Schema 定义保持不变，确保 inputSchema 包含 session_id) ...

         export const continueDebuggingTool = {
             name: "continue_debugging",
             // ... description, inputSchema, outputSchema ...
             async execute(params: ContinueDebuggingParams): Promise<z.infer<typeof AsyncDebugResultSchema>> {
                 try {
                     const { session_id: sessionId, thread_id: threadId } = params; // 从参数获取 session_id

                     console.log(`[MCP Tool] Sending continue_debugging request to plugin for session ${sessionId}, thread ${threadId}`);

                     // 向插件发送请求
                     const response: PluginResponse<StartDebuggingResponsePayload> = await sendRequestToPlugin({
        -                type: 'continue_debugging', // 请求类型
        +                command: IPC_COMMAND_CONTINUE_DEBUGGING, // <--- 使用常量，确保包含前缀
                         payload: {
                             sessionId: sessionId, // 插件端期望的是 sessionId
                             threadId: threadId,
                         }
                     }, 65000); // 设置超时时间

                     // ... (处理插件响应的逻辑保持不变) ...
                 } catch (error: any) {
                     // ... (错误处理保持不变) ...
                 }
             }
         };
        ```
    *   **如果 MCP 服务器端没有 `constants.ts`:**
        ```diff
         // mcp-server/src/toolProviders/debug/continueDebugging.ts
         // ... imports ...

         export const continueDebuggingTool = {
             // ... name, description, schemas ...
             async execute(params: ContinueDebuggingParams): Promise<z.infer<typeof AsyncDebugResultSchema>> {
                 try {
                     // ...
                     const response: PluginResponse<StartDebuggingResponsePayload> = await sendRequestToPlugin({
        -                type: 'continue_debugging',
        +                command: 'vscode-debugger-mcp:continue_debugging', // <--- 直接使用带前缀的字符串
                         payload: {
                             sessionId: sessionId,
                             threadId: threadId,
                         }
                     }, 65000);
                     // ...
                 } catch (error: any) {
                     // ...
                 }
             }
         };
        ```
*   **文件:** `mcp-server/src/pluginCommunicator.ts` (可能需要检查)
    *   **操作:** 确认 `sendRequestToPlugin` 函数正确地将请求对象（包含 `command` 字段）发送给了插件端。通常这个函数负责 IPC 通信的细节，应该不需要修改，但需要确认它没有篡改 `command` 字段。
*   **文件:** `src/mcpServerManager.ts`
    *   **操作:** 无需修改。`handleRequestFromMCP` 中的 `switch` 语句已经使用了正确的常量 (`Constants.IPC_COMMAND_CONTINUE_DEBUGGING`) 进行匹配。只要 MCP 服务器发送了正确的带前缀的命令，这里的逻辑就能正确处理。

#### 3.3 其他相关文件确认 (通常无需修改)

*   **`mcp-server/src/types.ts`:** 确认 `ContinueDebuggingParams` 接口定义了 `session_id` 和 `thread_id`。
*   **`src/types.ts`:** 确认 `ContinueDebuggingParams` 接口定义了 `sessionId` 和 `threadId`。
*   **`src/vscode/debugSessionManager.ts`:** 确认 `continueDebuggingAndWait` 方法接收 `sessionId` 和 `threadId`。
*   **`src/vscode/debuggerApiWrapper.ts`:** 确认 `continueDebuggingAndWait` 方法接收 `sessionId` 和 `threadId`。
*   **`mcp-server/src/toolProviders/debug/index.ts`:** 确认导出了 `continueDebuggingTool`。
*   **`mcp-server/src/server.ts`:** 确认注册了 `continueDebuggingTool`。

#### 3.4 修复 MCP 服务器端编译错误 (ts(2353))

*   **背景:** 由于 `mcp-server/src/pluginCommunicator.ts` 中的 `sendRequestToPlugin` 函数签名已修改，将请求参数从接受 `type` 字段改为接受 `command` 字段，导致多个调用该函数的调试工具文件出现编译错误 (ts(2353))。
*   **目标:** 修改所有受影响的调试工具文件，使其调用 `sendRequestToPlugin` 时传递 `command` 字段，并使用正确的、带前缀的命令常量。
*   **操作:**
    1.  **(可选) 确认/创建/更新常量文件:**
        *   检查 `mcp-server/src/constants.ts` 文件是否存在。
        *   如果不存在，则创建该文件。
        *   确保该文件中定义了所有需要的 IPC 命令常量，并使用 `'vscode-debugger-mcp:'` 前缀。例如：
            ```typescript
            // mcp-server/src/constants.ts (示例)
            export const IPC_COMMAND_GET_CONFIGURATIONS = 'vscode-debugger-mcp:get_configurations';
            export const IPC_COMMAND_START_DEBUGGING = 'vscode-debugger-mcp:start_debugging';
            export const IPC_COMMAND_SET_BREAKPOINT = 'vscode-debugger-mcp:set_breakpoint';
            export const IPC_COMMAND_GET_BREAKPOINTS = 'vscode-debugger-mcp:get_breakpoints';
            export const IPC_COMMAND_REMOVE_BREAKPOINT = 'vscode-debugger-mcp:remove_breakpoint';
            export const IPC_COMMAND_CONTINUE_DEBUGGING = 'vscode-debugger-mcp:continue_debugging';
            // ... 其他命令常量 ...

            export const IPC_STATUS_SUCCESS = 'success';
            export const IPC_STATUS_ERROR = 'error';
            ```
    2.  **修改调用点:** 在以下文件中，将调用 `sendRequestToPlugin` 时传递的对象中的 `type` 字段修改为 `command`，并确保导入和使用了 `mcp-server/src/constants.ts` 中定义的相应常量。
        *   **文件:** `mcp-server/src/toolProviders/debug/getBreakpoints.ts`
            ```diff
             // mcp-server/src/toolProviders/debug/getBreakpoints.ts
             import { z } from 'zod';
             import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
            -import * as Constants from '../../constants'; // 确认导入
            +import * as Constants from '../../constants'; // 确认导入

             // ... schema ...

             export async function handleGetBreakpoints(...) {
                 // ...
                 try {
                     const pluginResponse: PluginResponse = await sendRequestToPlugin({
            -            type: Constants.IPC_COMMAND_GET_BREAKPOINTS, // 使用常量
            +            command: Constants.IPC_COMMAND_GET_BREAKPOINTS, // <--- 修改为 command
                         payload: {}
                     });
                     // ...
                 } catch (error: any) {
                     // ...
                 }
             }
            ```
        *   **文件:** `mcp-server/src/toolProviders/debug/removeBreakpoint.ts`
            ```diff
             // mcp-server/src/toolProviders/debug/removeBreakpoint.ts
             import { z } from 'zod';
             import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
            -import * as Constants from '../../constants'; // 确认导入
            +import * as Constants from '../../constants'; // 确认导入
             import type { PluginResponse as LocalPluginResponse } from '../../types';

             // ... schema ...

             export async function handleRemoveBreakpoint(...) {
                 // ... validation ...
                 try {
                     const response: LocalPluginResponse = await sendRequestToPlugin({
            -            type: Constants.IPC_COMMAND_REMOVE_BREAKPOINT, // 使用本地常量
            +            command: Constants.IPC_COMMAND_REMOVE_BREAKPOINT, // <--- 修改为 command
                         payload: validatedParams,
                     });
                     // ...
                 } catch (error: any) {
                     // ...
                 }
             }
            ```
        *   **文件:** `mcp-server/src/toolProviders/debug/setBreakpoint.ts`
            ```diff
             // mcp-server/src/toolProviders/debug/setBreakpoint.ts
             import * as path from 'path';
             import { z } from 'zod';
             import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
            -import * as Constants from '../../constants'; // 确认导入
            +import * as Constants from '../../constants'; // 确认导入

             // ... schema ...

             export async function handleSetBreakpoint(...) {
                 // ... path resolution ...
                 try {
                     const pluginResponse: PluginResponse = await sendRequestToPlugin({
            -            type: Constants.IPC_COMMAND_SET_BREAKPOINT, // 使用常量
            +            command: Constants.IPC_COMMAND_SET_BREAKPOINT, // <--- 修改为 command
                         payload: payloadForPlugin
                     });
                     // ...
                 } catch (error: any) {
                     // ...
                 }
             }
            ```
        *   **文件:** `mcp-server/src/toolProviders/debug/startDebugging.ts` (**注意:** 此文件之前读取失败，需先确认文件存在且包含类似调用)
            ```diff
             // mcp-server/src/toolProviders/debug/startDebugging.ts (假设结构)
             import { z } from 'zod';
             import { sendRequestToPlugin, PluginResponse } from '../../pluginCommunicator';
            -import * as Constants from '../../constants'; // 确认导入
            +import * as Constants from '../../constants'; // 确认导入
             // ... 其他导入 ...

             // ... schema ...

             export async function handleStartDebugging(...) { // 或类似函数
                 // ...
                 try {
                     const response: PluginResponse<...> = await sendRequestToPlugin({
            -            type: Constants.IPC_COMMAND_START_DEBUGGING, // 假设常量名
            +            command: Constants.IPC_COMMAND_START_DEBUGGING, // <--- 修改为 command
                         payload: { ... }
                     });
                     // ...
                 } catch (error: any) {
                     // ...
                 }
             }
            ```
    3.  **确认导入:** 确保所有修改的文件都正确导入了 `mcp-server/src/constants.ts`。

### 4. 流程图 (Mermaid) (更新命令和 `sessionId` 返回)

```mermaid
sequenceDiagram
    participant AI as AI Agent
    participant MCP_Server as MCP Server
    participant Plugin_Comm as pluginCommunicator.ts
    participant VSCode_Plugin as VS Code Plugin (McpServerManager)
    participant Debug_Wrapper as DebuggerApiWrapper
    participant Session_Mgr as DebugSessionManager
    participant State_Provider as DebugStateProvider
    participant VSCode_Debug as VS Code Debug API / DAP

    Note over AI: (前置条件) 已通过 start_debugging 或其他方式获得 session_id = 'xyz'

    AI->>+MCP_Server: 调用 continue_debugging 工具 (thread_id=1, session_id='xyz')
    MCP_Server->>+Plugin_Comm: sendRequestToPlugin({command: 'vscode-debugger-mcp:continue_debugging', payload: {sessionId: 'xyz', threadId: 1}}) # 命令修正
    Plugin_Comm->>VSCode_Plugin: 发送 IPC 请求 (command='vscode-debugger-mcp:continue_debugging')
    VSCode_Plugin->>+Debug_Wrapper: continueDebuggingAndWait('xyz', 1)
    Debug_Wrapper->>+Session_Mgr: continueDebuggingAndWait({sessionId: 'xyz', threadId: 1})
    Session_Mgr->>VSCode_Debug: session.customRequest('continue', {threadId: 1})
    Note right of Session_Mgr: 启动异步等待 (waitForStop) for session 'xyz'
    VSCode_Debug-->>Session_Mgr: (异步) DAP 'continue' 响应 (通常为空)

    %% 场景1: 调试器再次停止 %%
    VSCode_Debug-->>Session_Mgr: (异步) DAP Event: 'stopped' (session='xyz', threadId=1, reason='breakpoint')
    Session_Mgr->>+State_Provider: buildStopEventData(session, stopBody)
    State_Provider->>VSCode_Debug: customRequest('stackTrace', {threadId: 1})
    VSCode_Debug-->>State_Provider: stackTrace 响应
    State_Provider->>VSCode_Debug: customRequest('scopes', ...)
    VSCode_Debug-->>State_Provider: scopes 响应
    State_Provider->>VSCode_Debug: customRequest('variables', ...)
    VSCode_Debug-->>State_Provider: variables 响应
    State_Provider-->>-Session_Mgr: 返回 StopEventData (包含 session_id='xyz') # sessionId 添加
    Session_Mgr-->>-Debug_Wrapper: 返回 {status: 'stopped', data: StopEventData(session_id='xyz', ...)}
    Debug_Wrapper-->>-VSCode_Plugin: 返回 {status: 'stopped', data: StopEventData(session_id='xyz', ...)}
    VSCode_Plugin->>Plugin_Comm: 发送 IPC 响应 (payload 包含带 sessionId 的 data)
    Plugin_Comm-->>-MCP_Server: 返回 PluginResponse (success, payload={status:'stopped', data: {...}})
    MCP_Server-->>-AI: 返回工具结果 (status='stopped', stop_event_data={session_id='xyz', ...}) # 返回 sessionId

    %% 场景2: 调试会话结束 %%
    VSCode_Debug-->>Session_Mgr: (异步) Event: 'terminated' (session='xyz')
    Session_Mgr-->>-Debug_Wrapper: 返回 {status: 'completed', message: '...'}
    Debug_Wrapper-->>-VSCode_Plugin: 返回 {status: 'completed', message: '...'}
    VSCode_Plugin->>Plugin_Comm: 发送 IPC 响应
    Plugin_Comm-->>-MCP_Server: 返回 PluginResponse (success, payload={status:'completed',...})
    MCP_Server-->>-AI: 返回工具结果 (status='completed', message=...)

    %% 场景3: 超时 %%
    Note over Session_Mgr: 等待超时触发 for session 'xyz'
    Session_Mgr-->>-Debug_Wrapper: 返回 {status: 'timeout', message: '...'}
    Debug_Wrapper-->>-VSCode_Plugin: 返回 {status: 'timeout', message: '...'}
    VSCode_Plugin->>Plugin_Comm: 发送 IPC 响应
    Plugin_Comm-->>-MCP_Server: 返回 PluginResponse (success, payload={status:'timeout',...})
    MCP_Server-->>-AI: 返回工具结果 (status='timeout', message=...)

    %% 场景4: 发生错误 %%
    Note over Session_Mgr: 处理 session 'xyz' 时发生错误
    Session_Mgr-->>-Debug_Wrapper: 返回 {status: 'error', message: '...'}
    Debug_Wrapper-->>-VSCode_Plugin: 返回 {status: 'error', message: '...'}
    VSCode_Plugin->>Plugin_Comm: 发送 IPC 响应
    Plugin_Comm-->>-MCP_Server: 返回 PluginResponse (success, payload={status:'error',...})
    MCP_Server-->>-AI: 返回工具结果 (status='error', message=...)
```

### 5. 注意事项

*   **`sessionId` 传递:** 严格遵循第 2 节中描述的 `sessionId` 获取、保存和传递机制。确保所有返回 `stopped` 状态的调试相关工具（包括 `start_debugging` 和 `continue_debugging` 自身）都在其响应的 `stop_event_data` 中包含 `session_id`。
*   **命令一致性:** 确保 MCP 服务器发送的 IPC 命令字符串 (`command`) 与 VS Code 插件端 (`src/constants.ts` 和 `src/mcpServerManager.ts`) 期望接收的完全一致（包括前缀 `'vscode-debugger-mcp:'`）。建议在 MCP 服务器端也使用常量定义。
*   **类型同步:** 保持 `src/types.ts` 和 `mcp-server/src/types.ts` 中共享类型（如 `StopEventData`, `ContinueDebuggingParams`）的定义同步或兼容。注意字段名可能存在的差异（例如 `session_id` vs `sessionId`），并在必要时进行转换。
*   **异步等待:** `DebugSessionManager` 中的异步等待逻辑 (`continueDebuggingAndWait`, `startDebuggingAndWait`) 是核心，需要确保其健壮性，能正确处理停止、完成、超时和错误等情况。
*   **错误处理:** 在 MCP 服务器工具、`pluginCommunicator`、插件端的 `McpServerManager`、`DebuggerApiWrapper` 和 `DebugSessionManager` 等各个环节都要做好错误捕获和传递。
*   **测试:** 重点测试 `sessionId` 的正确传递、命令匹配以及 `continue_debugging` 在不同场景下的行为（再次停止、结束、超时、错误）。