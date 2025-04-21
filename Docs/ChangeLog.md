

- 修复: `set_breakpoint` 工具参数传递问题。MCP 服务器端使用蛇形命名 (`file_path`)，而 VSCode 插件端期望驼峰命名 (`filePath`)。通过修改插件端 `src/mcpServerManager.ts`，使其正确映射参数命名，解决了客户端调用时参数传递失败的问题。
