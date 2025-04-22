import * as vscode from 'vscode';
import * as path from 'path';
import {
    RemoveBreakpointParams,
    SetBreakpointParams,
    StartDebuggingResponsePayload, // 新增
    StopEventData,               // 新增
    VariableInfo                 // 新增
} from '../types';
import { IPC_STATUS_SUCCESS, IPC_STATUS_ERROR } from '../constants';

// --- 内部类型定义 ---
interface PendingRequest {
    configurationName: string; // 用于启动时匹配
    resolve: (value: StartDebuggingResponsePayload) => void;
    // reject 不再直接使用，通过 resolve 返回 error status
    timeoutTimer: NodeJS.Timeout;
    listeners: vscode.Disposable[];
    trackerDisposable?: vscode.Disposable;
    sessionId?: string; // 在 onDidStartDebugSession 中设置
    isResolved: boolean; // 标记是否已被解决，防止重复处理
}

/**
 * 封装与 VS Code Debug API 的交互逻辑。
 */
export class DebuggerApiWrapper {
    private pendingStartRequests = new Map<string, PendingRequest>(); // key 是 requestId
    private static nextRequestId = 0;

    // --- 清理函数 ---
    private cleanupRequest(requestId: string) {
        const pendingRequest = this.pendingStartRequests.get(requestId);
        if (pendingRequest) {
            console.log(`[DebuggerApiWrapper] Cleaning up listeners for request: ${requestId}`);
            clearTimeout(pendingRequest.timeoutTimer);
            pendingRequest.listeners.forEach(d => d.dispose());
            pendingRequest.trackerDisposable?.dispose();
            this.pendingStartRequests.delete(requestId);
        }
    }

