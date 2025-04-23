// src/vscode/breakpointManager.ts
import * as vscode from 'vscode';
import * as path from 'path'; // 添加 path 模块导入
import { SetBreakpointParams, RemoveBreakpointParams } from '../types'; // 确认路径，保持不变
import { IPC_STATUS_SUCCESS, IPC_STATUS_ERROR } from '../constants'; // 确认路径，保持不变

export class BreakpointManager {
    // private breakpoints: Map<string, vscode.Breakpoint[]> = new Map(); // 暂时不使用内部 Map，直接依赖 VS Code API

    constructor() {
        // 初始化逻辑，例如监听断点变化事件
        this.initializeBreakpointListener(); // 取消注释
        console.log("BreakpointManager initialized.");
    }

    private initializeBreakpointListener(): void { // 取消注释并实现
        vscode.debug.onDidChangeBreakpoints(e => {
            // 这里可以添加更复杂的逻辑来同步内部状态（如果需要）
            // 例如，更新一个映射表，或者触发事件通知其他部分
            console.log('[BreakpointManager] Breakpoints changed:', {
                added: e.added.length,
                removed: e.removed.length,
                changed: e.changed.length
            });
            // 可以在这里验证添加的断点是否成功，并更新状态
        });
    }

    // --- 核心方法 (从 debuggerApiWrapper.ts 迁移并调整) ---

    public async addBreakpoint(payload: SetBreakpointParams): Promise<{ breakpoint: any } | { error: { message: string } }> {
        const {
            file_path: filePath, // 已经是绝对路径
            line_number: lineNumber,
            column_number: columnNumber,
            condition,
            hit_condition: hitCondition,
            log_message: logMessage
        } = payload;

        // 基本参数校验
        if (!filePath || typeof lineNumber !== 'number' || lineNumber <= 0) {
            const errorMsg = 'Invalid setBreakpoint request payload: missing or invalid filePath or lineNumber.';
            console.error(`[BreakpointManager] ${errorMsg}`);
            return { error: { message: errorMsg } };
        }

        let uri: vscode.Uri;
        try {
            uri = vscode.Uri.file(filePath);
        } catch (pathError: any) {
            const errorMsg = `文件路径格式无效: ${filePath} (${pathError.message})`;
            console.error(`[BreakpointManager] Error creating Uri from path "${filePath}":`, pathError);
            return { error: { message: errorMsg } };
        }

        const absoluteFilePath = uri.fsPath;
        const zeroBasedLine = lineNumber - 1;
        const zeroBasedColumn = (typeof columnNumber === 'number' && columnNumber > 0) ? columnNumber - 1 : undefined;

        try {
            // 查找现有断点 (逻辑与 debuggerApiWrapper 类似)
            const existingBreakpoints = vscode.debug.breakpoints;
            const existingBp = existingBreakpoints.find(bp => {
                if (!(bp instanceof vscode.SourceBreakpoint)) { return false; }
                const bpLocation = bp.location;
                if (bpLocation.uri.fsPath !== absoluteFilePath) { return false; }
                if (bpLocation.range.start.line !== zeroBasedLine) { return false; }
                if (zeroBasedColumn !== undefined) {
                    return bpLocation.range.start.character === zeroBasedColumn;
                }
                return true; // 只匹配行
            }) as vscode.SourceBreakpoint | undefined;

            if (existingBp) {
                console.log(`[BreakpointManager] Found existing breakpoint at location. Reusing ID: ${existingBp.id}`);
                // 使用 mapVsCodeBreakpointToMcp 格式化返回
                return { breakpoint: this.mapVsCodeBreakpointToMcp(existingBp) };
            } else {
                console.log(`[BreakpointManager] No existing breakpoint found at location. Adding new one.`);
                const position = new vscode.Position(zeroBasedLine, zeroBasedColumn ?? 0);
                const location = new vscode.Location(uri, position);
                const newBreakpoint = new vscode.SourceBreakpoint(location, true, condition, hitCondition, logMessage);

                vscode.debug.addBreakpoints([newBreakpoint]);
                console.log(`[BreakpointManager] Added breakpoint via API at ${filePath}:${lineNumber}`);

                // 尝试查找刚添加的断点以获取 ID (使用辅助函数)
                const addedBp = await this.findAddedBreakpoint(newBreakpoint);
                if (addedBp) {
                    console.log(`[BreakpointManager] Found added breakpoint with ID: ${addedBp.id}`);
                    return { breakpoint: this.mapVsCodeBreakpointToMcp(addedBp) };
                } else {
                    // 如果无法立即找到，返回一个未验证的表示
                    console.warn(`[BreakpointManager] Could not immediately find the added breakpoint. Returning pending state.`);
                    // 仍然尝试映射 newBreakpoint，但标记为未验证
                    return { breakpoint: this.mapVsCodeBreakpointToMcp(newBreakpoint, true) };
                }
            }
        } catch (error: any) {
            const errorMsg = `添加断点时发生错误: ${error.message || '未知 VS Code API 错误'}`;
            console.error('[BreakpointManager] Error adding breakpoint:', error);
            return { error: { message: errorMsg } };
        }
    }

