// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { StatusBarManager } from './statusBarManager'; // 导入 StatusBarManager
import { McpServerManager } from './mcpServerManager'; // 导入 McpServerManager
import { getStoredPort, storePort } from './configManager'; // 导入配置管理函数
import { isValidPort } from './utils/portUtils'; // 导入端口工具函数

// 声明模块级变量来持有实例
let statusBarManager: StatusBarManager;
let mcpServerManager: McpServerManager;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "vscode-debugger-mcp" is now active!');

	// 实例化 StatusBarManager
	statusBarManager = new StatusBarManager(context);
	// 实例化 McpServerManager，并传入 statusBarManager
	mcpServerManager = new McpServerManager(context, statusBarManager);

	// 注册状态栏项点击时触发的命令
	const showServerMenuCommand = vscode.commands.registerCommand(statusBarManager.commandId, () => {
		// 调用 Quick Pick 菜单函数，并传入 context 和两个 manager 实例
		showServerActionMenu(context, statusBarManager, mcpServerManager);
	});

	// 注册复制配置命令
	const copyMcpConfigCommand = vscode.commands.registerCommand('DebugMcpManager.copyMcpConfig', () => {
		mcpServerManager.copyMcpConfigToClipboard(); // 调用 McpServerManager 的新方法
	});

	// 将命令和 manager 实例添加到 context.subscriptions 以便自动清理
	context.subscriptions.push(showServerMenuCommand, copyMcpConfigCommand, statusBarManager, mcpServerManager);
	// 注意这里添加了 copyMcpConfigCommand

}

// 新增的 showServerActionMenu 函数
async function showServerActionMenu(context: vscode.ExtensionContext, manager: StatusBarManager, serverManager: McpServerManager): Promise<void> {
	const status = manager.getStatus();
	const items: vscode.QuickPickItem[] = [];

	// 定义 QuickPickItem 接口，扩展 action 属性
	interface ActionQuickPickItem extends vscode.QuickPickItem {
		action?: () => void;
	}

	if (status === 'running') {
		items.push({
			label: "$(debug-stop) Stop Debug MCP Server",
			description: "Stops the Debug MCP server",
			action: () => serverManager.stopServer() // 调用 McpServerManager 的 stopServer
		} as ActionQuickPickItem);
		// 可以添加重启等其他选项
	} else if (status === 'stopped' || status === 'error') {
		items.push({
			label: "$(debug-start) Start Debug MCP Server",
			description: "Starts the Debug MCP Server",
			action: () => serverManager.startServer() // 调用 McpServerManager 的 startServer
		} as ActionQuickPickItem);
	}

	// 添加复制 MCP 配置 (RooCode/Cline 格式) 的菜单项
	items.push({
		label: "$(clippy) Copy MCP Config ",
		description: "Copy MCP server config",
		action: () => vscode.commands.executeCommand('DebugMcpManager.copyMcpConfig')
	} as ActionQuickPickItem);

	// 添加 "更改端口" 选项
	const changePortItem: vscode.QuickPickItem & { action: () => Promise<void> } = {
		label: '$(gear) 更改服务器端口',
		description: `当前配置端口: ${getStoredPort(context)}`, // 显示当前存储的端口
		action: async () => {
			const currentPort = getStoredPort(context);
			const newPortStr = await vscode.window.showInputBox({
				prompt: `请输入新的 MCP 服务器端口号 (1025-65535)`,
				placeHolder: `当前: ${currentPort}`,
				value: currentPort.toString(), // 预填当前值
				validateInput: (value) => {
					if (!value) return '端口号不能为空。';
					if (!isValidPort(value)) {
						return '请输入 1025 到 65535 之间的有效端口号。';
					}
					if (parseInt(value, 10) === currentPort) {
						return '新端口不能与当前端口相同。';
					}
					return null;
				}
			});

			if (newPortStr) {
				const newPort = parseInt(newPortStr, 10);
				await storePort(context, newPort);
				vscode.window.showInformationMessage(`MCP 服务器端口已更新为 ${newPort}。更改将在下次服务器启动时生效。`);
				// 如果服务器正在运行，可以提示用户重启
				if (serverManager.isRunning()) { // 使用 McpServerManager 的 isRunning 方法
					 vscode.window.showInformationMessage('请重启 MCP 服务器以应用新的端口设置。', '立即重启').then(selection => {
						 if (selection === '立即重启') {
							 serverManager.restartServer(); // 使用 McpServerManager 的 restartServer 方法
						 }
					 });
				}
			}
		}
	};

	items.push(changePortItem);

	// 添加一个始终显示的状态信息项
	items.push({
		label: `Current Status: ${status}`,
		description: 'Read-only status information',
		// action: () => {} // 无操作或显示详细信息
	} as ActionQuickPickItem);


	const selectedOption = await vscode.window.showQuickPick(items, {
		placeHolder: "Select an action for the Debug MCP Server",
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
	// 清理工作由 VS Code 通过 context.subscriptions 自动处理
	// statusBarManager 和 mcpServerManager 的 dispose 方法会被调用
	console.log('Deactivating vscode-debugger-mcp extension...');
}
