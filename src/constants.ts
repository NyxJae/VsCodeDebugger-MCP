// VS Code 插件常量

export const IPC_COMMAND_PREFIX = 'vscode-debugger-mcp:';

// IPC 命令 (插件到服务器)
export const IPC_COMMAND_SET_BREAKPOINT = `${IPC_COMMAND_PREFIX}setBreakpoint`;
export const IPC_COMMAND_GET_BREAKPOINTS = `${IPC_COMMAND_PREFIX}getBreakpoints`;
export const IPC_COMMAND_GET_CONFIGURATIONS = `${IPC_COMMAND_PREFIX}getConfigurations`;
export const IPC_COMMAND_REMOVE_BREAKPOINT = `${IPC_COMMAND_PREFIX}removeBreakpoint`;
export const IPC_COMMAND_START_DEBUGGING_REQUEST = `${IPC_COMMAND_PREFIX}startDebuggingRequest`;
export const IPC_COMMAND_START_DEBUGGING_RESPONSE = `${IPC_COMMAND_PREFIX}startDebuggingResponse`;
export const IPC_COMMAND_CONTINUE_DEBUGGING = `${IPC_COMMAND_PREFIX}continue_debugging`;
export const IPC_COMMAND_STEP_EXECUTION = `${IPC_COMMAND_PREFIX}stepExecution`;
export const IPC_COMMAND_STOP_DEBUGGING = `${IPC_COMMAND_PREFIX}stopDebugging`;

// 状态栏文本
export const STATUS_BAR_RUNNING_TEXT = '$(debug-start) Debug-MCP: Running';
export const STATUS_BAR_STOPPED_TEXT = '$(debug-stop) Debug-MCP: Stopped';
export const STATUS_BAR_STARTING_TEXT = '$(loading~spin) Debug-MCP: Starting...';
export const STATUS_BAR_ERROR_TEXT = '$(error) Debug-MCP: Error';

// 输出通道名称
export const OUTPUT_CHANNEL_NAME = 'VSCode Debugger MCP';
export const OUTPUT_CHANNEL_COORDINATOR = 'Debug MCP Server (Coordinator)';

// 配置键
export const CONFIG_KEY_MCP_PORT = 'vscodeDebuggerMcp.mcpServer.port';
export const CONFIG_KEY_AUTO_START = 'vscodeDebuggerMcp.autoStartServer';

// 默认值
export const DEFAULT_MCP_PORT = 8080;
export const DEFAULT_AUTO_START = true;

// IPC 消息类型和状态
export const IPC_MESSAGE_TYPE_REQUEST = 'request';
export const IPC_MESSAGE_TYPE_RESPONSE = 'response';
export const IPC_STATUS_SUCCESS = 'success';
export const IPC_STATUS_ERROR = 'error';
export const IPC_STATUS_STOPPED = 'stopped';
export const IPC_STATUS_COMPLETED = 'completed';
export const IPC_STATUS_TIMEOUT = 'timeout';
export const IPC_STATUS_INTERRUPTED = 'interrupted';

// UI 文本
export const UI_TEXT_INPUT_NEW_PORT = '输入新端口';

// MCP 客户端配置
export const MCP_CONFIG_SERVER_KEY = 'vscode-debugger-mcp';
export const MCP_CONFIG_URL_TEMPLATE = 'http://localhost:{port}/mcp';
// 服务器启动消息
export const MCP_SERVER_LISTENING_MESSAGE_PREFIX = 'MCP Server listening on port ';
// 自动启动配置键 (用于 Global State)
export const AUTO_START_KEY = 'mcpServer.autoStart';