    public getBreakpoints(): any[] { // 返回类型应与 MCP 规范一致
        // 使用 mapVsCodeBreakpointToMcp 格式化
        return vscode.debug.breakpoints.map(bp => this.mapVsCodeBreakpointToMcp(bp));
    }

    public async removeBreakpoint(params: RemoveBreakpointParams): Promise<{ status: typeof IPC_STATUS_SUCCESS | typeof IPC_STATUS_ERROR; message?: string }> {
        const allBreakpoints = vscode.debug.breakpoints;
        console.log(`[BreakpointManager] Received removeBreakpoint request with params:`, params);
        console.log(`[BreakpointManager] Current total breakpoints: ${allBreakpoints.length}`);

        try {
            let breakpointsToRemove: vscode.Breakpoint[] = [];

            if (params.clear_all) {
                if (allBreakpoints.length > 0) {
                    console.log(`[BreakpointManager] Clearing all ${allBreakpoints.length} breakpoints.`);
                    breakpointsToRemove = [...allBreakpoints];
                } else {
                    console.log(`[BreakpointManager] No active breakpoints to clear.`);
                    return { status: IPC_STATUS_SUCCESS, message: '没有活动的断点可清除。' };
                }
            } else if (params.breakpoint_id !== undefined) {
                const targetId = String(params.breakpoint_id); // VS Code API 使用 string ID
                // 使用辅助函数查找
                const bp = this.findBreakpointById(targetId);
                if (bp) {
                    console.log(`[BreakpointManager] Removing breakpoint by ID: ${targetId}`);
                    breakpointsToRemove.push(bp);
                } else {
                    console.log(`[BreakpointManager] Breakpoint with ID ${targetId} not found.`);
                    return { status: IPC_STATUS_ERROR, message: `未找到 ID 为 ${params.breakpoint_id} 的断点。` };
                }
            } else if (params.location) {
                const relativeFilePath = params.location.file_path;
                const targetLine = params.location.line_number; // 1-based
                const zeroBasedTargetLine = targetLine - 1;

                console.log(`[BreakpointManager] Attempting to remove breakpoint by location: ${relativeFilePath}:${targetLine}`);

                // --- 路径解析逻辑 (从 debuggerApiWrapper 迁移) ---
                let absoluteFilePath: string;
                if (path.isAbsolute(relativeFilePath)) {
                    absoluteFilePath = relativeFilePath;
                } else {
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (!workspaceFolders || workspaceFolders.length === 0) {
                        console.error('[BreakpointManager] Cannot resolve relative path: No workspace folder found.');
                        return { status: IPC_STATUS_ERROR, message: '无法确定工作区根目录以解析相对路径。' };
                    }
                    const workspaceRootUri = workspaceFolders[0].uri;
                    absoluteFilePath = path.resolve(workspaceRootUri.fsPath, relativeFilePath);
                    console.log(`[BreakpointManager] Resolved relative path "${relativeFilePath}" to absolute path "${absoluteFilePath}"`);
                }
                // --- 结束路径解析 ---

                let targetUri: vscode.Uri;
                try {
                    targetUri = vscode.Uri.file(absoluteFilePath);
                } catch (pathError: any) {
                     console.error(`[BreakpointManager] Error creating Uri from absolute path "${absoluteFilePath}":`, pathError);
                     return { status: IPC_STATUS_ERROR, message: `文件路径格式无效: ${absoluteFilePath} (${pathError.message})` };
                }

                console.log(`[BreakpointManager] Target URI for comparison: ${targetUri.toString()}, Target 0-based line: ${zeroBasedTargetLine}`);

                breakpointsToRemove = allBreakpoints.filter(bp => {
                    if (bp instanceof vscode.SourceBreakpoint) {
                        const matchesPath = bp.location.uri.fsPath === targetUri.fsPath;
                        const matchesLine = bp.location.range.start.line === zeroBasedTargetLine;
                        return matchesPath && matchesLine;
                    }
                    return false;
                });

                if (breakpointsToRemove.length === 0) {
                    console.log(`[BreakpointManager] No breakpoints found at location ${absoluteFilePath}:${targetLine}.`);
                    return { status: IPC_STATUS_ERROR, message: `在 ${absoluteFilePath}:${targetLine} 未找到断点。` };
                }
                 console.log(`[BreakpointManager] Found ${breakpointsToRemove.length} breakpoints at location to remove.`);

            } else {
                console.error('[BreakpointManager] Invalid removeBreakpoint parameters.');
                return { status: IPC_STATUS_ERROR, message: '无效的移除断点参数。请提供 breakpoint_id, location, 或 clear_all。' };
            }

            if (breakpointsToRemove.length > 0) {
                await vscode.debug.removeBreakpoints(breakpointsToRemove);
                console.log(`[BreakpointManager] Removed ${breakpointsToRemove.length} breakpoint(s).`);
                return { status: IPC_STATUS_SUCCESS, message: `成功移除 ${breakpointsToRemove.length} 个断点。` };
            } else if (!params.clear_all) {
                 // 如果不是 clear_all 且没找到要移除的断点（ID 或 location），上面已经返回 ERROR 了
                 // 这里理论上不会执行，除非 clear_all 时没有断点
                 return { status: IPC_STATUS_SUCCESS, message: '没有需要移除的断点。' };
            }

        } catch (error: any) {
            console.error('[BreakpointManager] Error removing breakpoints:', error);
            return { status: IPC_STATUS_ERROR, message: `移除断点时发生错误: ${error.message || '未知 VS Code API 错误'}` };
        }
        // 添加默认返回值以防万一，尽管逻辑上应该总能返回一个结果
        return { status: IPC_STATUS_ERROR, message: '移除断点时发生未知内部错误。' };
    }


