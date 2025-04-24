import * as vscode from 'vscode';
import { StatusBarManager } from './statusBarManager';
import { McpServerManager } from './mcpServerManager';
import { getStoredPort, storePort } from './configManager';
import { isValidPort } from './utils/portUtils';
import { DebuggerApiWrapper } from './vscode/debuggerApiWrapper';
import { IpcHandler } from './managers/ipcHandler';
import { ProcessManager } from './managers/processManager';

// 声明模块级变量来持有实例
let statusBarManager: StatusBarManager;
let mcpServerManager: McpServerManager;
let debuggerApiWrapper: DebuggerApiWrapper;
let ipcHandler: IpcHandler;
let processManager: ProcessManager;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "vscode-debugger-mcp" is now active!');

	// 创建 OutputChannel
	// 注意：IpcHandler 和 ProcessManager 内部也会创建自己的 OutputChannel
	// 这里可以考虑是否需要一个顶层 Channel，或者让 Manager 自己管理
	// 暂时创建一个给 IpcHandler 使用 (虽然 IpcHandler 内部也会创建，但构造函数需要一个)
	// 更好的做法是让 McpServerManager 创建并传递给需要的组件
	outputChannel = vscode.window.createOutputChannel('Debug MCP Extension');
	context.subscriptions.push(outputChannel);

	// 实例化依赖项
	statusBarManager = new StatusBarManager(context);
	debuggerApiWrapper = new DebuggerApiWrapper();
	processManager = new ProcessManager(context.extensionPath);
	ipcHandler = new IpcHandler(outputChannel, processManager);


	// 实例化 McpServerManager，并传入正确的依赖项
	mcpServerManager = new McpServerManager(
		context,
		statusBarManager,
		processManager,
		ipcHandler,
		debuggerApiWrapper
	);

	// 注册状态栏项点击时触发的命令
	const showServerMenuCommand = vscode.commands.registerCommand(statusBarManager.commandId, () => {
		showServerActionMenu(context, statusBarManager, mcpServerManager);
	});

	// 注册复制配置命令
	const copyMcpConfigCommand = vscode.commands.registerCommand('DebugMcpManager.copyMcpConfig', () => {
		mcpServerManager.copyMcpConfigToClipboard();
	});

	// 将命令和 manager 实例添加到 context.subscriptions 以便自动清理
	context.subscriptions.push(showServerMenuCommand, copyMcpConfigCommand, statusBarManager, mcpServerManager);

}

// showServerActionMenu 函数
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
		description: `当前配置端口: ${getStoredPort(context)}`,
		action: async () => {
			const currentPort = getStoredPort(context);
			const newPortStr = await vscode.window.showInputBox({
				prompt: `请输入新的 MCP 服务器端口号 (1025-65535)`,
				placeHolder: `当前: ${currentPort}`,
				value: currentPort.toString(),
				validateInput: (value) => {
					if (!value) {return '端口号不能为空。';}
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

	if (selectedOption) {
		const actionItem = selectedOption as ActionQuickPickItem;
		if (actionItem.action) {
			actionItem.action();
		}
	}
}

export function deactivate() {
	// 清理工作由 VS Code 通过 context.subscriptions 自动处理
	console.log('Deactivating vscode-debugger-mcp extension...');
}
