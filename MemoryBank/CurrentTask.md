## 任务上下文

### 核心文件与概念
- **`src/vscode/debuggerApiWrapper.ts`**: 封装 VS Code Debug API 调用，包含 `startDebuggingAndWait` 核心逻辑。
- **`vscode.debug.startDebugging`**: VS Code API，用于启动调试，但**不等待**会话状态变化。
- **`vscode.debug.onDidStartDebugSession`**: VS Code 事件，在调试会话启动时触发，用于关联 `sessionId`。
- **`vscode.debug.registerDebugAdapterTrackerFactory` / `DebugAdapterTracker`**: VS Code 机制，用于监听特定调试会话的事件（如 `stopped`）。
- **`stopped` 事件**: Debug Adapter 发送的事件，表示调试器已暂停。
- **`StopEventData`**: 项目定义的结构，用于封装 `stopped` 事件的详细信息（调用栈、变量等）。
- **`pendingStartRequests` Map**: `debuggerApiWrapper.ts` 内部用于管理异步启动请求的状态。

### 相关文档
- `MemoryBank/ProjectBrief.md`: 定义了 `start_debugging` 工具的需求和 `StopEventData` 结构。
- `Docs/Doc_VsCode_Debug.md`: 提供了 VS Code Debug API 和事件监听的详细信息。

---

## 问题分析与解决方案 (针对 start_debugging 超时问题 - 第二轮分析)

**1. 问题现象与日志分析 (更新)**

*   **用户反馈:** 应用了第一轮修复方案后，`start_debugging` 仍然超时。调试器成功启动并命中断点，但插件端依然没有将 `stopped` 状态返回给 MCP 服务器。
*   **日志关键信息 (更新):**
    *   MCP 服务器发送 `START_DEBUGGING_REQUEST`。
    *   插件端收到请求 (`IPC Received`)。
    *   **仍然缺失关键日志:**
        *   没有看到插件端发送 `START_DEBUGGING_RESPONSE` 的日志。
        *   没有看到 `DebugAdapterTracker` 捕获 `stopped` 事件或构建 `StopEventData` 的相关日志。
        *   **特别注意:** 需要确认**第一轮修复中添加的详细日志**（例如 `onDidStartDebugSession` 中的匹配日志、`createDebugAdapterTracker` 中的附加或未找到日志）**是否出现在最新的日志中**。这对于定位断裂点至关重要。
    *   最终结果仍然是插件端和 MCP 服务器超时。
*   **核心问题 (再次确认):** 插件端的 `DebuggerApiWrapper` 在 `startDebuggingAndWait` 方法中，未能成功将 `DebugAdapterTracker` 附加到新启动的调试会话，或者 Tracker 附加后未能成功捕获并处理 `stopped` 事件。

**2. 代码审查与根源定位 (`src/vscode/debuggerApiWrapper.ts` - 基于已应用第一轮修复的代码)**

*   **代码现状:** 假设 `src/vscode/debuggerApiWrapper.ts` 已包含了第一轮修复方案中的日志增强、`isResolved` 检查和会话关联逻辑。
*   **主要原因推断 (再次聚焦):**
    *   **会话关联失败仍然是最大嫌疑:**
        *   **`session.configuration.name` 匹配问题:** 这是最常见的陷阱。VS Code 实际启动的会话 `configuration.name` 可能与 `launch.json` 或我们传入的不完全一致。如果 `onDidStartDebugSession` 中的 `find` 操作因为名称不匹配而失败，`sessionId` 就无法关联，后续 Tracker 也无法创建。**需要通过日志确认 `session.configuration.name` 的实际值与 `pendingRequest.configurationName` 是否严格相等。**
        *   **`onDidStartDebugSession` 未触发或延迟:** 可能性较低。
    *   **Tracker 创建/附加失败:** 如果会话关联成功，但 `createDebugAdapterTracker` 内部逻辑出错或未能正确查找请求，Tracker 也不会附加。
    *   **Tracker 内部事件处理失败:** 如果 Tracker 成功附加，但 `onDidSendMessage` 没有被 `stopped` 事件触发，或 `buildStopEventData` 内部的 `session.customRequest` 调用存在问题。

**3. 新的解决方案与调试策略**

*   **目标:** 精确锁定 `startDebuggingAndWait` 流程中断的具体环节。
*   **核心策略:** 依赖并仔细分析**第一轮修复中添加的详细日志**。

