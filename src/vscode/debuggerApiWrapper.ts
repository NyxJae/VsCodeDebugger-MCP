import * as vscode from 'vscode';

/**
 * 封装与 VS Code Debug API 的交互逻辑。
 */
export class DebuggerApiWrapper {

    /**
     * 添加断点。
     * @param payload 包含断点信息的对象，例如 { file_path, line_number, column_number?, condition?, hit_condition?, log_message? }
     * @returns 返回一个包含断点信息的 Promise 对象，格式符合 MCP 规范。
     */
    public async addBreakpoint(payload: any): Promise<any> {
        const {
            file_path: filePath,
            line_number: lineNumber,
            column_number: columnNumber,
            condition,
            hit_condition: hitCondition,
            log_message: logMessage
        } = payload;

        // 基本参数校验
        if (!filePath || typeof lineNumber !== 'number' || lineNumber <= 0) {
            throw new Error('Invalid setBreakpoint request payload: missing or invalid filePath or lineNumber.');
        }

        const uri = vscode.Uri.file(filePath);
        const absoluteFilePath = uri.fsPath; // 获取绝对路径用于比较
        // 行号在 VS Code API 中是 0-based，用户提供的是 1-based
        const zeroBasedLine = lineNumber - 1;
        // 列号也是 0-based，如果未提供则为 undefined
        const zeroBasedColumn = (typeof columnNumber === 'number' && columnNumber > 0) ? columnNumber - 1 : undefined;

        // --- 先查：查找现有断点 ---
        const existingBreakpoints = vscode.debug.breakpoints;
        const existingBp = existingBreakpoints.find(bp => {
            if (!(bp instanceof vscode.SourceBreakpoint)) {
                return false;
            }
            const bpLocation = bp.location;
            // 比较文件路径 (绝对路径)
            if (bpLocation.uri.fsPath !== absoluteFilePath) {
                return false;
            }
            // 比较行号 (0-based)
            if (bpLocation.range.start.line !== zeroBasedLine) {
                return false;
            }
            // 比较列号 (0-based, 仅当请求中提供了有效的列号时)
            if (zeroBasedColumn !== undefined) {
                return bpLocation.range.start.character === zeroBasedColumn;
            }
            // 如果请求未提供列号，则仅匹配文件和行即可
            return true;
        }) as vscode.SourceBreakpoint | undefined;

        if (existingBp) {
            // --- 如果找到，复用现有断点 ---
            console.log(`[DebuggerApiWrapper] Found existing breakpoint at location. Reusing ID: ${existingBp.id}`);
            return {
                breakpoint: {
                    id: existingBp.id, // 使用现有 ID
                    verified: false, // 保持 false, 依赖后续事件更新
                    source: { path: filePath },
                    line: lineNumber, // 返回 1-based 行号
                    column: columnNumber, // 返回请求的列号 (1-based)
                    message: "Reused existing breakpoint at this location.", // 添加提示信息
                    timestamp: new Date().toISOString() // 生成当前时间戳
                }
            };
        } else {
            // --- 如果没找到，执行添加逻辑 ---
            console.log(`[DebuggerApiWrapper] No existing breakpoint found at location. Adding new one.`);
            // 如果请求未提供列号，VS Code 通常在行的开头添加断点 (列 0)
            const position = new vscode.Position(zeroBasedLine, zeroBasedColumn ?? 0);
            const location = new vscode.Location(uri, position);

            const breakpoint = new vscode.SourceBreakpoint(
                location,
                true, // enabled
                condition,
                hitCondition,
                logMessage
            );

            // 调用 VS Code API 设置断点
            await vscode.debug.addBreakpoints([breakpoint]);
            console.log(`[DebuggerApiWrapper] Added breakpoint via API.`);

            // --- 获取断点 ID (需要延迟以确保 API 更新) ---
            await new Promise(resolve => setTimeout(resolve, 100)); // e.g., 100ms delay

            const currentBreakpoints = vscode.debug.breakpoints;
            console.log(`[DebuggerApiWrapper] Current breakpoints count after add: ${currentBreakpoints.length}`);

            // 查找与刚添加的位置精确匹配的断点 (使用添加时的列号 zeroBasedColumn ?? 0)
            const addedBp = currentBreakpoints.find(bp =>
                bp instanceof vscode.SourceBreakpoint &&
                bp.location.uri.fsPath === uri.fsPath &&
                bp.location.range.start.line === zeroBasedLine &&
                bp.location.range.start.character === (zeroBasedColumn ?? 0) // 匹配添加时使用的列
            ) as vscode.SourceBreakpoint | undefined;

            let breakpointId: string | undefined = addedBp?.id;
            let bpMessage: string;

            if (breakpointId) {
                bpMessage = "Breakpoint added, verification pending.";
                console.log(`[DebuggerApiWrapper] Found matching breakpoint ID: ${breakpointId}`);
            } else {
                // 如果精确匹配失败，尝试只匹配行号（作为备选方案）
                const addedBpFallback = currentBreakpoints
                    .filter(bp => bp instanceof vscode.SourceBreakpoint &&
                                  bp.location.uri.fsPath === uri.fsPath &&
                                  bp.location.range.start.line === zeroBasedLine)
                    .pop() as vscode.SourceBreakpoint | undefined; // 取最后一个匹配行的

                breakpointId = addedBpFallback?.id;
                if (breakpointId) {
                    bpMessage = "Breakpoint added (ID found by line match), verification pending.";
                    console.log(`[DebuggerApiWrapper] Found matching breakpoint ID by line: ${breakpointId}`);
                } else {
                    bpMessage = "Breakpoint added (ID unavailable immediately), verification pending.";
                    console.log(`[DebuggerApiWrapper] Could not find matching breakpoint ID immediately.`);
                }
            }

            // --- 构造成功响应 ---
            return {
                breakpoint: {
                    id: breakpointId, // 可能为 undefined
                    verified: false, // API 限制，初始为 false
                    source: { path: filePath },
                    line: lineNumber, // 返回 1-based 行号
                    column: columnNumber, // 返回请求的列号 (1-based)
                    message: bpMessage,
                    timestamp: new Date().toISOString() // 生成时间戳
                }
            };
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

            // 检查断点是否为 SourceBreakpoint，只有它才有 location
            if (bp instanceof vscode.SourceBreakpoint) {
                source = { path: bp.location.uri.fsPath };
                line = bp.location.range.start.line + 1; // 1-based
                column = bp.location.range.start.character + 1; // 1-based
            }
            // 对于 FunctionBreakpoint 或其他类型，source/line/column 保持 null

            // 注意: ProjectBrief.md 中的 'verified' 指调试器是否验证成功。
            // vscode.Breakpoint 没有直接的 'verified' 状态。
            // 这里使用 'enabled' (用户是否启用断点) 作为近似值。
            const verified = bp.enabled;

            return {
                id: bp.id, // id 是 string 类型
                verified: verified,
                source: source,
                line: line,
                column: column,
                condition: bp.condition || undefined, // 确保 undefined 而不是空字符串
                hit_condition: bp.hitCondition || undefined, // 确保 undefined 而不是空字符串
                log_message: bp.logMessage || undefined, // 确保 undefined 而不是空字符串
            };
        });
        return formattedBreakpoints;
    }
}