    /**
     * 添加断点。
     * @param payload 包含断点信息的对象，例如 { file_path, line_number, column_number?, condition?, hit_condition?, log_message? }
     * @returns 返回一个包含断点信息的 Promise 对象，格式符合 MCP 规范。
     */
    public async addBreakpoint(payload: SetBreakpointParams): Promise<{ breakpoint: any } | { error: { message: string } }> {
        const {
            file_path: filePath, // 已经是绝对路径
            line_number: lineNumber,
            column_number: columnNumber,
            condition,
            hit_condition: hitCondition,
            log_message: logMessage
        } = payload;

        // 基本参数校验 (虽然 MCP Server 已做，这里做一层防护)
        if (!filePath || typeof lineNumber !== 'number' || lineNumber <= 0) {
            const errorMsg = 'Invalid setBreakpoint request payload: missing or invalid filePath or lineNumber.';
            console.error(`[DebuggerApiWrapper] ${errorMsg}`);
            return { error: { message: errorMsg } };
        }

        let uri: vscode.Uri;
        try {
            uri = vscode.Uri.file(filePath);
        } catch (pathError: any) {
            const errorMsg = `文件路径格式无效: ${filePath} (${pathError.message})`;
            console.error(`[DebuggerApiWrapper] Error creating Uri from path "${filePath}":`, pathError);
            return { error: { message: errorMsg } };
        }

        const absoluteFilePath = uri.fsPath; // 获取绝对路径用于比较
        const zeroBasedLine = lineNumber - 1;
        const zeroBasedColumn = (typeof columnNumber === 'number' && columnNumber > 0) ? columnNumber - 1 : undefined;

        try {
            // --- 先查：查找现有断点 ---
            const existingBreakpoints = vscode.debug.breakpoints;
            const existingBp = existingBreakpoints.find(bp => {
                if (!(bp instanceof vscode.SourceBreakpoint)) {return false;}
                const bpLocation = bp.location;
                if (bpLocation.uri.fsPath !== absoluteFilePath) {return false;}
                if (bpLocation.range.start.line !== zeroBasedLine) {return false;}
                if (zeroBasedColumn !== undefined) {
                    return bpLocation.range.start.character === zeroBasedColumn;
                }
                return true; // 只匹配行
            }) as vscode.SourceBreakpoint | undefined;

            if (existingBp) {
                console.log(`[DebuggerApiWrapper] Found existing breakpoint at location. Reusing ID: ${existingBp.id}`);
                return {
                    breakpoint: {
                        id: existingBp.id,
                        verified: false, // 保持 false, 依赖后续事件更新
                        source: { path: filePath },
                        line: lineNumber,
                        column: columnNumber,
                        message: "Reused existing breakpoint at this location.",
                        timestamp: new Date().toISOString()
                    }
                };
            } else {
                console.log(`[DebuggerApiWrapper] No existing breakpoint found at location. Adding new one.`);
                const position = new vscode.Position(zeroBasedLine, zeroBasedColumn ?? 0);
                const location = new vscode.Location(uri, position);
                const breakpoint = new vscode.SourceBreakpoint(location, true, condition, hitCondition, logMessage);

                await vscode.debug.addBreakpoints([breakpoint]);
                console.log(`[DebuggerApiWrapper] Added breakpoint via API.`);

                // --- 获取断点 ID (需要延迟以确保 API 更新) ---
                await new Promise(resolve => setTimeout(resolve, 150)); // 稍微增加延迟

                const currentBreakpoints = vscode.debug.breakpoints;
                console.log(`[DebuggerApiWrapper] Current breakpoints count after add: ${currentBreakpoints.length}`);

                const addedBp = currentBreakpoints.find(bp =>
                    bp instanceof vscode.SourceBreakpoint &&
                    bp.location.uri.fsPath === uri.fsPath &&
                    bp.location.range.start.line === zeroBasedLine &&
                    bp.location.range.start.character === (zeroBasedColumn ?? 0)
                ) as vscode.SourceBreakpoint | undefined;

                let breakpointId: string | undefined = addedBp?.id;
                let bpMessage: string;

                if (breakpointId) {
                    bpMessage = "Breakpoint added, verification pending.";
                    console.log(`[DebuggerApiWrapper] Found matching breakpoint ID: ${breakpointId}`);
                } else {
                    const addedBpFallback = currentBreakpoints
                        .filter(bp => bp instanceof vscode.SourceBreakpoint &&
                                      bp.location.uri.fsPath === uri.fsPath &&
                                      bp.location.range.start.line === zeroBasedLine)
                        .pop() as vscode.SourceBreakpoint | undefined;
                    breakpointId = addedBpFallback?.id;
                    if (breakpointId) {
                        bpMessage = "Breakpoint added (ID found by line match), verification pending.";
                        console.log(`[DebuggerApiWrapper] Found matching breakpoint ID by line: ${breakpointId}`);
                    } else {
                        bpMessage = "Breakpoint added (ID unavailable immediately), verification pending.";
                        console.log(`[DebuggerApiWrapper] Could not find matching breakpoint ID immediately.`);
                    }
                }

                return {
                    breakpoint: {
                        id: breakpointId,
                        verified: false,
                        source: { path: filePath },
                        line: lineNumber,
                        column: columnNumber,
                        message: bpMessage,
                        timestamp: new Date().toISOString()
                    }
                };
            }
        } catch (error: any) {
            const errorMsg = `添加断点时发生错误: ${error.message || '未知 VS Code API 错误'}`;
            console.error('[DebuggerApiWrapper] Error adding breakpoint:', error);
            return { error: { message: errorMsg } };
        }
    }

    /**
     * 获取当前所有断点。
     * @returns 返回一个包含所有断点信息的数组，格式符合 MCP 规范。
     */
    public getBreakpoints(): any[] {
        const vscodeBreakpoints = vscode.debug.breakpoints;
        const formattedBreakpoints = vscodeBreakpoints.map(bp => {
            let source: { path: string } | null = null;
            let line: number | null = null;
            let column: number | null = null;

            if (bp instanceof vscode.SourceBreakpoint) {
                source = { path: bp.location.uri.fsPath };
                line = bp.location.range.start.line + 1; // 1-based
                column = bp.location.range.start.character + 1; // 1-based
            }

            // 使用 'enabled' 作为 'verified' 的近似值
            const verified = bp.enabled;

            return {
                id: bp.id, // id 是 string 类型
                verified: verified,
                source: source,
                line: line,
                column: column,
                condition: bp.condition || undefined,
                hit_condition: bp.hitCondition || undefined,
                log_message: bp.logMessage || undefined,
            };
        });
        return formattedBreakpoints;
    }

