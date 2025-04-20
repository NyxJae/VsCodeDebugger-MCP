import * as fs from 'fs/promises'; // 使用 promises API
import * as path from 'path';
// import { McpToolExtra } from '@modelcontextprotocol/sdk'; // 确认 SDK 是否导出此类型，若无则省略或自定义
 
 // 定义期望的 launch.json 配置项结构 (至少包含必要的字段)
 interface LaunchConfiguration {
    name: string;
    type: string;
    request: string;
    [key: string]: any; // 允许其他任意属性
}

// 定义期望的 launch.json 顶层结构
interface LaunchJson {
    version?: string; // version 字段通常存在但可选
    configurations: LaunchConfiguration[];
}

// 定义工具处理函数的类型 (如果 SDK 没有提供明确类型，可以自定义)
type GetDebuggerConfigurationsArgs = Record<string, never>; // 空对象表示无输入参数
type GetDebuggerConfigurationsResult =
    | { status: 'success'; content: { type: "text", text: string }[] } // 修改成功时的返回值类型，包含 content
    | { status: 'error'; message: string; content: { type: "text", text: string }[]; isError: true }; // 修改错误时的返回值类型，包含 content 和 isError

/**
 * 处理 get_debugger_configurations MCP 工具请求。
 * 读取 VS Code 工作区的 .vscode/launch.json 文件并返回其配置。
 * @param args - 工具输入参数 (空)。
 * @param extra - MCP 工具附加信息 (未使用)。
  * @returns 返回包含配置列表或错误信息的 Promise。
  */
 export async function handleGetDebuggerConfigurations(
     args: GetDebuggerConfigurationsArgs,
     extra: any // extra 参数包含 MCP 请求的附加信息，此工具当前未使用该信息
 ): Promise<GetDebuggerConfigurationsResult> {
     console.log('[MCP Server] Handling get_debugger_configurations request...');

    const workspacePath = process.env.VSCODE_WORKSPACE_PATH;

    if (!workspacePath) {
        const errorMsg = '无法获取 VS Code 工作区路径，请确保插件已正确设置 VSCODE_WORKSPACE_PATH 环境变量。';
        console.error(`[MCP Server] Error: ${errorMsg}`);
        return { status: 'error', message: errorMsg, content: [{ type: "text", text: errorMsg }], isError: true }; // 添加 content 和 isError
    }
    console.log(`[MCP Server] Workspace path received: ${workspacePath}`);

    const launchJsonPath = path.join(workspacePath, '.vscode', 'launch.json');
    console.log(`[MCP Server] Attempting to read launch.json from: ${launchJsonPath}`);

    try {
        const fileContent = await fs.readFile(launchJsonPath, 'utf-8');
        console.log('[MCP Server] Successfully read launch.json content.');

        try {
            // 移除 JSON 文件开头的注释 (常见于 launch.json)
            // 这是一个简单的实现，可能无法处理所有类型的注释，但能处理常见的 // 和 /* */
            const jsonStringWithoutComments = fileContent.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
            const parsedJson: unknown = JSON.parse(jsonStringWithoutComments);
            console.log('[MCP Server] Successfully parsed launch.json content (after removing comments).');

            // 类型守卫和结构验证
            if (
                typeof parsedJson === 'object' &&
                parsedJson !== null &&
                'configurations' in parsedJson &&
                Array.isArray((parsedJson as LaunchJson).configurations)
            ) {
                const launchJson = parsedJson as LaunchJson;

                // 过滤并提取所需信息, 确保 name, type, request 存在
                const validConfigurations = launchJson.configurations.filter(
                    config => typeof config.name === 'string' && typeof config.type === 'string' && typeof config.request === 'string'
                );

                // 提取所有字段，符合 ProjectBrief 的可选要求
                const resultConfigurations = validConfigurations.map(config => ({ ...config }));


                console.log(`[MCP Server] Found ${resultConfigurations.length} valid configurations.`);
                // 将配置信息转换为文本格式，放入 content 属性
                const configurationsText = JSON.stringify(resultConfigurations, null, 2);
                return { status: 'success', content: [{ type: "text", text: configurationsText }] };
            } else {
                const errorMsg = 'launch.json 文件格式错误：缺少有效的 "configurations" 数组或结构不正确。';
                console.error(`[MCP Server] Error: ${errorMsg}`);
                return { status: 'error', message: errorMsg, content: [{ type: "text", text: errorMsg }], isError: true }; // 添加 content 和 isError
            }
        } catch (parseError) {
            if (parseError instanceof SyntaxError) {
                const errorMsg = `launch.json 文件格式错误: ${parseError.message}`;
                console.error(`[MCP Server] Error parsing launch.json: ${errorMsg}`);
                return { status: 'error', message: errorMsg, content: [{ type: "text", text: errorMsg }], isError: true }; // 添加 content 和 isError
            }
            // 处理其他可能的解析错误
            const errorMsg = `解析 launch.json 时发生意外错误: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
            console.error(`[MCP Server] ${errorMsg}`);
            // 对于未知错误，最好也返回给客户端
            return { status: 'error', message: errorMsg, content: [{ type: "text", text: errorMsg }], isError: true }; // 添加 content 和 isError
        }
    } catch (readError: any) { // 使用 any 或 unknown 并进行检查
        if (readError.code === 'ENOENT') {
            // 文件或目录不存在
            const errorMsg = `无法在 ${workspacePath}${path.sep}.vscode${path.sep} 目录下找到 launch.json 文件。`;
            console.warn(`[MCP Server] ${errorMsg}`);
            // 根据 ProjectBrief 定义，找不到文件是错误
            return { status: 'error', message: errorMsg, content: [{ type: "text", text: errorMsg }], isError: true }; // 添加 content 和 isError
        } else {
            // 其他文件读取错误
            const errorMsg = `读取 launch.json 文件时出错: ${readError.message}`;
            console.error(`[MCP Server] Error reading launch.json: ${errorMsg}`);
            return { status: 'error', message: errorMsg, content: [{ type: "text", text: errorMsg }], isError: true }; // 添加 content 和 isError
        }
    }
}