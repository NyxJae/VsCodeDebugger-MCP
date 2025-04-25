import { z } from "zod";
import { server } from './mcpInstance';
import { logger } from './config';
import * as DebugTools from './toolProviders/debug';
import { continueDebuggingTool } from './toolProviders/debug/continueDebugging';
import { stepExecutionTool } from './toolProviders/debug/stepExecution';
import * as Constants from './constants';
import { StepExecutionParams } from './types';

/**
 * 注册所有 MCP 调试工具及其适配器逻辑。
 * 每个工具的适配器负责调用底层工具的 execute 方法，
 * 并将结果转换为 MCP Server 所需的格式。
 */
export function registerTools() {
    logger.info('[Tool Registry] Starting tool registration...');

    // 注册 getDebuggerConfigurationsTool
    server.tool(
        DebugTools.getDebuggerConfigurationsTool.name,
        DebugTools.getDebuggerConfigurationsTool.inputSchema.shape,
        async (args, extra) => {
            const toolName = DebugTools.getDebuggerConfigurationsTool.name;
            logger.info(`[MCP Server Adapter] Executing tool: ${toolName}`);
            try {
                const result = await DebugTools.getDebuggerConfigurationsTool.execute(args);
                logger.info(`[MCP Server Adapter] Tool ${toolName} execution result status: ${result.status}`);

                let responseContent = "";
                let isError = false;

                if (result.status === Constants.IPC_STATUS_SUCCESS && result.configurations) {
                    try {
                        responseContent = JSON.stringify(result.configurations, null, 2);
                        logger.debug(`[MCP Server Adapter] Tool ${toolName} success response content generated.`);
                    } catch (jsonError) {
                         logger.error(`[MCP Server Adapter] Failed to stringify configurations for ${toolName}:`, jsonError);
                         responseContent = `Error: Failed to serialize configurations result.`;
                         isError = true;
                    }
                } else {
                    responseContent = `Error: ${result.message || 'Failed to get debugger configurations.'}`;
                    isError = true;
                    logger.warn(`[MCP Server Adapter] Tool ${toolName} execution failed: ${responseContent}`);
                }

                return {
                    content: [{ type: 'text', text: responseContent }],
                    isError: isError,
                };
            } catch (error: any) {
                logger.error(`[MCP Server Adapter] Unhandled error executing tool ${toolName}:`, error);
                return {
                    content: [{ type: 'text', text: `Internal server error executing tool: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );
    logger.info(`[Tool Registry] Registered tool: ${DebugTools.getDebuggerConfigurationsTool.name}`);

    // 注册 setBreakpointTool
    server.tool(
        DebugTools.setBreakpointTool.name,
        DebugTools.setBreakpointTool.inputSchema.shape,
        async (args, extra) => {
            const toolName = DebugTools.setBreakpointTool.name;
            logger.info(`[MCP Server Adapter] Executing tool: ${toolName} with args:`, args);
            try {
                const result = await DebugTools.setBreakpointTool.execute(args);
                logger.info(`[MCP Server Adapter] Tool ${toolName} execution result status: ${result.status}`);

                let responseContent = "";
                let isError = false;

                if (result.status === Constants.IPC_STATUS_SUCCESS && result.breakpoint) {
                    try {
                        responseContent = JSON.stringify(result.breakpoint, null, 2);
                        logger.debug(`[MCP Server Adapter] Tool ${toolName} success response content generated.`);
                    } catch (jsonError) {
                         logger.error(`[MCP Server Adapter] Failed to stringify breakpoint info for ${toolName}:`, jsonError);
                         responseContent = `Error: Failed to serialize breakpoint result.`;
                         isError = true;
                    }
                } else {
                    responseContent = `Error setting breakpoint: ${result.message || 'Failed to set breakpoint.'}`;
                    isError = true;
                    logger.warn(`[MCP Server Adapter] Tool ${toolName} execution failed: ${responseContent}`);
                }

                return {
                    content: [{ type: 'text', text: responseContent }],
                    isError: isError,
                };
            } catch (error: any) {
                logger.error(`[MCP Server Adapter] Unhandled error executing tool ${toolName}:`, error);
                return {
                    content: [{ type: 'text', text: `Internal server error executing tool ${toolName}: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );
    logger.info(`[Tool Registry] Registered tool: ${DebugTools.setBreakpointTool.name}`);

    // 注册 getBreakpointsTool
    server.tool(
        DebugTools.getBreakpointsTool.name,
        DebugTools.getBreakpointsTool.inputSchema.shape,
        async (args, extra) => {
            const toolName = DebugTools.getBreakpointsTool.name;
            logger.info(`[MCP Server Adapter] Executing tool: ${toolName}`);
            try {
                const result = await DebugTools.getBreakpointsTool.execute(args);
                logger.info(`[MCP Server Adapter] Tool ${toolName} execution result status: ${result.status}`);

                let responseContent = "";
                let isError = false;

                if (result.status === Constants.IPC_STATUS_SUCCESS && result.breakpoints) {
                    try {
                        const payloadToSerialize = {
                            timestamp: result.timestamp,
                            breakpoints: result.breakpoints
                        };
                        responseContent = JSON.stringify(payloadToSerialize, null, 2);
                        logger.debug(`[MCP Server Adapter] Tool ${toolName} success response content generated.`);
                    } catch (jsonError) {
                         logger.error(`[MCP Server Adapter] Failed to stringify breakpoints list for ${toolName}:`, jsonError);
                         responseContent = `Error: Failed to serialize breakpoints result.`;
                         isError = true;
                    }
                } else {
                    responseContent = `Error getting breakpoints: ${result.message || 'Failed to get breakpoints.'}`;
                    isError = true;
                    logger.warn(`[MCP Server Adapter] Tool ${toolName} execution failed: ${responseContent}`);
                }

                return {
                    content: [{ type: 'text', text: responseContent }],
                    isError: isError,
                };
            } catch (error: any) {
                logger.error(`[MCP Server Adapter] Unhandled error executing tool ${toolName}:`, error);
                return {
                    content: [{ type: 'text', text: `Internal server error executing tool ${toolName}: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );
    logger.info(`[Tool Registry] Registered tool: ${DebugTools.getBreakpointsTool.name}`);

    // 注册 removeBreakpointTool
    server.tool(
        DebugTools.removeBreakpointTool.name,
        DebugTools.removeBreakpointTool.baseinputSchema.shape,
        async (args, extra) => {
            const toolName = DebugTools.removeBreakpointTool.name;
            logger.info(`[MCP Server Adapter] Executing tool: ${toolName} with validated args:`, args);
            try {
                const result = await DebugTools.removeBreakpointTool.execute(args);
                logger.info(`[MCP Server Adapter] Tool ${toolName} execution result status: ${result.status}`);

                let responseContent = result.message || (result.status === Constants.IPC_STATUS_SUCCESS ? "操作成功完成。" : "发生未知错误。");
                let isError = result.status !== Constants.IPC_STATUS_SUCCESS;

                if (isError) {
                    logger.warn(`[MCP Server Adapter] Tool ${toolName} execution failed: ${responseContent}`);
                } else {
                     logger.debug(`[MCP Server Adapter] Tool ${toolName} success response content generated.`);
                }

                return {
                    content: [{ type: 'text', text: responseContent }],
                    isError: isError,
                };
            } catch (error: any) {
                logger.error(`[MCP Server Adapter] Unhandled error executing tool ${toolName}:`, error);
                return {
                    content: [{ type: 'text', text: `Internal server error executing tool ${toolName}: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );
    logger.info(`[Tool Registry] Registered tool: ${DebugTools.removeBreakpointTool.name}`);

    // 注册 startDebuggingTool
    server.tool(
        DebugTools.startDebuggingTool.name,
        DebugTools.startDebuggingTool.inputSchema.shape,
        async (args, extra) => {
            const toolName = DebugTools.startDebuggingTool.name;
            logger.info(`[MCP Server Adapter] Executing tool: ${toolName} with args:`, args);
            try {
                const result = await DebugTools.startDebuggingTool.execute(args);
                logger.info(`[MCP Server Adapter] Tool ${toolName} execution result:`, result);

                let responseContent = "";
                const isError = result.status === 'error' || result.status === 'timeout';

                try {
                    responseContent = JSON.stringify(result, null, 2);
                    if (isError) {
                         logger.warn(`[MCP Server Adapter] Tool ${toolName} execution failed. Response: ${responseContent}`);
                    } else {
                         logger.debug(`[MCP Server Adapter] Tool ${toolName} success response content generated.`);
                    }
                } catch (jsonError) {
                     logger.error(`[MCP Server Adapter] Failed to stringify start debugging result for ${toolName}:`, jsonError);
                     responseContent = `Error: Failed to serialize start debugging result. Status: ${result.status}, Message: ${result.message || 'N/A'}`;
                }

                return {
                    content: [{ type: 'text', text: responseContent }],
                    isError: isError,
                };
            } catch (error: any) {
                logger.error(`[MCP Server Adapter] Unhandled error executing tool ${toolName}:`, error);
                const errorResponse = {
                    status: 'error',
                    message: `Internal server error executing tool ${toolName}: ${error.message}`
                };
                return {
                    content: [{ type: 'text', text: JSON.stringify(errorResponse, null, 2) }],
                    isError: true,
                };
            }
        }
    );
    logger.info(`[Tool Registry] Registered tool: ${DebugTools.startDebuggingTool.name}`);

    // 注册 continueDebuggingTool
    server.tool(
        continueDebuggingTool.name,
        continueDebuggingTool.inputSchema.shape,
        async (args, extra) => {
            const toolName = continueDebuggingTool.name;
            logger.info(`[MCP Server Adapter] Executing tool: ${toolName} with args:`, args);
            try {
                const result = await continueDebuggingTool.execute(args);
                logger.info(`[MCP Server Adapter] Tool ${toolName} execution result:`, result);

                let responseContent = `Status: ${result.status}`;
                if (result.message) {
                    responseContent += `\nMessage: ${result.message}`;
                }
                if (result.status === 'stopped' && result.stop_event_data) {
                    try {
                        responseContent += `\nStop Event Data: ${JSON.stringify(result.stop_event_data, null, 2)}`;
                    } catch (jsonError) {
                        logger.warn(`[MCP Server Adapter] Failed to stringify stop_event_data for ${toolName}:`, jsonError);
                        responseContent += `\nStop Event Data: (Error serializing)`;
                    }
                }

                return {
                    content: [{ type: 'text', text: responseContent }],
                    isError: result.status === 'error' || result.status === 'timeout',
                };
            } catch (error: any) {
                logger.error(`[MCP Server Adapter] Error executing tool ${toolName}:`, error);
                return {
                    content: [{ type: 'text', text: `Error executing tool: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );
    logger.info(`[Tool Registry] Registered tool: ${continueDebuggingTool.name}`);

    // 注册 stepExecutionTool
    server.tool(
        stepExecutionTool.name,
        stepExecutionTool.inputSchema.shape,
        async (args: StepExecutionParams, extra: any) => {
            const toolName = stepExecutionTool.name;
            logger.info(`[MCP Server Adapter] Executing tool: ${toolName} with args:`, args);
            try {
                const result = await stepExecutionTool.execute(args);
                logger.info(`[MCP Server Adapter] Tool ${toolName} execution result:`, result);

                let responseContent = `Status: ${result.status}`;
                if (result.message) {
                    responseContent += `\nMessage: ${result.message}`;
                }
                if (result.status === 'stopped' && result.stop_event_data) {
                    try {
                        responseContent += `\nStop Event Data: ${JSON.stringify(result.stop_event_data, null, 2)}`;
                    } catch (jsonError) {
                        logger.warn(`[MCP Server Adapter] Failed to stringify stop_event_data for ${toolName}:`, jsonError);
                        responseContent += `\nStop Event Data: (Error serializing)`;
                    }
                }

                return {
                    content: [{ type: 'text', text: responseContent }],
                    isError: result.status === 'error' || result.status === 'timeout',
                };
            } catch (error: any) {
                logger.error(`[MCP Server Adapter] Error executing tool ${toolName}:`, error);
                return {
                    content: [{ type: 'text', text: `Error executing tool: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );
    logger.info(`[Tool Registry] Registered tool: ${stepExecutionTool.name}`);

    // 注册 stopDebuggingTool
    server.tool(
        DebugTools.stopDebuggingTool.name,
        DebugTools.stopDebuggingTool.inputSchema.shape,
        async (args: z.infer<typeof DebugTools.stopDebuggingTool.inputSchema>, extra: any) => {
            const toolName = DebugTools.stopDebuggingTool.name;
            logger.info(`[MCP Server Adapter] Executing tool: ${toolName} with args:`, args);
            try {
                const result = await DebugTools.stopDebuggingTool.execute(args);
                logger.info(`[MCP Server Adapter] Tool ${toolName} execution result status: ${result.status}`);

                let responseContent = result.message || (result.status === Constants.IPC_STATUS_SUCCESS ? "停止调试操作已成功请求。" : "停止调试时发生未知错误。");
                let isError = result.status !== Constants.IPC_STATUS_SUCCESS;

                if (isError) {
                    logger.warn(`[MCP Server Adapter] Tool ${toolName} execution failed: ${responseContent}`);
                } else {
                     logger.debug(`[MCP Server Adapter] Tool ${toolName} success response content generated.`);
                }

                return {
                    content: [{ type: 'text', text: responseContent }],
                    isError: isError,
                };
            } catch (error: any) {
                logger.error(`[MCP Server Adapter] Unhandled error executing tool ${toolName}:`, error);
                const errorResponse = {
                    status: Constants.IPC_STATUS_ERROR,
                    message: `Internal server error executing tool ${toolName}: ${error.message}`
                };
                return {
                    content: [{ type: 'text', text: JSON.stringify(errorResponse, null, 2) }],
                    isError: true,
                };
            }
        }
    );
    logger.info(`[Tool Registry] Registered tool: ${DebugTools.stopDebuggingTool.name}`);

    logger.info('[Tool Registry] All tools registered.');
}