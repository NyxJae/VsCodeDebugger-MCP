import * as fs from 'fs/promises';
import * as path from 'path';
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

// 定义 get_debugger_configurations 工具的类型
type GetDebuggerConfigurationsArgs = Record<string, never>;
type GetDebuggerConfigurationsResult =
    | { status: typeof Constants.IPC_STATUS_SUCCESS; content: { type: "text", text: string }[] }
    | { status: typeof Constants.IPC_STATUS_ERROR; message: string; content: { type: "text", text: string }[]; isError: true };

/**
 * 处理 get_debugger_configurations MCP 工具请求。
 * 读取 VS Code 工作区的 .vscode/launch.json 文件并返回其配置。
 */
export async function handleGetDebuggerConfigurations(
    args: GetDebuggerConfigurationsArgs,
    extra: any
): Promise<GetDebuggerConfigurationsResult> {
    const workspacePath = process.env.VSCODE_WORKSPACE_PATH;

    if (!workspacePath) {
        const errorMsg = '无法获取 VS Code 工作区路径，请确保插件已正确设置 VSCODE_WORKSPACE_PATH 环境变量。';
        console.error(`[MCP Server] Error: ${errorMsg}`);
        return { status: Constants.IPC_STATUS_ERROR, message: errorMsg, content: [{ type: "text", text: errorMsg }], isError: true };
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
                const resultConfigurations = validConfigurations.map(config => ({ ...config }));

                const configurationsText = JSON.stringify(resultConfigurations, null, 2);
                return { status: Constants.IPC_STATUS_SUCCESS, content: [{ type: "text", text: configurationsText }] };
            } else {
                const errorMsg = 'launch.json 文件格式错误：缺少有效的 "configurations" 数组或结构不正确。';
                console.error(`[MCP Server] Error: ${errorMsg}`);
                return { status: Constants.IPC_STATUS_ERROR, message: errorMsg, content: [{ type: "text", text: errorMsg }], isError: true };
            }
        } catch (parseError) {
            if (parseError instanceof SyntaxError) {
                const errorMsg = `launch.json 文件格式错误: ${parseError.message}`;
                console.error(`[MCP Server] Error parsing launch.json: ${errorMsg}`);
                return { status: Constants.IPC_STATUS_ERROR, message: errorMsg, content: [{ type: "text", text: errorMsg }], isError: true };
            }
            const errorMsg = `解析 launch.json 时发生意外错误: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
            console.error(`[MCP Server] ${errorMsg}`);
            return { status: Constants.IPC_STATUS_ERROR, message: errorMsg, content: [{ type: "text", text: errorMsg }], isError: true };
        }
    } catch (readError: any) {
        if (readError.code === 'ENOENT') {
            const errorMsg = `无法在 ${workspacePath}${path.sep}.vscode${path.sep} 目录下找到 launch.json 文件。`;
            console.warn(`[MCP Server] ${errorMsg}`);
            return { status: Constants.IPC_STATUS_ERROR, message: errorMsg, content: [{ type: "text", text: errorMsg }], isError: true };
        } else {
            const errorMsg = `读取 launch.json 文件时出错: ${readError.message}`;
            console.error(`[MCP Server] Error reading launch.json: ${errorMsg}`);
            return { status: Constants.IPC_STATUS_ERROR, message: errorMsg, content: [{ type: "text", text: errorMsg }], isError: true };
        }
    }
}