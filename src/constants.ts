// src/constants.ts
// Constants for the VS Code extension part

export const IPC_COMMAND_PREFIX = 'vscode-debugger-mcp:';

// IPC Commands sent from Extension to Server
export const IPC_COMMAND_SET_BREAKPOINT = `${IPC_COMMAND_PREFIX}setBreakpoint`;
export const IPC_COMMAND_GET_BREAKPOINTS = `${IPC_COMMAND_PREFIX}getBreakpoints`;
export const IPC_COMMAND_GET_CONFIGURATIONS = `${IPC_COMMAND_PREFIX}getConfigurations`;
export const IPC_COMMAND_REMOVE_BREAKPOINT = `${IPC_COMMAND_PREFIX}removeBreakpoint`; // 新增
export const IPC_COMMAND_START_DEBUGGING_REQUEST = `${IPC_COMMAND_PREFIX}startDebuggingRequest`; // 新增
export const IPC_COMMAND_START_DEBUGGING_RESPONSE = `${IPC_COMMAND_PREFIX}startDebuggingResponse`; // 新增
export const IPC_COMMAND_CONTINUE_DEBUGGING = `${IPC_COMMAND_PREFIX}continue_debugging`; // 新增
export const IPC_COMMAND_STEP_EXECUTION = `${IPC_COMMAND_PREFIX}stepExecution`; // 新增 stepExecution 命令常量
export const IPC_COMMAND_STOP_DEBUGGING = `${IPC_COMMAND_PREFIX}stopDebugging`; // 新增 stopDebugging 命令常量
// Add more commands as needed

// Status Bar Text
export const STATUS_BAR_RUNNING_TEXT = '$(debug-start) Debug-MCP: Running';
export const STATUS_BAR_STOPPED_TEXT = '$(debug-stop) Debug-MCP: Stopped';
export const STATUS_BAR_STARTING_TEXT = '$(loading~spin) Debug-MCP: Starting...';
export const STATUS_BAR_ERROR_TEXT = '$(error) Debug-MCP: Error';

// Output Channel Name
export const OUTPUT_CHANNEL_NAME = 'VSCode Debugger MCP';
export const OUTPUT_CHANNEL_COORDINATOR = 'Debug MCP Server (Coordinator)'; // For McpServerManager specific logs if needed

// Configuration Keys
export const CONFIG_KEY_MCP_PORT = 'vscodeDebuggerMcp.mcpServer.port';
export const CONFIG_KEY_AUTO_START = 'vscodeDebuggerMcp.autoStartServer';

// Default Values
export const DEFAULT_MCP_PORT = 8080;
export const DEFAULT_AUTO_START = true;

// IPC Message Types and Statuses (Shared between Extension and Server, but defined here for Extension use)
export const IPC_MESSAGE_TYPE_REQUEST = 'request';
export const IPC_MESSAGE_TYPE_RESPONSE = 'response';
export const IPC_STATUS_SUCCESS = 'success';
export const IPC_STATUS_ERROR = 'error';
export const IPC_STATUS_STOPPED = 'stopped'; // Added
export const IPC_STATUS_COMPLETED = 'completed'; // Added
export const IPC_STATUS_TIMEOUT = 'timeout'; // Added
export const IPC_STATUS_INTERRUPTED = 'interrupted'; // Added

// UI Texts
export const UI_TEXT_INPUT_NEW_PORT = '输入新端口';

// MCP Client Configuration
export const MCP_CONFIG_SERVER_KEY = 'vscode-debugger-mcp';
export const MCP_CONFIG_URL_TEMPLATE = 'http://localhost:{port}/mcp';
// Server Startup Message (used for IPC coordination)
export const MCP_SERVER_LISTENING_MESSAGE_PREFIX = 'MCP Server listening on port ';