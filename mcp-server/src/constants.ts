// mcp-server/src/constants.ts
// MCP Server 常量定义，包含 IPC 命令、消息类型和工具名称

export const IPC_COMMAND_PREFIX = 'vscode-debugger-mcp:';

// IPC Commands (MCP Server 需要处理的请求/响应对)
export const IPC_COMMAND_GET_CONFIGURATIONS = `${IPC_COMMAND_PREFIX}getConfigurations`;
export const IPC_COMMAND_SET_BREAKPOINT = `${IPC_COMMAND_PREFIX}setBreakpoint`;
export const IPC_COMMAND_GET_BREAKPOINTS = `${IPC_COMMAND_PREFIX}getBreakpoints`;
export const IPC_COMMAND_REMOVE_BREAKPOINT = `${IPC_COMMAND_PREFIX}removeBreakpoint`;
export const IPC_COMMAND_START_DEBUGGING_REQUEST = `${IPC_COMMAND_PREFIX}startDebuggingRequest`;
export const IPC_COMMAND_START_DEBUGGING_RESPONSE = `${IPC_COMMAND_PREFIX}startDebuggingResponse`;
export const IPC_COMMAND_CONTINUE_DEBUGGING = `${IPC_COMMAND_PREFIX}continue_debugging`;
export const IPC_COMMAND_STEP_EXECUTION = `${IPC_COMMAND_PREFIX}stepExecution`;
export const IPC_COMMAND_STOP_DEBUGGING = `${IPC_COMMAND_PREFIX}stopDebugging`;

// IPC Message Types and Statuses
export const IPC_MESSAGE_TYPE_REQUEST = 'request'; // 主要用于 communicator
export const IPC_MESSAGE_TYPE_RESPONSE = 'response';
export const IPC_STATUS_SUCCESS = 'success';
export const IPC_STATUS_ERROR = 'error';

// Tool Names (MCP Server 中使用的工具名称常量)
export const TOOL_GET_DEBUGGER_CONFIGURATIONS = 'get_debugger_configurations';
export const TOOL_SET_BREAKPOINT = 'set_breakpoint';
export const TOOL_GET_BREAKPOINTS = 'get_breakpoints';
export const TOOL_REMOVE_BREAKPOINT = 'remove_breakpoint';
export const TOOL_START_DEBUGGING = 'start_debugging';
export const TOOL_NAME_STEP_EXECUTION = 'step_execution';
export const TOOL_STOP_DEBUGGING = 'stop_debugging';
// Server Startup Message (用于 IPC 协调)
export const MCP_SERVER_LISTENING_MESSAGE_PREFIX = 'MCP Server listening on port ';