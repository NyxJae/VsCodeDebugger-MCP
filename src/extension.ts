// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { StatusBarManager } from './statusBarManager'; // 导入 StatusBarManager

// 声明一个模块级变量来持有 StatusBarManager 实例
let statusBarManager: StatusBarManager;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "vscode-debugger-mcp" is now active!');

	// 实例化 StatusBarManager
	statusBarManager = new StatusBarManager(context);

	// 注册状态栏项点击时触发的命令
	const showServerMenuCommand = vscode.commands.registerCommand(statusBarManager.commandId, () => {
		// 调用 Quick Pick 菜单函数，并传入 manager 实例
		showServerActionMenu(statusBarManager);
	});

	// 将命令添加到 context.subscriptions
	context.subscriptions.push(showServerMenuCommand);

}

// 新增的 showServerActionMenu 函数
async function showServerActionMenu(manager: StatusBarManager): Promise<void> {
	const status = manager.getStatus();
	const items: vscode.QuickPickItem[] = [];

	// 定义 QuickPickItem 接口，扩展 action 属性
	interface ActionQuickPickItem extends vscode.QuickPickItem {
		action?: () => void;
	}

	if (status === 'running') {
		items.push({
			label: "$(debug-stop) Stop MCP Server",
			description: "Stops the (simulated) MCP server",
			action: () => manager.setStatus('stopped')
		} as ActionQuickPickItem);
		// 可以添加重启等其他选项
	} else if (status === 'stopped' || status === 'error') {
		 items.push({
			label: "$(debug-start) Start MCP Server",
			description: "Starts the (simulated) MCP server",
			// 模拟启动过程
			action: () => {
				manager.setStatus('starting');
				setTimeout(() => {
					 // 模拟成功启动
					manager.setStatus('running');
					// // 模拟启动失败
					// manager.setStatus('error');
					// vscode.window.showErrorMessage("Failed to start MCP Server (Simulated)");
				}, 1500); // 模拟延迟
			}
		} as ActionQuickPickItem);
	}
	// 添加一个始终显示的状态信息项
	items.push({
		 label: `Current Status: ${status}`,
		 description: 'Read-only status information',
		 // action: () => {} // 无操作或显示详细信息
	} as ActionQuickPickItem);


	const selectedOption = await vscode.window.showQuickPick(items, {
		placeHolder: "Select an action for the MCP Server",
		title: "Debug-MCP Control"
	});

	// 确保 selectedOption 存在，并且它确实有 action 属性，然后才调用
	if (selectedOption) {
		const actionItem = selectedOption as ActionQuickPickItem;
		if (actionItem.action) {
			actionItem.action();
		}
	}
}

// This method is called when your extension is deactivated
export function deactivate() {
	// 在插件停用时清理 StatusBarManager 资源
	statusBarManager?.dispose();
}
