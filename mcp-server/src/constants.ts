// mcp-server/src/constants.ts
// 常量定义，从根目录 src/constants.ts 复制 mcp-server 需要的部分

export const IPC_COMMAND_PREFIX = 'vscode-debugger-mcp:';

// IPC Commands (只包含 mcp-server 需要知道的请求/响应对)
export const IPC_COMMAND_GET_CONFIGURATIONS = `${IPC_COMMAND_PREFIX}getConfigurations`;
export const IPC_COMMAND_SET_BREAKPOINT = `${IPC_COMMAND_PREFIX}setBreakpoint`;
export const IPC_COMMAND_GET_BREAKPOINTS = `${IPC_COMMAND_PREFIX}getBreakpoints`;
export const IPC_COMMAND_REMOVE_BREAKPOINT = `${IPC_COMMAND_PREFIX}removeBreakpoint`;
export const IPC_COMMAND_START_DEBUGGING_REQUEST = `${IPC_COMMAND_PREFIX}startDebuggingRequest`;
export const IPC_COMMAND_START_DEBUGGING_RESPONSE = `${IPC_COMMAND_PREFIX}startDebuggingResponse`;
export const IPC_COMMAND_CONTINUE_DEBUGGING = `${IPC_COMMAND_PREFIX}continue_debugging`; // <--- 添加 continue 命令常量

// IPC Message Types and Statuses
export const IPC_MESSAGE_TYPE_REQUEST = 'request'; // 虽然 server 主要处理响应，但 communicator 可能需要
export const IPC_MESSAGE_TYPE_RESPONSE = 'response';
export const IPC_STATUS_SUCCESS = 'success';
export const IPC_STATUS_ERROR = 'error';

// Tool Names (如果 server.ts 中使用了这些常量)
// 注意：server.ts 当前直接使用字符串，但如果改为常量，需要从这里导入
export const TOOL_GET_DEBUGGER_CONFIGURATIONS = 'get_debugger_configurations';
export const TOOL_SET_BREAKPOINT = 'set_breakpoint';
export const TOOL_GET_BREAKPOINTS = 'get_breakpoints';
export const TOOL_REMOVE_BREAKPOINT = 'remove_breakpoint';
export const TOOL_START_DEBUGGING = 'start_debugging';
// Server Startup Message (used for IPC coordination)
export const MCP_SERVER_LISTENING_MESSAGE_PREFIX = 'MCP Server listening on port ';