*   **步骤 1: 确认日志输出**
    *   **行动:** 请用户再次运行测试，并提供**插件端完整的 Debug Console 输出日志**。
    *   **检查点:** (检查关键日志点是否存在)
        *   `[DebuggerApiWrapper] Starting debug request...`
        *   `[DebuggerApiWrapper] Calling vscode.debug.startDebugging...` / `...call succeeded...`
        *   **关键:** `[DebuggerApiWrapper] onDidStartDebugSession: Received session.id=..., session.name=..., config.name=...` (检查 `config.name` 值)
        *   **关键:** `[DebuggerApiWrapper] Pending requests before association: [...]` (检查是否有匹配请求)
        *   **关键:** `[DebuggerApiWrapper] Found matching pending request... Associating sessionId.` 或 `[DebuggerApiWrapper] No matching pending request found...`
        *   **关键:** `[DebuggerApiWrapper] createDebugAdapterTracker called for session...`
        *   **关键:** `[DebuggerApiWrapper] Attaching tracker to session...` 或 `[DebuggerApiWrapper] No pending request found... Tracker not created.`
        *   `[DebuggerApiWrapper] Tracker for request ... received 'stopped' event.`
        *   `[DebuggerApiWrapper] Building stop event data...` / `...Stop event data built... Resolving promise.`
        *   `[DebuggerApiWrapper] Request ... timed out.`
        *   `[DebuggerApiWrapper] Cleaning up listeners for request...`

*   **步骤 2: 根据日志分析制定下一步** (根据日志缺失情况判断场景 A/B/C/D)

    *   **场景 A (关联失败):** 临时修改匹配逻辑进行调试。
    *   **场景 B (Tracker 创建失败):** 审查状态管理和时序。
    *   **场景 C (Tracker 事件处理失败):** 检查 `onDidSendMessage` 和 `buildStopEventData` 内部日志。
    *   **场景 D (超时):** 结合其他日志判断。

*   **步骤 3: 提出代码修改建议 (基于日志分析结果)**
    *   待日志分析后确定。

---

## 任务规划 (最终修复方案 - 解决竞态条件)

**当前目标:** 根据最新的诊断，修复 `start_debugging` 工具因 `registerDebugAdapterTrackerFactory` 和 `onDidStartDebugSession` 竞态条件导致的超时问题。

**核心修复逻辑:**

1.  **修改 `createDebugAdapterTracker`:**
    *   不再尝试在创建 Tracker 时通过 `sessionId` 查找 `pendingRequest`。
    *   **总是**返回一个 `DebugAdapterTracker` 实例。
2.  **修改 `DebugAdapterTracker` 内部实现:**
    *   在 Tracker 的 `onDidSendMessage`, `onError`, `onExit` 方法内部，获取当前事件关联的 `session.id`。
    *   使用这个 `session.id` 去 `pendingStartRequests` Map 中查找对应的 `pendingRequest`。
    *   找到 `pendingRequest` 后，再执行后续的事件处理逻辑（检查 `isResolved`，调用 `resolveCleanup` 等）。

**代码修改建议 (`src/vscode/debuggerApiWrapper.ts`):**

请 Coder 应用以下修改：

