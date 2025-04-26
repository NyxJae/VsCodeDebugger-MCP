import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import * as Constants from '../../constants';
import { logger } from '../../config'; // 导入 logger
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'; // 导入 RequestHandlerExtra

// 定义 launch.json 配置项结构
interface LaunchConfiguration {
    name: string;
    type: string;
    request: string;
    [key: string]: any;
}

// 定义 launch.json 顶层结构
interface LaunchJson {
    version?: string;
    configurations: LaunchConfiguration[];
}

// --- 新增：定义工具的输入 Schema ---
const GetDebuggerConfigurationsInputSchema = z.object({}).describe("Retrieves debug configurations, requires no input parameters.");

// --- 新增：定义工具执行结果的 Schema ---
const GetDebuggerConfigurationsOutputSchema = z.object({
    status: z.enum([Constants.IPC_STATUS_SUCCESS, Constants.IPC_STATUS_ERROR]),
    configurations: z.array(z.object({ // 返回具体的配置数组，而不是字符串
        name: z.string(),
        type: z.string(),
        request: z.string(),
    }).passthrough()).optional().describe("List of debug configurations returned on success"),
    message: z.string().optional().describe("Error message returned on failure"),
}).describe("Execution result of the get debug configurations tool");

// --- 新增：定义工具对象 ---
export const getDebuggerConfigurationsTool = {
    name: Constants.TOOL_GET_DEBUGGER_CONFIGURATIONS,
    description: "Reads the .vscode/launch.json file in the VS Code workspace and returns its debug configuration list. It is essential to use this tool to get debug configurations before starting debugging.",
    inputSchema: GetDebuggerConfigurationsInputSchema,
    outputSchema: GetDebuggerConfigurationsOutputSchema,

    async execute(
        args: z.infer<typeof GetDebuggerConfigurationsInputSchema>,
        extra?: RequestHandlerExtra // 添加可选的 extra 参数
    ): Promise<z.infer<typeof GetDebuggerConfigurationsOutputSchema>> {
        const toolName = this.name; // 获取工具名称以便日志记录
        // logger.debug(`[MCP Tool - ${toolName}] Received extra:`, extra); // 可选：记录接收到的 extra
        const workspacePath = process.env.VSCODE_WORKSPACE_PATH;

        if (!workspacePath) {
            const errorMsg = '无法获取 VS Code 工作区路径，请确保插件已正确设置 VSCODE_WORKSPACE_PATH 环境变量。';
            logger.error(`[MCP Tool - ${toolName}] Error: ${errorMsg}`); // 使用 logger
            return { status: Constants.IPC_STATUS_ERROR, message: errorMsg };
        }

        const launchJsonPath = path.join(workspacePath, '.vscode', 'launch.json');

        try {
            const fileContent = await fs.readFile(launchJsonPath, 'utf-8');

            try {
                const jsonStringWithoutComments = fileContent.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
                const parsedJson: unknown = JSON.parse(jsonStringWithoutComments);

                if (
                    typeof parsedJson === 'object' &&
                    parsedJson !== null &&
                    'configurations' in parsedJson &&
                    Array.isArray((parsedJson as LaunchJson).configurations)
                ) {
                    const launchJson = parsedJson as LaunchJson;
                    const validConfigurations = launchJson.configurations.filter(
                        config => typeof config.name === 'string' && typeof config.type === 'string' && typeof config.request === 'string'
                    );
                    // 直接返回对象数组，而不是序列化后的字符串
                    const resultConfigurations = validConfigurations.map(config => ({ ...config }));

                    logger.info(`[MCP Tool - ${toolName}] Successfully read ${resultConfigurations.length} configurations.`); // 使用 logger
                    return { status: Constants.IPC_STATUS_SUCCESS, configurations: resultConfigurations };
                } else {
                    const errorMsg = 'launch.json file format error: missing a valid "configurations" array or incorrect structure.';
                    logger.error(`[MCP Tool - ${toolName}] Error: ${errorMsg}`); // 使用 logger
                    return { status: Constants.IPC_STATUS_ERROR, message: errorMsg };
                }
            } catch (parseError) {
                let errorMsg: string;
                if (parseError instanceof SyntaxError) {
                    errorMsg = `launch.json file format error: ${parseError.message}`;
                    logger.error(`[MCP Tool - ${toolName}] Error parsing launch.json: ${errorMsg}`); // 使用 logger
                } else {
                    errorMsg = `An unexpected error occurred while parsing launch.json: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
                    logger.error(`[MCP Tool - ${toolName}] ${errorMsg}`); // 使用 logger
                }
                return { status: Constants.IPC_STATUS_ERROR, message: errorMsg };
            }
        } catch (readError: any) {
            let errorMsg: string;
            if (readError.code === 'ENOENT') {
                errorMsg = `Could not find launch.json file in the ${workspacePath}${path.sep}.vscode${path.sep} directory.`;
                logger.warn(`[MCP Tool - ${toolName}] ${errorMsg}`); // 使用 logger
            } else {
                errorMsg = `Error reading launch.json file: ${readError.message}`;
                logger.error(`[MCP Tool - ${toolName}] Error reading launch.json: ${errorMsg}`); // 使用 logger
            }
            return { status: Constants.IPC_STATUS_ERROR, message: errorMsg };
        }
    }
};