    // --- 辅助函数 (根据规划示例实现) ---
    private mapVsCodeBreakpointToMcp(bp: vscode.Breakpoint, pendingVerification = false): any {
        // 将 VS Code Breakpoint 对象映射为 MCP 工具规范所需的格式
        const mcpBreakpoint: any = {
            id: bp.id, // 直接使用 VS Code 内部 ID (string)
            // 'verified' 状态映射: VS Code 的 'enabled' 状态不完全等同于 DAP 的 'verified'
            // 'verified' 通常指调试器后端确认了断点位置。
            // onDidChangeBreakpoints 事件中的 'changed' 断点可能包含验证状态更新。
            // 暂时使用 'enabled' 作为近似值，或者依赖 onDidChangeBreakpoints 更新。
            // 如果是刚添加且未找到 ID，则强制为 false。
            verified: pendingVerification ? false : bp.enabled,
            enabled: bp.enabled, // 也包含 enabled 状态
            condition: bp.condition || undefined,
            hitCondition: bp.hitCondition || undefined,
            logMessage: bp.logMessage || undefined,
            timestamp: new Date().toISOString() // 添加时间戳
        };

        if (bp instanceof vscode.SourceBreakpoint) {
            mcpBreakpoint.source = { path: bp.location.uri.fsPath };
            mcpBreakpoint.line = bp.location.range.start.line + 1; // 1-based
            mcpBreakpoint.column = bp.location.range.start.character + 1; // 1-based
        } else if (bp instanceof vscode.FunctionBreakpoint) {
            mcpBreakpoint.functionName = bp.functionName;
            // 函数断点没有 source/line/column
        }
        // 移除了对 DataBreakpoint 和 InstructionBreakpoint 的处理，因为它们导致了 TS 错误
        // 如果将来需要支持这些类型，需要确保 VS Code API 版本兼容并正确处理类型
        // ... 其他断点类型 (如果需要支持)

        return mcpBreakpoint;
    }

    private async findAddedBreakpoint(targetBp: vscode.SourceBreakpoint): Promise<vscode.Breakpoint | undefined> {
        // 尝试查找刚刚添加的断点，可能需要轮询或监听事件
        // 这是一个简化示例，依赖短暂延时后查找
        await new Promise(resolve => setTimeout(resolve, 150)); // 短暂等待 VS Code 处理 (与原代码一致)
        const currentBreakpoints = vscode.debug.breakpoints;
        return currentBreakpoints.find(bp =>
            bp instanceof vscode.SourceBreakpoint &&
            bp.location.uri.fsPath === targetBp.location.uri.fsPath &&
            bp.location.range.start.line === targetBp.location.range.start.line &&
            bp.location.range.start.character === targetBp.location.range.start.character && // 包含 column 比较
            bp.condition === targetBp.condition && // 比较其他属性以提高准确性
            bp.hitCondition === targetBp.hitCondition &&
            bp.logMessage === targetBp.logMessage
        );
    }

     private findBreakpointById(id: string): vscode.Breakpoint | undefined {
         // 实现通过 ID 查找断点的逻辑
         // 直接使用 VS Code 的 bp.id (string)
         return vscode.debug.breakpoints.find(bp => bp.id === id);
     }

    // 可能需要添加 ID 管理逻辑，如果 VS Code ID 不可靠
    // private managedBreakpointIds: Map<vscode.Breakpoint, number> = new Map();
    // private nextBreakpointId = 1;
    // private getManagedId(bp: vscode.Breakpoint): number { ... }
}