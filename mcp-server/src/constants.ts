// mcp-server/src/constants.ts
// Constants for the MCP server part

// Tool Names (as exposed via MCP)
export const TOOL_GET_DEBUGGER_CONFIGURATIONS = 'get_debugger_configurations';
export const TOOL_SET_BREAKPOINT = 'set_breakpoint';
export const TOOL_REMOVE_BREAKPOINT = 'remove_breakpoint';
export const TOOL_GET_BREAKPOINTS = 'get_breakpoints';
export const TOOL_START_DEBUGGING = 'start_debugging';
export const TOOL_CONTINUE_DEBUGGING = 'continue_debugging';
export const TOOL_STEP_EXECUTION = 'step_execution';
export const TOOL_GET_SCOPES = 'get_scopes';
export const TOOL_GET_VARIABLES = 'get_variables';
export const TOOL_EVALUATE_EXPRESSION = 'evaluate_expression';
export const TOOL_STOP_DEBUGGING = 'stop_debugging';

// IPC Commands received from Extension
export const IPC_COMMAND_PREFIX = 'vscode-debugger-mcp:';
export const IPC_COMMAND_SET_BREAKPOINT = `${IPC_COMMAND_PREFIX}setBreakpoint`;
export const IPC_COMMAND_GET_BREAKPOINTS = `${IPC_COMMAND_PREFIX}getBreakpoints`;
export const IPC_COMMAND_GET_CONFIGURATIONS = `${IPC_COMMAND_PREFIX}getConfigurations`;
// Add more commands as needed

// Status values for MCP responses
export const STATUS_SUCCESS = 'success';
export const STATUS_ERROR = 'error';
export const STATUS_STOPPED = 'stopped';
export const STATUS_COMPLETED = 'completed';
export const STATUS_TIMEOUT = 'timeout';
export const STATUS_INTERRUPTED = 'interrupted'; // Assuming this might be needed later

// Step Execution Types
export const STEP_TYPE_OVER = 'over';
export const STEP_TYPE_INTO = 'into';
export const STEP_TYPE_OUT = 'out';