```typescript
// ... 其他 import 和接口定义 ...

export class DebuggerApiWrapper {
    private pendingStartRequests = new Map<string, PendingRequest>();
    private static nextRequestId = 0;

    // ... cleanupRequest, addBreakpoint, getBreakpoints, removeBreakpoint 不变 ...

    // --- startDebuggingAndWait 实现 ---
    public async startDebuggingAndWait(configurationName: string, noDebug: boolean): Promise<StartDebuggingResponsePayload> {
        const requestId = `start-${DebuggerApiWrapper.nextRequestId++}`;
        console.log(`[DebuggerApiWrapper] Starting debug request: ${requestId} for ${configurationName}`);

        return new Promise<StartDebuggingResponsePayload>(async (resolve) => {
            // ... 获取 folder, launchConfig, targetConfig 的逻辑不变 ...

            const listeners: vscode.Disposable[] = [];
            let trackerDisposable: vscode.Disposable | undefined;

            // 封装的 resolve 函数，确保清理 (不变)
            const resolveCleanup = (result: StartDebuggingResponsePayload) => {
                // ... resolveCleanup 逻辑不变 ...
            };

            const timeout = 60000; // 插件内部超时 (不变)
            const timeoutTimer = setTimeout(() => {
                // ... timeout 逻辑不变 ...
            }, timeout);

            const pendingRequest: PendingRequest = {
                configurationName,
                resolve: resolveCleanup,
                timeoutTimer,
                listeners,
                isResolved: false,
            };
            this.pendingStartRequests.set(requestId, pendingRequest);


            // --- 注册 Tracker Factory (修改核心逻辑) ---
            trackerDisposable = vscode.debug.registerDebugAdapterTrackerFactory('*', {
              createDebugAdapterTracker: (session: vscode.DebugSession) => {
                // **修改点 1: 总是返回 Tracker，不再在此处查找 pendingRequest**
                console.log(`[DebuggerApiWrapper] createDebugAdapterTracker called for session ${session.id} (name: ${session.name}, type: ${session.type}). Creating tracker instance.`);

                // **修改点 2: Tracker 内部方法通过 session.id 查找请求**
                return {
                  onDidSendMessage: async (message) => {
                    // **修改点 2.1: 在事件处理时查找请求**
                    const currentRequestEntry = Array.from(this.pendingStartRequests.entries())
                                                      .find(([reqId, req]) => req.sessionId === session.id);

                    if (!currentRequestEntry) {
                        // console.warn(`[DebuggerApiWrapper] onDidSendMessage: No pending request found for session ${session.id}. Ignoring message.`);
                        return; // 不是我们关心的会话或请求已清理
                    }
                    const [currentRequestId, currentRequest] = currentRequestEntry;

                    if (currentRequest.isResolved) {
                        // console.warn(`[DebuggerApiWrapper] Request ${currentRequestId} already resolved, ignoring 'onDidSendMessage' event.`);
                        return;
                    }

                    if (message.type === 'event' && message.event === 'stopped') {
                      console.log(`[DebuggerApiWrapper] Tracker for request ${currentRequestId} received 'stopped' event.`);
                      try {
                        console.log(`[DebuggerApiWrapper] Building stop event data for request ${currentRequestId}...`);
                        const stopEventData = await this.buildStopEventData(session, message.body);
                        console.log(`[DebuggerApiWrapper] Stop event data built for ${currentRequestId}. Resolving promise.`);
                        currentRequest.resolve({ status: 'stopped', data: stopEventData });
                      } catch (error: any) {
                        console.error(`[DebuggerApiWrapper] Error building stop event data for ${currentRequestId}:`, error);
                        currentRequest.resolve({ status: 'error', message: `构建停止事件数据时出错: ${error.message}` });
                      }
                    }
                  },
                  onError: (error) => {
                    // **修改点 2.2: 在事件处理时查找请求**
                    const currentRequestEntry = Array.from(this.pendingStartRequests.entries())
                                                      .find(([reqId, req]) => req.sessionId === session.id);
                    if (!currentRequestEntry) {
                        // console.warn(`[DebuggerApiWrapper] onError: No pending request found for session ${session.id}. Ignoring error.`);
                        return;
                    }
                    const [currentRequestId, currentRequest] = currentRequestEntry;

                    console.error(`[DebuggerApiWrapper] Debug adapter error for session ${session.id}, request ${currentRequestId}:`, error);
                    if (currentRequest.isResolved) {
                        // console.warn(`[DebuggerApiWrapper] Request ${currentRequestId} already resolved, ignoring 'onError' event.`);
                        return;
                    }
                    currentRequest.resolve({ status: 'error', message: `调试适配器错误: ${error.message}` });
                  },
                  onExit: (code, signal) => {
                    // **修改点 2.3: 在事件处理时查找请求**
                    const currentRequestEntry = Array.from(this.pendingStartRequests.entries())
                                                      .find(([reqId, req]) => req.sessionId === session.id);
                    if (!currentRequestEntry) {
                        // console.warn(`[DebuggerApiWrapper] onExit: No pending request found for session ${session.id}. Ignoring exit.`);
                        return;
                    }
                    const [currentRequestId, currentRequest] = currentRequestEntry;

                    console.log(`[DebuggerApiWrapper] Debug adapter exit for session ${session.id}, request ${currentRequestId}: code=${code}, signal=${signal}`);
                    if (currentRequest.isResolved) {
                        // console.warn(`[DebuggerApiWrapper] Request ${currentRequestId} already resolved, ignoring 'onExit' event.`);
                        return;
                    }
                    // 只有在未被 stopped/terminated/error 解决时才处理 exit
                    if (this.pendingStartRequests.has(currentRequestId)) { // 再次检查以防万一
                       console.log(`[DebuggerApiWrapper] Resolving request ${currentRequestId} as error due to adapter exit.`);
                       currentRequest.resolve({ status: 'error', message: `调试适配器意外退出 (code: ${code}, signal: ${signal})` });
                    } else {
                        console.warn(`[DebuggerApiWrapper] Request ${currentRequestId} not found in pending requests during onExit.`);
                    }
                  }
                }; // 结束返回 Tracker 实例
              } // 结束 createDebugAdapterTracker
            }); // 结束 registerDebugAdapterTrackerFactory
            pendingRequest.trackerDisposable = trackerDisposable; // 保存 tracker disposable

            // --- 注册 Session 生命周期监听器 (不变) ---
            listeners.push(vscode.debug.onDidStartDebugSession(session => {
               // ... onDidStartDebugSession 逻辑不变，仍然需要关联 sessionId ...
               console.log(`[DebuggerApiWrapper] onDidStartDebugSession: Received session.id=${session.id}, session.name=${session.name}, config.name=${session.configuration.name}`);
               console.log(`[DebuggerApiWrapper] Pending requests before association:`, Array.from(this.pendingStartRequests.entries()).map(([id, req]) => ({ id, config: req.configurationName, sessionId: req.sessionId, resolved: req.isResolved })));

               const matchingRequestEntry = Array.from(this.pendingStartRequests.entries())
                   .find(([reqId, req]) =>
                       req.configurationName === session.configuration.name &&
                       !req.sessionId && // 确保只关联一次
                       !req.isResolved
                   );

               if (matchingRequestEntry) {
                   const [reqIdToAssociate, requestToAssociate] = matchingRequestEntry;
                   console.log(`[DebuggerApiWrapper] Found matching pending request ${reqIdToAssociate} for session ${session.id}. Associating sessionId.`);
                   requestToAssociate.sessionId = session.id; // 关联 sessionId
               } else {
                   console.warn(`[DebuggerApiWrapper] No matching pending request found for started session ${session.id} with config name "${session.configuration.name}". This session might not be tracked.`);
               }
            }));

            listeners.push(vscode.debug.onDidTerminateDebugSession(session => {
              // ... onDidTerminateDebugSession 逻辑不变 ...
              console.log(`[DebuggerApiWrapper] onDidTerminateDebugSession: Received session.id=${session.id}`);
              const terminatedRequestEntry = Array.from(this.pendingStartRequests.entries())
                                                .find(([reqId, req]) => req.sessionId === session.id);
              if (terminatedRequestEntry) {
                const [terminatedRequestId, terminatedRequest] = terminatedRequestEntry;
                console.log(`[DebuggerApiWrapper] Found matching request ${terminatedRequestId} for terminated session ${session.id}.`);
                if (terminatedRequest.isResolved) {
                    // console.warn(`[DebuggerApiWrapper] Request ${terminatedRequestId} already resolved, ignoring 'onDidTerminateDebugSession' event.`);
                    return;
                }
                if (this.pendingStartRequests.has(terminatedRequestId)) {
                   console.log(`[DebuggerApiWrapper] Resolving request ${terminatedRequestId} as completed.`);
                   terminatedRequest.resolve({ status: 'completed', message: '调试会话已结束。' });
                } else {
                    console.warn(`[DebuggerApiWrapper] Request ${terminatedRequestId} not found in pending requests during onDidTerminateDebugSession.`);
                }
              } else {
                  // console.warn(`[DebuggerApiWrapper] No pending request found for terminated session ${session.id}.`);
              }
            }));
            pendingRequest.listeners = listeners; // 保存监听器 disposable

            // --- 启动调试 (不变) ---
            try {
              // ... startDebugging 调用逻辑不变 ...
            } catch (error: any) {
              // ... 错误处理不变 ...
            }
        });
    }

    // --- 辅助函数：构建 StopEventData (不变) ---
    private async buildStopEventData(session: vscode.DebugSession, stopBody: any): Promise<StopEventData> {
        // ... buildStopEventData 逻辑不变 ...
    }
}
```

**下一步行动:**

1.  **Coder 应用修改:** 请 Coder 将上述代码修改应用到 `src/vscode/debuggerApiWrapper.ts` 文件。
2.  **测试验证:** 请用户使用修复后的代码再次测试 `start_debugging` 功能，确认超时问题是否已解决，并观察 `stopped` 事件是否能被正确捕获和返回。