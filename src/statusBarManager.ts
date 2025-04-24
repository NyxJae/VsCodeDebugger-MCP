import * as vscode from 'vscode';

/** 定义 MCP 服务器可能的状态。 */
export type McpServerStatus = 'stopped' | 'running' | 'starting' | 'error';

/** 管理 VS Code 状态栏中的 MCP 服务器状态显示和交互。 */
export class StatusBarManager implements vscode.Disposable {
    private statusBarItem: vscode.StatusBarItem;
    private currentStatus: McpServerStatus = 'stopped';
    private currentPort: number | null = null;
    public readonly commandId = 'DebugMcpManager.showServerMenu';

    /** 创建一个新的 StatusBarManager 实例。 */
    constructor(private context: vscode.ExtensionContext) {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = this.commandId;
        context.subscriptions.push(this.statusBarItem);

        this.updateStatusBar();
        this.updateContext();
        this.statusBarItem.show();
    }

    /** 设置新的 MCP 服务器状态，并更新 UI。 */
    public setStatus(newStatus: McpServerStatus, port: number | null = null): void {
        if (this.currentStatus === newStatus && this.currentPort === port) {
            return;
        }
        this.currentStatus = newStatus;
        this.currentPort = (newStatus === 'running') ? port : null;
        this.updateStatusBar();
        this.updateContext();
    }

    /** 获取当前的 MCP 服务器状态。 */
    public getStatus(): McpServerStatus {
        return this.currentStatus;
    }

    /** 根据当前状态更新状态栏项。 */
    private updateStatusBar(): void {
        switch (this.currentStatus) {
            case 'running':
                const portText = this.currentPort ? ` (Port: ${this.currentPort})` : '';
                this.statusBarItem.text = `$(debug-start) Debug-MCP: Running${portText}`;
                this.statusBarItem.tooltip = `Debug MCP Server is Running${portText}. Click to manage.`;
                this.statusBarItem.backgroundColor = undefined;
                break;
            case 'starting':
                const startingPortText = this.currentPort ? ` (Port: ${this.currentPort})` : ' (Port: ...)';
                this.statusBarItem.text = `$(loading~spin) Debug-MCP: Starting${startingPortText}`;
                this.statusBarItem.tooltip = `Debug MCP Server is Starting${startingPortText}`;
                this.statusBarItem.backgroundColor = undefined;
                break;
            case 'error':
                this.statusBarItem.text = `$(error) Debug-MCP: Error`;
                this.statusBarItem.tooltip = `Debug MCP Server Error. Click to manage.`;
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

    /** 更新 VS Code 的上下文键。 */
    private updateContext(): void {
        vscode.commands.executeCommand('setContext', 'DebugMcpManager.serverStatus', this.currentStatus);
    }

    /** 释放状态栏项资源。 */
    dispose(): void {
        this.statusBarItem.dispose();
    }
}