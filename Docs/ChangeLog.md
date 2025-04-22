# Change Log

本项目的所有显著变更将记录在此文件中。

## [V0.2] - [2025.04.22]

### 新功能
- 实现 `remove_breakpoint` 工具，用于移除指定的断点（支持按 ID、按位置或全部清除）。
- 实现 `get_breakpoints` 工具，用于获取当前调试会话中的所有断点列表。

### 重构
- 项目结构优化。将 `src/mcpServerManager.ts` 拆分为 `src/managers/ProcessManager.ts`, `src/managers/IpcHandler.ts`, `src/vscode/DebuggerApiWrapper.ts` 等模块，并更新 `src/extension.ts`。将 `mcp-server/src/toolProviders/debuggerTools.ts` 拆分为 `mcp-server/src/toolProviders/debug/` 目录下的多个文件。提高了代码的可维护性和模块化程度。

## [V0.1] - [2025.04.18]

### 修复
- `set_breakpoint` 工具参数传递问题。MCP 服务器端使用蛇形命名 (`file_path`)，而 VSCode 插件端期望驼峰命名 (`filePath`)。通过修改插件端 `src/mcpServerManager.ts`，使其正确映射参数命名，解决了客户端调用时参数传递失败的问题。
