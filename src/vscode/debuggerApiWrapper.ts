import * as vscode from 'vscode';
import * as path from 'path'; // 1. 引入 Node.js path 模块
import { RemoveBreakpointParams, SetBreakpointParams } from '../types'; // 导入类型
import { IPC_STATUS_SUCCESS, IPC_STATUS_ERROR } from '../constants'; // 导入状态常量

/**
 * 封装与 VS Code Debug API 的交互逻辑。
 */
export class DebuggerApiWrapper {

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
}