    /**
     * 移除断点。
     * @param params 包含移除条件的参数对象。
     * @returns 返回操作结果。
     */
    async removeBreakpoint(params: RemoveBreakpointParams): Promise<{ status: typeof IPC_STATUS_SUCCESS | typeof IPC_STATUS_ERROR; message?: string }> {
        const allBreakpoints = vscode.debug.breakpoints;
        console.log(`[DebuggerApiWrapper] Received removeBreakpoint request with params:`, params);
        console.log(`[DebuggerApiWrapper] Current total breakpoints: ${allBreakpoints.length}`);

        try {
            if (params.clear_all) {
                if (allBreakpoints.length > 0) {
                    console.log(`[DebuggerApiWrapper] Clearing all ${allBreakpoints.length} breakpoints.`);
                    await vscode.debug.removeBreakpoints(allBreakpoints);
                    return { status: IPC_STATUS_SUCCESS, message: '已清除所有断点。' };
                } else {
                    console.log(`[DebuggerApiWrapper] No active breakpoints to clear.`);
                    return { status: IPC_STATUS_SUCCESS, message: '没有活动的断点可清除。' };
                }
            } else if (params.breakpoint_id !== undefined) {
                const targetId = String(params.breakpoint_id); // VS Code API 使用 string ID
                const breakpointToRemove = allBreakpoints.find(bp => bp.id === targetId);
                if (breakpointToRemove) {
                    console.log(`[DebuggerApiWrapper] Removing breakpoint by ID: ${targetId}`);
                    await vscode.debug.removeBreakpoints([breakpointToRemove]);
                    return { status: IPC_STATUS_SUCCESS, message: `已移除 ID 为 ${params.breakpoint_id} 的断点。` };
                } else {
                    console.log(`[DebuggerApiWrapper] Breakpoint with ID ${targetId} not found.`);
                    return { status: IPC_STATUS_ERROR, message: `未找到 ID 为 ${params.breakpoint_id} 的断点。` };
                }
            } else if (params.location) {
                const relativeFilePath = params.location.file_path; // 接收到的可能是相对路径
                const targetLine = params.location.line_number; // 1-based
                const zeroBasedTargetLine = targetLine - 1;

                console.log(`[DebuggerApiWrapper] Attempting to remove breakpoint by location: ${relativeFilePath}:${targetLine}`);

                // --- 解决方案核心：将相对路径转换为绝对路径 ---
                let absoluteFilePath: string;
                if (path.isAbsolute(relativeFilePath)) {
                    // 如果已经是绝对路径，直接使用
                    absoluteFilePath = relativeFilePath;
                    console.log(`[DebuggerApiWrapper] Path "${relativeFilePath}" is already absolute.`);
                } else {
                    // 如果是相对路径，基于工作区根目录解析
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (!workspaceFolders || workspaceFolders.length === 0) {
                        // 无法确定工作区，无法解析相对路径
                        console.error('[DebuggerApiWrapper] Cannot resolve relative path: No workspace folder found.');
                        return { status: IPC_STATUS_ERROR, message: '无法确定工作区根目录以解析相对路径。' };
                    }
                    // 通常使用第一个工作区文件夹作为根目录
                    const workspaceRootUri = workspaceFolders[0].uri;
                    // 使用 path.resolve 结合 workspaceFolder 的 fsPath 来构造绝对路径
                    absoluteFilePath = path.resolve(workspaceRootUri.fsPath, relativeFilePath);
                    console.log(`[DebuggerApiWrapper] Resolved relative path "${relativeFilePath}" to absolute path "${absoluteFilePath}" based on workspace root "${workspaceRootUri.fsPath}"`);
                }
                // --- 结束解决方案核心 ---


                let targetUri: vscode.Uri;
                try {
                    // 2. 使用转换后的绝对路径创建 Uri
                    targetUri = vscode.Uri.file(absoluteFilePath);
                } catch (pathError: any) {
                     console.error(`[DebuggerApiWrapper] Error creating Uri from absolute path "${absoluteFilePath}":`, pathError);
                     // 报告错误时使用绝对路径
                     return { status: IPC_STATUS_ERROR, message: `文件路径格式无效: ${absoluteFilePath} (${pathError.message})` };
                }

                console.log(`[DebuggerApiWrapper] Target URI for comparison: ${targetUri.toString()}, Target 0-based line: ${zeroBasedTargetLine}`);

                const breakpointsToRemove = allBreakpoints.filter(bp => {
                    if (bp instanceof vscode.SourceBreakpoint) {
                        // 3. (推荐) 使用 fsPath 进行比较，更健壮
                        const matchesPath = bp.location.uri.fsPath === targetUri.fsPath;
                        const matchesLine = bp.location.range.start.line === zeroBasedTargetLine;
                        // 可选：添加详细日志进行调试
                        // console.log(`[DebuggerApiWrapper] Comparing BP URI: ${bp.location.uri.fsPath} (Type: ${typeof bp.location.uri.fsPath}) with Target URI: ${targetUri.fsPath} (Type: ${typeof targetUri.fsPath}) => ${matchesPath}`);
                        // console.log(`[DebuggerApiWrapper] Comparing BP Line: ${bp.location.range.start.line} with Target Line: ${zeroBasedTargetLine} => ${matchesLine}`);
                        return matchesPath && matchesLine;
                    }
                    return false;
                });

                if (breakpointsToRemove.length > 0) {
                    console.log(`[DebuggerApiWrapper] Found ${breakpointsToRemove.length} breakpoints at location to remove.`);
                    await vscode.debug.removeBreakpoints(breakpointsToRemove);
                    // 4. 在返回消息中使用绝对路径
                    return { status: IPC_STATUS_SUCCESS, message: `已移除位于 ${absoluteFilePath}:${targetLine} 的 ${breakpointsToRemove.length} 个断点。` };
                } else {
                    console.log(`[DebuggerApiWrapper] No breakpoints found at location ${absoluteFilePath}:${targetLine}.`);
                    // 4. 在返回消息中使用绝对路径
                    return { status: IPC_STATUS_ERROR, message: `在 ${absoluteFilePath}:${targetLine} 未找到断点。` };
                }
            } else {
                // 参数校验已在 MCP 服务器端完成，理论上不会到这里
                console.error('[DebuggerApiWrapper] Invalid removeBreakpoint parameters received after server validation.');
                return { status: IPC_STATUS_ERROR, message: '无效的移除断点参数。' };
            }
        } catch (error: any) {
            console.error('[DebuggerApiWrapper] Error removing breakpoints:', error);
            return { status: IPC_STATUS_ERROR, message: `移除断点时发生错误: ${error.message || '未知 VS Code API 错误'}` };
        }
    }
    // --- startDebuggingAndWait 实现 ---
    public async startDebuggingAndWait(configurationName: string, noDebug: boolean): Promise<StartDebuggingResponsePayload> {
        const requestId = `start-${DebuggerApiWrapper.nextRequestId++}`;
        console.log(`[DebuggerApiWrapper] Starting debug request: ${requestId} for ${configurationName}`);

        return new Promise<StartDebuggingResponsePayload>(async (resolve) => {
            // ... 获取 folder, launchConfig, targetConfig 的逻辑不变 ...
            let folder: vscode.WorkspaceFolder | undefined;
            try {
                folder = vscode.workspace.workspaceFolders?.[0];
                if (!folder) {
                    throw new Error('无法确定工作区文件夹。');
                }
            } catch (error: any) {
                return resolve({ status: 'error', message: error.message });
            }
            const launchConfig = vscode.workspace.getConfiguration('launch', folder.uri);
            const configurations = launchConfig.get<vscode.DebugConfiguration[]>('configurations') || [];
            let targetConfig = configurations.find(conf => conf.name === configurationName);
            if (!targetConfig) {
              return resolve({ status: 'error', message: `找不到名为 '${configurationName}' 的调试配置。` });
            }
            if (noDebug) {
              targetConfig = { ...targetConfig, noDebug: true };
            }
            // --- 结束获取配置逻辑 ---

            const listeners: vscode.Disposable[] = [];
            let trackerDisposable: vscode.Disposable | undefined;

            // 封装的 resolve 函数，确保清理 (不变)
            const resolveCleanup = (result: StartDebuggingResponsePayload) => {
                // ... resolveCleanup 逻辑不变 ...
                const pendingRequest = this.pendingStartRequests.get(requestId);
                if (pendingRequest && !pendingRequest.isResolved) { // 防止重复 resolve
                    pendingRequest.isResolved = true; // 标记为已解决
                    this.cleanupRequest(requestId);
                    resolve(result);
                } else if (!pendingRequest) {
                    console.warn(`[DebuggerApiWrapper] Attempted to resolve already cleaned up request: ${requestId}`);
                } else {
                    console.warn(`[DebuggerApiWrapper] Attempted to resolve already resolved request: ${requestId}`);
                }
            };

            const timeout = 60000; // 插件内部超时 (不变)
            const timeoutTimer = setTimeout(() => {
                // ... timeout 逻辑不变 ...
                console.log(`[DebuggerApiWrapper] Request ${requestId} timed out.`);
                resolveCleanup({ status: 'timeout', message: `等待调试器首次停止或结束超时 (${timeout}ms)。` });
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
              console.log(`[DebuggerApiWrapper] Calling vscode.debug.startDebugging for ${configurationName}`);
              const success = await vscode.debug.startDebugging(folder, targetConfig);
              if (!success) {
                console.error(`[DebuggerApiWrapper] vscode.debug.startDebugging returned false for ${configurationName}. Request ID: ${requestId}`);
                resolveCleanup({ status: 'error', message: 'VS Code 报告无法启动调试会话（startDebugging 返回 false）。' });
              } else {
                console.log(`[DebuggerApiWrapper] vscode.debug.startDebugging call succeeded for ${configurationName}. Request ID: ${requestId}. Waiting for events...`);
              }
            } catch (error: any) {
              // ... 错误处理不变 ...
              console.error(`[DebuggerApiWrapper] Error calling vscode.debug.startDebugging for ${configurationName}. Request ID: ${requestId}:`, error);
              resolveCleanup({ status: 'error', message: `启动调试时出错: ${error.message}` });
            }
        });
    }

    // --- 辅助函数：构建 StopEventData ---
    private async buildStopEventData(session: vscode.DebugSession, stopBody: any): Promise<StopEventData> {
        const timestamp = new Date().toISOString();
        const threadId = stopBody.threadId;

        // 1. 获取调用栈
        let callStack: StopEventData['call_stack'] = [];
        try {
            const stackTraceResponse = await session.customRequest('stackTrace', { threadId: threadId, levels: 20 });
            if (stackTraceResponse && stackTraceResponse.stackFrames) {
                callStack = stackTraceResponse.stackFrames.map((frame: any) => ({
                    frame_id: frame.id,
                    function_name: frame.name || '<unknown>',
                    file_path: frame.source?.path || frame.source?.name || 'unknown',
                    line_number: frame.line,
                    column_number: frame.column,
                }));
            }
        } catch (e) { console.error("[DebuggerApiWrapper] Error fetching stack trace:", e); }

        // 2. 获取顶层帧变量
        let topFrameVariables: StopEventData['top_frame_variables'] = null;
        if (callStack.length > 0) {
            const topFrameId = callStack[0].frame_id;
            try {
                const scopesResponse = await session.customRequest('scopes', { frameId: topFrameId });
                // 优先查找 'Locals'，其次是第一个非 expensive 的作用域
                const localsScope = scopesResponse?.scopes?.find((s: any) => s.name.toLowerCase() === 'locals')
                                 || scopesResponse?.scopes?.find((s: any) => !s.expensive);

                if (localsScope && localsScope.variablesReference > 0) {
                    const variablesResponse = await session.customRequest('variables', { variablesReference: localsScope.variablesReference });
                    if (variablesResponse && variablesResponse.variables) {
                        topFrameVariables = {
                            scope_name: localsScope.name,
                            variables: variablesResponse.variables.map((v: any): VariableInfo => ({
                                name: v.name,
                                value: v.value,
                                type: v.type || null,
                                variables_reference: v.variablesReference || 0,
                                evaluate_name: v.evaluateName,
                                memory_reference: v.memoryReference,
                            }))
                        };
                    }
                }
            } catch (e) { console.error("[DebuggerApiWrapper] Error fetching top frame variables:", e); }
        }

        // 3. 构建 StopEventData 对象
        const sourceInfo = callStack[0] ? {
            path: callStack[0].file_path,
            name: path.basename(callStack[0].file_path) || callStack[0].file_path // 使用 path.basename 获取文件名
        } : null;

        return {
            timestamp,
            reason: stopBody.reason || 'unknown',
            thread_id: threadId,
            description: stopBody.description || null,
            text: stopBody.text || null,
            all_threads_stopped: stopBody.allThreadsStopped ?? null,
            source: sourceInfo,
            line: callStack[0]?.line_number ?? null,
            column: callStack[0]?.column_number ?? null,
            call_stack: callStack,
            top_frame_variables: topFrameVariables,
            hit_breakpoint_ids: stopBody.hitBreakpointIds || null,
        };
    }
}



