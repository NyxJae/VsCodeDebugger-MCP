# Change Log
## 1.0.5

* Fixed the bug where the connection was accidentally disconnected when debugging the VsCode plugin project

* Fixed the bug where the single-step debugging tool does not return debug information

## 1.0.1-1.0.4

* Simple update of documents, update icons, etc.
## 1.0.0
* Implemented `stop_debugging` tool.
* Implemented `step_execution` tool (Step Over, Step Into, Step Out).
* Implemented `continue_debugging` tool.
* Implemented `start_debugging` tool.
* Implemented `remove_breakpoint` tool.
* Implemented `get_breakpoints` tool.
* Implemented `set_breakpoint` tool.
* Implemented `get_debugger_configurations` tool.
* MCP server communication method is HTTP + SSE.
* Added port conflict handling and manual port specification feature.
* Added configuration option for automatic MCP server startup.
* Provided one-click copy function for client configuration.
* Simulated client receives raw SSE return information.

## 0.1.0
* Initial version.
* Implemented basic VS Code extension structure.
* Displayed MCP server status in the status bar (simulated).
* Implemented simple MCP server start/stop control (via status bar).