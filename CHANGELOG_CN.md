# Change Log
## 1.0.5
* 修复在调试VsCode插件项目时,连接意外断开的bug
* 修复单步调试工具不返回调试信息的bug
## 1.0.1-1.0.4
* 简单更新文档,更新图标等
## 1.0.0
* 实现 `stop_debugging` 工具。
* 实现 `step_execution` 工具 (Step Over, Step Into, Step Out)。
* 实现 `continue_debugging` 工具。
* 实现 `start_debugging` 工具。
* 实现 `remove_breakpoint` 工具。
* 实现 `get_breakpoints` 工具。
* 实现 `set_breakpoint` 工具。
* 实现 `get_debugger_configurations` 工具。
* MCP 服务器通信方式为 HTTP + SSE。
* 增加端口冲突处理和手动指定端口功能。
* 增加自动启动 MCP 服务器的配置选项。
* 提供一键复制客户端配置的功能。
* 模拟客户端接收原始SSE返回信息

## 0.1.0
* 初始版本。
* 实现 VS Code 扩展基本结构。
* 在状态栏显示 MCP 服务器状态（模拟）。
* 实现简单的 MCP 服务器启停控制（通过状态栏）。
