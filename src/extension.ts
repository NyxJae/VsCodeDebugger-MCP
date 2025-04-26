import * as vscode from 'vscode';
import { StatusBarManager } from './statusBarManager';
import { McpServerManager } from './mcpServerManager';
import { getStoredPort, storePort, getAutoStartConfig, storeAutoStartConfig } from './configManager'; // 添加 getAutoStartConfig, storeAutoStartConfig
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

	// --- 添加自动启动逻辑 ---
	const shouldAutoStart = getAutoStartConfig(context);
	outputChannel.appendLine(`[Extension] Auto-start config: ${shouldAutoStart}`);
	if (shouldAutoStart) {
		outputChannel.appendLine('[Extension] Auto-starting MCP server...');
		// 异步启动，不需要等待完成
		mcpServerManager.startServer().catch(error => {
			// 检查 error 是否有 message 属性
			const errorMessage = error instanceof Error ? error.message : String(error);
			outputChannel.appendLine(`[Extension] Error during auto-start: ${errorMessage}`);
			vscode.window.showErrorMessage(`Failed to auto-start MCP server: ${errorMessage}`);
		});
	}
	// --- 自动启动逻辑结束 ---
}

// showServerActionMenu 函数
async function showServerActionMenu(context: vscode.ExtensionContext, manager: StatusBarManager, serverManager: McpServerManager): Promise<void> {
	const status = manager.getStatus();
	const items: ActionQuickPickItem[] = []; // 明确类型为 ActionQuickPickItem
	const isAutoStartEnabled = getAutoStartConfig(context); // 获取当前配置

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
		label: '$(gear) Change Server Port',
		description: `Current configured port: ${getStoredPort(context)}`,
		action: async () => {
			const currentPort = getStoredPort(context);
			const newPortStr = await vscode.window.showInputBox({
				prompt: `Please enter the new MCP server port number (1025-65535)`,
				placeHolder: `Current: ${currentPort}`,
				value: currentPort.toString(),
				validateInput: (value) => {
					if (!value) {return 'Port number cannot be empty.';}
					if (!isValidPort(value)) {
						return 'Please enter a valid port number between 1025 and 65535.';
					}
					if (parseInt(value, 10) === currentPort) {
						return 'New port cannot be the same as the current port.';
					}
					return null;
				}
			});

			if (newPortStr) {
				const newPort = parseInt(newPortStr, 10);
				await storePort(context, newPort);
				vscode.window.showInformationMessage(`MCP server port updated to ${newPort}. Changes will take effect on the next server start.`);
				// 如果服务器正在运行，可以提示用户重启
				if (serverManager.isRunning()) { // 使用 McpServerManager 的 isRunning 方法
					 vscode.window.showInformationMessage('Please restart the MCP server to apply the new port setting.', 'Restart Now').then(selection => {
						 if (selection === 'Restart Now') {
							 serverManager.restartServer(); // 使用 McpServerManager 的 restartServer 方法
						 }
					 });
				}
			}
		}
	};

	items.push(changePortItem);

	// --- 添加切换自动启动选项 ---
	const toggleAutoStartItem: ActionQuickPickItem = {
		label: isAutoStartEnabled ? "$(check) Auto-start Enabled" : "$(circle-slash) Auto-start Disabled",
		description: isAutoStartEnabled ? "Click to disable auto-start on extension activation" : "Click to enable auto-start on extension activation",
		action: async () => {
			const newState = !isAutoStartEnabled;
			await storeAutoStartConfig(context, newState);
			vscode.window.showInformationMessage(`MCP server auto-start ${newState ? 'enabled' : 'disabled'}.`);
			// 重新显示菜单以更新状态 (可选，但体验更好)
			// 注意：直接调用 showServerActionMenu 可能导致无限循环，更好的方式是通知状态栏更新或让用户手动重新打开
			// 暂时不自动重新打开菜单
		}
	};
	items.push(toggleAutoStartItem);
	// --- 切换自动启动选项结束 ---

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
