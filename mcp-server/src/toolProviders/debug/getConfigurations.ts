import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import * as Constants from '../../constants';

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
const GetDebuggerConfigurationsInputSchema = z.object({}).describe("获取调试配置，无需输入参数");

// --- 新增：定义工具执行结果的 Schema ---
const GetDebuggerConfigurationsOutputSchema = z.object({
    status: z.enum([Constants.IPC_STATUS_SUCCESS, Constants.IPC_STATUS_ERROR]),
    configurations: z.array(z.object({ // 返回具体的配置数组，而不是字符串
        name: z.string(),
        type: z.string(),
        request: z.string(),
    }).passthrough()).optional().describe("成功时返回的调试配置列表"),
    message: z.string().optional().describe("失败时返回的错误信息"),
}).describe("获取调试配置工具的执行结果");

// --- 新增：定义工具对象 ---
export const getDebuggerConfigurationsTool = {
    name: Constants.TOOL_GET_DEBUGGER_CONFIGURATIONS,
    description: "读取 VS Code 工作区的 .vscode/launch.json 文件并返回其调试配置列表。",
    inputSchema: GetDebuggerConfigurationsInputSchema,
    outputSchema: GetDebuggerConfigurationsOutputSchema,

    async execute(
        args: z.infer<typeof GetDebuggerConfigurationsInputSchema>,
        // extra: any // 如果需要 extra 参数可以取消注释
    ): Promise<z.infer<typeof GetDebuggerConfigurationsOutputSchema>> {
        const workspacePath = process.env.VSCODE_WORKSPACE_PATH;

        if (!workspacePath) {
            const errorMsg = '无法获取 VS Code 工作区路径，请确保插件已正确设置 VSCODE_WORKSPACE_PATH 环境变量。';
            console.error(`[MCP Tool - ${this.name}] Error: ${errorMsg}`);
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

                    console.info(`[MCP Tool - ${this.name}] Successfully read ${resultConfigurations.length} configurations.`);
                    return { status: Constants.IPC_STATUS_SUCCESS, configurations: resultConfigurations };
                } else {
                    const errorMsg = 'launch.json 文件格式错误：缺少有效的 "configurations" 数组或结构不正确。';
                    console.error(`[MCP Tool - ${this.name}] Error: ${errorMsg}`);
                    return { status: Constants.IPC_STATUS_ERROR, message: errorMsg };
                }
            } catch (parseError) {
                let errorMsg: string;
                if (parseError instanceof SyntaxError) {
                    errorMsg = `launch.json 文件格式错误: ${parseError.message}`;
                    console.error(`[MCP Tool - ${this.name}] Error parsing launch.json: ${errorMsg}`);
                } else {
                    errorMsg = `解析 launch.json 时发生意外错误: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
                    console.error(`[MCP Tool - ${this.name}] ${errorMsg}`);
                }
                return { status: Constants.IPC_STATUS_ERROR, message: errorMsg };
            }
        } catch (readError: any) {
            let errorMsg: string;
            if (readError.code === 'ENOENT') {
                errorMsg = `无法在 ${workspacePath}${path.sep}.vscode${path.sep} 目录下找到 launch.json 文件。`;
                console.warn(`[MCP Tool - ${this.name}] ${errorMsg}`);
            } else {
                errorMsg = `读取 launch.json 文件时出错: ${readError.message}`;
                console.error(`[MCP Tool - ${this.name}] Error reading launch.json: ${errorMsg}`);
            }
            return { status: Constants.IPC_STATUS_ERROR, message: errorMsg };
        }
    }
};