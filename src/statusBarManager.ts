import * as vscode from 'vscode';

/**
 * 定义 MCP 服务器可能的状态。
 */
export type McpServerStatus = 'stopped' | 'running' | 'starting' | 'error';

/**
 * 管理 VS Code 状态栏中的 MCP 服务器状态显示和交互。
 */
export class StatusBarManager implements vscode.Disposable {
    private statusBarItem: vscode.StatusBarItem;
    private currentStatus: McpServerStatus = 'stopped';
    private currentPort: number | null = null; // 新增：存储当前端口
    // 定义命令 ID，用于触发显示服务器操作菜单
    public readonly commandId = 'DebugMcpManager.showServerMenu';

    /**
     * 创建一个新的 StatusBarManager 实例。
     * @param context VS Code 扩展上下文。
     */
    constructor(private context: vscode.ExtensionContext) {
        // 创建状态栏项，放置在右侧，优先级为 100
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        // 设置点击状态栏项时触发的命令
        this.statusBarItem.command = this.commandId;
        // 将状态栏项添加到扩展的订阅中，以便在扩展停用时自动清理
        context.subscriptions.push(this.statusBarItem);

        // 初始化状态栏显示和上下文键
        this.updateStatusBar();
        this.updateContext();
        // 显示状态栏项
        this.statusBarItem.show();
    }

    /**
     * 设置新的 MCP 服务器状态，并更新 UI。
     * @param newStatus 新的服务器状态。
     * @param port 可选的端口号，当状态为 'running' 时提供。
     */
    public setStatus(newStatus: McpServerStatus, port: number | null = null): void {
        // 状态和端口都未改变，无需更新
        if (this.currentStatus === newStatus && this.currentPort === port) {
            return;
        }
        this.currentStatus = newStatus;
        // 仅在 running 状态下存储端口，其他状态清除端口
        this.currentPort = (newStatus === 'running') ? port : null;
        this.updateStatusBar();
        this.updateContext();
        console.log(`MCP Status changed to: ${this.currentStatus}${this.currentPort ? ` (Port: ${this.currentPort})` : ''}`); // 调试日志
    }

    /**
     * 获取当前的 MCP 服务器状态。
     * @returns 当前的服务器状态。
     */
    public getStatus(): McpServerStatus {
        return this.currentStatus;
    }

    /**
     * 根据当前状态更新状态栏项的文本、图标和提示信息。
     */
    private updateStatusBar(): void {
        switch (this.currentStatus) {
            case 'running':
                // 在运行状态下显示端口号（如果可用）
                const portText = this.currentPort ? ` (Port: ${this.currentPort})` : '';
                this.statusBarItem.text = `$(debug-start) Debug-MCP: Running${portText}`;
                this.statusBarItem.tooltip = `Debug MCP Server is Running${portText}. Click to manage.`;
                this.statusBarItem.backgroundColor = undefined;
                break;
            case 'starting':
                this.statusBarItem.text = `$(loading~spin) Debug-MCP: Starting...`;
                this.statusBarItem.tooltip = `Debug MCP Server is Starting...`;
                this.statusBarItem.backgroundColor = undefined;
                break;
            case 'error':
                this.statusBarItem.text = `$(error) Debug-MCP: Error`;
                this.statusBarItem.tooltip = `Debug MCP Server Error. Click to manage.`;
                // 使用 VS Code 定义的错误背景色主题颜色
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
            case 'stopped':
            default:
                this.statusBarItem.text = `$(debug-stop) Debug-MCP: Stopped`;
                this.statusBarItem.tooltip = `Debug MCP Server is Stopped. Click to manage.`;
                this.statusBarItem.backgroundColor = undefined;
                break;
        }
    }

    /**
     * 更新 VS Code 的上下文键，反映当前的服务器状态。
     * 这允许在 package.json 中根据状态控制菜单项等的可见性。
     */
    private updateContext(): void {
        vscode.commands.executeCommand('setContext', 'DebugMcpManager.serverStatus', this.currentStatus);
    }

    /**
     * 释放状态栏项资源。
     */
    dispose(): void {
        // 虽然 statusBarItem 已添加到 subscriptions，但显式调用 dispose() 也无妨，确保清理
        this.statusBarItem.dispose();
    }
}