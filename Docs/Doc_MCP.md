好的，根据你的最新要求，我已经移除了所有关于 SSE 的内容，并更新了客户端配置部分，使其专注于通过 stdio 与 RooCode/Cline 进行配置。

这是最终的、仅支持 stdio 的 MCP 服务器开发指南：

---

## Model Context Protocol (MCP) 服务器开发指南 - Roocode Debugger (stdio-only)

**版本:** 1.1
**日期:** 2025-04-17

### 目录

- [Model Context Protocol (MCP) 服务器开发指南 - Roocode Debugger (stdio-only)](#model-context-protocol-mcp-服务器开发指南---roocode-debugger-stdio-only)
  - [目录](#目录)
  - [1. 简介](#1-简介)
    - [1.1 MCP 与本项目目标](#11-mcp-与本项目目标)
    - [1.2 目标读者](#12-目标读者)
  - [2. 先决条件](#2-先决条件)
  - [3. 核心概念](#3-核心概念)
    - [3.1 MCP 通信流程](#31-mcp-通信流程)
    - [3.2 通信方式 (stdio)](#32-通信方式-stdio)
    - [3.3 与 VS Code 插件的交互 (IPC)](#33-与-vs-code-插件的交互-ipc)
    - [3.4 Debug Adapter Protocol (DAP) 的相关性](#34-debug-adapter-protocol-dap-的相关性)
  - [4. 系统架构](#4-系统架构)
  - [5. 项目设置](#5-项目设置)
    - [5.1 初始化项目](#51-初始化项目)
    - [5.2 推荐依赖](#52-推荐依赖)
    - [5.3 `package.json` 示例](#53-packagejson-示例)
    - [5.4 `tsconfig.json` 示例](#54-tsconfigjson-示例)
  - [6. MCP 协议实现 (stdio)](#6-mcp-协议实现-stdio)
    - [6.1 消息格式 (推荐类 OpenAI/JSON-RPC)](#61-消息格式-推荐类-openaijson-rpc)
    - [6.2 stdio 实现 (`server.ts`)](#62-stdio-实现-serverts)
  - [7. 工具实现 (Roocode Debugger)](#7-工具实现-roocode-debugger)
    - [7.1 工具路由 (`toolHandler.ts`)](#71-工具路由-toolhandlerts)
    - [7.4 遵循工具规范 (Status, Timestamp, stop\_event\_data)](#74-遵循工具规范-status-timestamp-stop_event_data)
  - [8. IPC 通信 (服务器端)](#8-ipc-通信-服务器端)
    - [8.1 选择 IPC 机制](#81-选择-ipc-机制)
    - [8.2 IPC 客户端模块 (`ipcClient.ts`)](#82-ipc-客户端模块-ipcclientts)
  - [9. 状态管理](#9-状态管理)
    - [9.1 需要跟踪的状态](#91-需要跟踪的状态)
    - [9.2 实现 (`stateManager.ts`)](#92-实现-statemanagerts)
  - [10. 错误处理](#10-错误处理)
  - [11. 日志记录](#11-日志记录)
  - [12. 安全注意事项](#12-安全注意事项)
  - [13. 客户端配置指南 (RooCode / Cline)](#13-客户端配置指南-roocode--cline)
    - [13.1 配置文件 (`mcp_settings.json`)](#131-配置文件-mcp_settingsjson)
    - [13.2 配置示例](#132-配置示例)
    - [13.3 配置项说明](#133-配置项说明)
  - [14. 测试策略](#14-测试策略)
  - [15. 相关资源](#15-相关资源)

---

### 1. 简介

#### 1.1 MCP 与本项目目标

Model Context Protocol (MCP) 是一种允许 AI 模型（如大型语言模型）与外部环境、工具或服务进行交互的协议。本项目旨在开发一个 MCP 服务器，它将充当 AI 代理（例如 Claude、或通过 RooCode/Cline 使用的 AI）和你的 VS Code 插件之间的桥梁。通过这个服务器，AI 可以调用预定义的 "Roocode Debugger" 工具集，进而通过 VS Code 插件间接控制 VS Code 的调试功能（设置断点、单步执行、检查变量等）。

本服务器的核心职责是：
*   监听来自 AI 的 MCP 请求（通过 **stdio**）。
*   解析请求，识别要调用的调试工具及其参数。
*   通过进程间通信（IPC）将指令转发给配套的 VS Code 插件。
*   接收来自插件的执行结果或调试事件（通过 IPC）。
*   将结果格式化为 MCP 响应，回传给 AI（通过 **stdio**）。

#### 1.2 目标读者

本指南面向需要开发 MCP 服务器的开发者，特别是：
*   希望将外部工具（尤其是 VS Code 功能）暴露给 AI 模型的开发者。
*   需要实现 MCP 服务器与 VS Code 插件进行 IPC 通信的开发者。
*   TypeScript 和 Node.js 的初中级开发者。

### 2. 先决条件

*   **Node.js:** v16 或更高版本。
*   **npm 或 yarn:** Node.js 包管理器。
*   **TypeScript:** 熟悉 TS 语法和基本概念 (v4.x 或更高)。
*   **JSON:** 深入理解 JSON 格式。
*   **异步编程:** 熟练使用 `async/await`。
*   **调试基础:** 理解断点、调用栈、作用域、单步执行等概念。
*   **IPC 基础 (推荐):** 对 stdio、Node.js `child_process` IPC 有基本了解。

### 3. 核心概念

#### 3.1 MCP 通信流程

1.  **AI -> Server:** AI 通过其客户端（如 RooCode/Cline）启动 MCP 服务器进程，并通过该进程的 **标准输入 (stdin)** 发送 JSON 请求 (包含 `tool_name`, `tool_input`, 可选 `invocation_id`)。
2.  **Server Processing:**
    *   服务器从 `stdin` 读取并解析请求。
    *   验证输入。
    *   通过 IPC 向 VS Code 插件发送指令。
    *   等待插件的 IPC 响应或事件。
3.  **Server -> AI:** 服务器将插件的结果格式化为 JSON 响应 (包含 `tool_result` 或 `tool_error`, `status`, `timestamp`, `stop_event_data` 等，以及回传的 `invocation_id`)，并通过其 **标准输出 (stdout)** 发送回 AI 客户端。

#### 3.2 通信方式 (stdio)

本项目 **仅** 使用 **stdio (标准输入/输出)** 作为 MCP 的通信传输方式。

*   **优点:**
    *   简单直接，易于被其他进程（如 VS Code 插件或 AI 客户端）启动和管理。
    *   低延迟（无网络开销）。
    *   安全性较高（无网络端口暴露）。
    *   设置简单（无需运行 HTTP 服务器）。
    *   通常作为 AI 客户端的子进程运行。
*   **实现:** 使用 `process.stdin` 读取，`process.stdout` 写入。Node.js 的 `readline` 模块用于处理基于换行符的消息分割。
*   **关键:** 所有日志记录 **必须** 输出到 **标准错误流 (stderr)** (`process.stderr` 或 `console.error`)，以避免干扰 `stdout` 上的 MCP 协议通信。

#### 3.3 与 VS Code 插件的交互 (IPC)

这是架构的核心。MCP 服务器 **不直接** 调用 VS Code API 或 DAP。

*   **Server -> Extension:** 服务器定义一套内部命令（如 `setBreakpoint`, `continueDebugging`），通过 IPC 发送给插件。
*   **Extension -> Server:** 插件执行 VS Code 操作后，将结果（成功信息、错误、调试事件如 `stopped`）通过 IPC 回传给服务器。

#### 3.4 Debug Adapter Protocol (DAP) 的相关性

DAP 是 VS Code 与调试器后端通信的标准协议。虽然 MCP 服务器不直接使用 DAP，但：
*   VS Code 插件会使用 DAP 与调试器交互。
*   "Roocode Debugger" 工具集的设计（名称、参数、返回值）**紧密映射**了 DAP 的概念和结构。理解 DAP 有助于理解工具的行为和插件需要实现的功能。

### 4. 系统架构

```mermaid
graph LR
    subgraph AI Agent Environment
        A[AI Client (e.g., RooCode/Cline)] -- Spawns Process --> B;
    end

    subgraph MCP Server Process (Node.js/TS, stdio)
        B(MCP Listener - stdio)
        C(Tool Router)
        D(Tool Handlers - e.g., processSetBreakpoint)
        E(IPC Client Module)
        F(State Manager)
    end

    subgraph VS Code Environment
        G[VS Code Extension (TS)]
        H(IPC Server Module)
        I(VS Code API / Debug API Wrapper)
        J(VS Code Debugger - DAP Client)
    end

    subgraph Debugger Process
        K[Actual Debugger (e.g., Python Debugpy, Node Debug)]
    end

    A -- MCP Request (JSON over stdin) --> B;
    B -- Parsed Request --> C;
    C -- Dispatch --> D;
    D -- Internal Command --> E;
    E -- IPC Request --> H;
    H -- Parsed Command --> I;
    I -- VS Code API Call --> J;
    J -- DAP Request --> K;
    K -- DAP Response/Event --> J;
    J -- Debug Event/Result --> I;
    I -- Internal Result/Event --> H;
    H -- IPC Response/Event --> E;
    E -- Result/Event --> D;
    D -- Formatted Response --> B;
    B -- MCP Response (JSON over stdout) --> A;

    D -- Access/Update --> F; % Tool handlers use state
    E -- Update --> F; % IPC client updates state on events
```

### 5. 项目设置

#### 5.1 初始化项目

```bash
mkdir roocode-mcp-server
cd roocode-mcp-server
npm init -y
npm install typescript @types/node --save-dev
npx tsc --init
mkdir src dist logs # logs 目录可选，用于文件日志
```

#### 5.2 推荐依赖

```bash
npm install pino uuid # 核心依赖：日志, UUID
npm install @types/pino @types/uuid --save-dev # 类型定义
# 可选，用于命令行参数解析 (如果服务器需要额外参数)
# npm install commander
```

#### 5.3 `package.json` 示例

```json
{
  "name": "roocode-mcp-server",
  "version": "1.1.0", // 版本更新
  "description": "MCP Server (stdio-only) for Roocode Debugger",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js", // 默认启动 (stdio)
    "dev": "tsc -w & nodemon dist/server.js", // 开发模式 (需 npm i -D nodemon)
    "lint": "eslint src/**/*.ts",
    "format": "prettier --write src/**/*.ts"
  },
  "devDependencies": {
    "@types/node": "^18.0.0",
    "@types/pino": "^7.0.5",
    "@types/uuid": "^8.3.4",
    "nodemon": "^2.0.19", // for dev script
    "typescript": "^4.7.0",
    // 可选：代码风格和检查
    "eslint": "^8.0.0",
    "prettier": "^2.7.0",
    "@typescript-eslint/eslint-plugin": "^5.0.0",
    "@typescript-eslint/parser": "^5.0.0"
  },
  "dependencies": {
    "pino": "^8.0.0",
    "uuid": "^8.3.2"
    // "commander": "^9.4.0" // 如果需要解析额外参数
  }
}
```

#### 5.4 `tsconfig.json` 示例

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "moduleResolution": "node"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "**/*.test.ts"]
}
```

### 6. MCP 协议实现 (stdio)

#### 6.1 消息格式 (推荐类 OpenAI/JSON-RPC)

*   **AI 请求 (来自 stdin):**
    ```json
    {
      "invocation_id": "unique-request-id-123",
      "tool_name": "set_breakpoint",
      "tool_input": { ... }
    }
    ```
*   **服务器响应 (写入 stdout, 成功):**
    ```json
    {
      "invocation_id": "unique-request-id-123",
      "tool_result": {
        "status": "success",
        "breakpoint": { ..., "timestamp": "..." }
      }
    }
    ```
*   **服务器响应 (写入 stdout, 异步停止):**
    ```json
    {
      "invocation_id": "unique-request-id-456",
      "tool_result": {
        "status": "stopped",
        "stop_event_data": { "timestamp": "...", ... }
      }
    }
    ```
*   **服务器响应 (写入 stdout, 失败):**
    ```json
    {
      "invocation_id": "unique-request-id-789",
      "tool_error": {
        "status": "error",
        "message": "..."
      }
    }
    ```
    *(注意：所有响应都必须以换行符 `\n` 结尾)*

#### 6.2 stdio 实现 (`server.ts`)

```typescript
// src/server.ts
import * as readline from 'readline';
import { logger } from './logger'; // 统一日志记录器
import { handleToolCall } from './toolHandler';
import { initializeIPC, closeIPC } from './ipcClient'; // IPC 初始化

function startStdioServer() {
    logger.info('Starting MCP Server in stdio mode...');
    initializeIPC(); // 初始化与插件的 IPC

    const rl = readline.createInterface({
        input: process.stdin,
        // output: process.stdout, // 不直接使用 readline 的 output
        terminal: false, // 必须为 false
        crlfDelay: Infinity // 更可靠地处理行尾
    });

    rl.on('line', async (line) => {
        // 输入日志记录在 logger 内部完成（如果需要）
        // logger.debug({ received: line }, 'Received line via stdio');
        let request: any;
        try {
            request = JSON.parse(line);
            // 基本验证
            if (!request || typeof request.tool_name !== 'string') {
                throw new Error('Invalid request format: missing or invalid tool_name.');
            }
            if (request.tool_input === undefined) { // tool_input 可以是 null 或 {}
                throw new Error('Invalid request format: missing tool_input.');
            }
        } catch (error) {
            logger.error({ error: error, line: line }, 'Failed to parse MCP request');
            const errorResponse = {
                invocation_id: request?.invocation_id, // 尝试包含 ID
                tool_error: { status: "error", message: `Invalid MCP request: ${error instanceof Error ? error.message : String(error)}` }
            };
            // 写入错误响应到 stdout
            process.stdout.write(JSON.stringify(errorResponse) + '\n');
            return; // 停止处理此无效行
        }

        // 调用核心工具处理逻辑
        try {
            const response = await handleToolCall(request.tool_name, request.tool_input, request.invocation_id);

            // 确保 invocation_id 被包含在响应中 (如果请求中有)
            if (request.invocation_id && response && typeof response === 'object') {
                 // 假设 handleToolCall 返回的结构已包含 tool_result 或 tool_error
                 // 或者直接是 { status: ..., ... }
                 // 我们直接在最外层添加/覆盖 invocation_id
                 (response as any).invocation_id = request.invocation_id;
            } else if (!response && request.invocation_id) {
                // 如果 handleToolCall 返回 null/undefined，可能需要构造一个空响应或错误
                logger.warn({ tool: request.tool_name, invocationId: request.invocation_id }, 'Tool handler returned no response.');
                // 根据需要决定是返回空成功还是错误
                // return; // 或者发送一个特定的空响应
            }

            if (response) { // 仅当有响应时才发送
                const responseString = JSON.stringify(response);
                // 输出日志记录在 logger 内部完成（如果需要）
                // logger.debug({ sent: responseString }, 'Sending response via stdio');
                process.stdout.write(responseString + '\n'); // **写入响应到 stdout 并加换行符**
            }

        } catch (error) {
            // 捕获 handleToolCall 内部未处理的意外错误
            logger.error({ error: error, tool: request.tool_name, invocationId: request.invocation_id }, 'Unhandled error during tool execution');
            const errorResponse = {
                invocation_id: request.invocation_id,
                tool_error: { status: "error", message: `Internal server error processing tool '${request.tool_name}': ${error instanceof Error ? error.message : 'Unknown error'}` }
            };
            process.stdout.write(JSON.stringify(errorResponse) + '\n');
        }
    });

    rl.on('close', () => {
        logger.info('stdin stream closed. Shutting down stdio server.');
        closeIPC(); // 清理 IPC 连接
        process.exit(0); // 正常退出
    });

    // 捕获未处理的 Promise 拒绝
    process.on('unhandledRejection', (reason, promise) => {
        logger.fatal({ reason, promise }, 'Unhandled Rejection at Promise');
        // 考虑是否需要发送一个通用的错误消息给客户端？可能比较困难，因为不知道对应的 invocation_id
        closeIPC();
        process.exit(1); // 异常退出
    });

    // 捕获未捕获的同步异常
    process.on('uncaughtException', (error, origin) => {
        logger.fatal({ error, origin }, 'Uncaught Exception');
        closeIPC();
        process.exit(1); // 异常退出
    });


    logger.info('stdio MCP listener ready. Waiting for requests on stdin...');
}

// --- Main Execution ---
startStdioServer(); // 直接启动 stdio 服务器

// Graceful shutdown handlers
process.on('SIGINT', () => {
    logger.info('Received SIGINT. Gracefully shutting down...');
    closeIPC();
    process.exit(0);
});
process.on('SIGTERM', () => {
    logger.info('Received SIGTERM. Gracefully shutting down...');
    closeIPC();
    process.exit(0);
});
```

### 7. 工具实现 (Roocode Debugger)

#### 7.1 工具路由 (`toolHandler.ts`)

(代码与上一版本 7.1 节基本相同，确保所有工具都被注册。)

```typescript
// src/toolHandler.ts
import { logger } from './logger';
import { sendRequestToExtension, registerIpcResponseHandler } from './ipcClient';
import { v4 as uuidv4 } from 'uuid';

// 工具处理函数类型
type ToolHandler = (input: any, invocationId?: string) => Promise<any>;

// 工具注册表
const toolRegistry: Map<string, ToolHandler> = new Map();

// --- 注册工具 ---
// (在此处调用 toolRegistry.set 注册所有 Roocode Debugger 工具的处理函数)
toolRegistry.set('get_debugger_configurations', processGetDebuggerConfigurations); // 需要实现
toolRegistry.set('set_breakpoint', processSetBreakpoint);
toolRegistry.set('remove_breakpoint', processRemoveBreakpoint); // 需要实现
toolRegistry.set('get_breakpoints', processGetBreakpoints); // 需要实现
toolRegistry.set('start_debugging', processStartDebugging); // 需要实现 (异步)
toolRegistry.set('continue_debugging', processContinueDebugging);
toolRegistry.set('step_execution', processStepExecution); // 需要实现 (异步)
toolRegistry.set('get_scopes', processGetScopes); // 需要实现
toolRegistry.set('get_variables', processGetVariables); // 需要实现
toolRegistry.set('evaluate_expression', processEvaluateExpression); // 需要实现
toolRegistry.set('stop_debugging', processStopDebugging); // 需要实现

// 主处理函数 (与上一版本 7.1 节相同)
export async function handleToolCall(toolName: string, toolInput: any, invocationId?: string): Promise<any> {
    logger.info({ toolName, invocationId }, 'Handling tool call');
    const handler = toolRegistry.get(toolName);

    if (!handler) {
        logger.warn({ toolName }, 'Unknown tool requested');
        // 返回符合 MCP 格式的错误
        return { tool_error: { status: "error", message: `Unknown tool: ${toolName}` } };
    }

    try {
        const result = await handler(toolInput, invocationId);
        logger.info({ toolName, invocationId, status: result?.status ?? result?.tool_result?.status ?? 'unknown' }, 'Tool execution finished');
        // 确保返回结构符合规范 (包含 status 等)
        // 如果 handler 返回的是插件原始数据，这里可能需要包装
        return result; // 假设 handler 返回的就是最终 MCP 结构
    } catch (error) {
        logger.error({ error, toolName, invocationId }, 'Error executing tool handler');
        // 返回符合 MCP 格式的错误
        return { tool_error: { status: "error", message: `Error executing tool '${toolName}': ${error instanceof Error ? error.message : String(error)}` } };
    }
}

// --- 实现所有 Roocode Debugger 工具的处理函数 ---
// (需要为上面注册的每个工具编写 processXXX 函数)

// 示例：同步工具 set_breakpoint (与上一版本 7.2 节相同)
async function processSetBreakpoint(toolInput: any): Promise<any> {
    logger.debug({ toolInput }, 'Processing set_breakpoint');
    // 1. 输入验证
    if (!toolInput?.file_path || typeof toolInput.file_path !== 'string' ||
        !toolInput?.line_number || typeof toolInput.line_number !== 'number') {
        // 返回 MCP 错误结构
        return { tool_error: { status: "error", message: "Missing or invalid required parameters: file_path (string), line_number (number)." }};
    }
    // 2. 构造 IPC 请求参数
    const ipcArgs = { /* ... */ };
    // 3. 发送 IPC 请求并等待响应
    try {
        const extensionResult = await sendRequestToExtension('setBreakpoint', ipcArgs);
        // 4. 格式化为 MCP 响应
        if (extensionResult && typeof extensionResult.id === 'number') {
            // 返回 MCP 成功结构
            return {
                tool_result: { // 包装在 tool_result 中
                    status: "success",
                    breakpoint: { /* ... 包含 timestamp ... */ }
                }
            };
        } else {
            throw new Error("Extension returned invalid data for setBreakpoint.");
        }
    } catch (ipcError) {
        logger.error({ error: ipcError }, 'IPC error during setBreakpoint');
        // 返回 MCP 错误结构
        return { tool_error: { status: "error", message: `Failed to set breakpoint via IPC: ${ipcError instanceof Error ? ipcError.message : String(ipcError)}` }};
    }
}

// 示例：异步工具 continue_debugging (与上一版本 7.3 节类似)
async function processContinueDebugging(toolInput: any, invocationId?: string): Promise<any> {
    logger.debug({ toolInput, invocationId }, 'Processing continue_debugging');
     // 1. 输入验证
    if (!toolInput || typeof toolInput.thread_id !== 'number') {
        return { tool_error: { status: "error", message: "Missing or invalid required parameter: thread_id (number)." }};
    }
    // 2. 发送 IPC 命令，等待插件通过 IPC 主动推送事件
    return new Promise(async (resolve) => {
        const ipcRequestId = uuidv4();
        let timeoutHandle: NodeJS.Timeout | null = null;
        let removeListener: (() => void) | null = null;
        const cleanup = () => { /* ... */ };

        // 注册一次性监听器
        removeListener = registerIpcResponseHandler(ipcRequestId, (ipcResponse) => {
            cleanup();
            logger.debug({ ipcResponse, ipcRequestId }, 'Received IPC response for async continueDebugging');
            let mcpResponse: any; // 构建最终的 MCP 响应
            if (ipcResponse.error) {
                mcpResponse = { tool_error: { status: "error", message: ipcResponse.error }};
            } else if (ipcResponse.payload?.status === 'stopped') {
                // **确保 stop_event_data 包含 timestamp**
                // ... (检查并添加 timestamp) ...
                mcpResponse = { tool_result: { status: "stopped", stop_event_data: ipcResponse.payload.stop_event_data }};
            } else if (ipcResponse.payload?.status === 'completed') {
                mcpResponse = { tool_result: { status: "completed", message: ipcResponse.payload.message || "Debugging session completed." }};
            } // ... 其他状态处理 ...
            else {
                logger.warn({ ipcResponse, ipcRequestId }, 'Received unexpected IPC payload for async operation');
                mcpResponse = { tool_error: { status: "error", message: "Received unexpected response from extension." }};
            }
            resolve(mcpResponse); // Resolve Promise with the MCP response object
        });

        // 设置超时
        const timeoutMillis = 60000;
        timeoutHandle = setTimeout(() => { /* ... resolve with timeout error ... */ }, timeoutMillis);

        // 发送 IPC 请求
        try {
            // 假设 sendCommand 只发送不等待，或者插件用 ID 回复事件
            await sendIPCCommand('continueDebugging', { threadId: toolInput.thread_id }, ipcRequestId);
            logger.debug({ ipcRequestId }, 'Sent IPC request for continueDebugging, waiting for event...');
        } catch (ipcError) {
            cleanup();
            logger.error({ error: ipcError }, 'Failed to send IPC request for continueDebugging');
            resolve({ tool_error: { status: "error", message: `Failed to send continue command: ${ipcError instanceof Error ? ipcError.message : String(ipcError)}` }});
        }
    });
}

// 假设有一个只发送命令的 IPC 函数
async function sendIPCCommand(command: string, args: any, commandId: string): Promise<void> {
    // 实现只发送 IPC 消息的逻辑，不等待响应
    if (!process.send) {
        throw new Error("IPC channel (process.send) is not available.");
    }
    const ipcRequest = { id: commandId, command, args };
    logger.debug({ ipcRequest }, 'Sending IPC command to extension');
    return new Promise((resolve, reject) => {
        process.send!(ipcRequest, (error) => {
            if (error) {
                logger.error({ error, command }, 'Failed to send IPC command');
                reject(new Error(`Failed to send IPC command: ${error.message}`));
            } else {
                resolve();
            }
        });
    });
}


// --- 需要实现其他所有工具的处理函数 ---
// processGetDebuggerConfigurations, processRemoveBreakpoint, etc.
```

#### 7.4 遵循工具规范 (Status, Timestamp, stop_event_data)

*   **`status` 字段:** 所有返回给 AI 的 JSON 对象（无论是成功还是失败）**必须**在 `tool_result` 或 `tool_error` 内部包含一个 `status` 字段，其值严格遵循 "Roocode Debugger" 规范。
*   **`timestamp` 字段:**
    *   `get_breakpoints` 的 `tool_result` 需要一个顶层 `timestamp`。
    *   `set_breakpoint` 的 `tool_result.breakpoint` 对象需要一个 `timestamp`。
    *   `stop_event_data` 对象**必须**包含一个顶层 `timestamp`。
    *   **实现:** 确保在生成 MCP 响应时，从插件获取或在服务器端生成 (`new Date().toISOString()`) 并包含所需的时间戳。
*   **`stop_event_data` 结构:** 当异步工具返回 `status: "stopped"` 时，其 `tool_result` 中必须包含 `stop_event_data` 对象，且结构完全符合规范。

### 8. IPC 通信 (服务器端)

#### 8.1 选择 IPC 机制

*   **`child_process` IPC (本项目选择):** VS Code 插件通过 `child_process.fork` 或 `spawn` (带 `stdio: 'ipc'`) 启动 MCP 服务器。服务器使用 `process.on('message', ...)` 接收，`process.send(...)` 发送。

#### 8.2 IPC 客户端模块 (`ipcClient.ts`)

(代码与上一版本 8.2 节基本相同，包含 `initializeIPC`, `closeIPC`, `sendRequestToExtension`, `registerIpcResponseHandler`。)

**关键点:**
*   使用唯一 ID (`uuid`) 匹配请求和响应/事件。
*   区分同步请求（`sendRequestToExtension`）和异步操作（`registerIpcResponseHandler` + `sendIPCCommand`）。
*   处理超时。
*   在服务器启动时初始化 (`initializeIPC`)，在关闭时清理 (`closeIPC`)。

### 9. 状态管理

#### 9.1 需要跟踪的状态

*   `isDebuggingActive`: boolean
*   `debuggerState`: 'Idle' | 'Starting' | 'Running' | 'Stopped' | 'Terminating'
*   `lastStopEventData`: any | null (符合规范的结构)
*   `activeDebugSessionId`: string | null

#### 9.2 实现 (`stateManager.ts`)

(代码与上一版本 9.2 节基本相同，包含 `updateState`, `getState`, `handleDebuggerStopped`, `handleDebuggerTerminated` 等。)

### 10. 错误处理

*   **请求解析:** `try...catch` 包裹 `JSON.parse`。
*   **输入验证:** 在每个工具处理函数开始时检查参数。
*   **IPC 错误:** `sendRequestToExtension` 等函数应抛出或返回可识别的错误。
*   **插件执行错误:** 插件应通过 IPC 将执行错误传回，服务器需捕获并格式化。
*   **状态错误:** 工具处理函数应检查当前状态是否允许执行该操作。
*   **统一格式:** 所有错误最终都应格式化为包含 `invocation_id` (如果可用) 和 `tool_error: { status: "error", message: "..." }` 的 MCP 响应，并通过 `stdout` 发送。

### 11. 日志记录

*   **使用 `pino`:** 提供高性能、结构化的 JSON 日志。
*   **输出到 `stderr`:** **极其重要**，避免干扰 `stdout` 上的 MCP 通信。
    ```typescript
    // src/logger.ts
    import pino from 'pino';

    // 基础配置，强制输出到 stderr
    export const logger = pino({
        level: process.env.LOG_LEVEL || 'info', // 日志级别可通过环境变量控制
        // 可以添加时间戳、pid 等
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
            level: (label) => {
                return { level: label.toUpperCase() };
            },
        },
    }, pino.destination({ fd: process.stderr.fd, sync: false })); // 强制 stderr, 异步写入提高性能

    logger.info('Logger initialized.');
    ```
*   **记录关键信息:** 在请求接收、发送、IPC 通信、错误处理等关键点记录日志，包含 `invocation_id`、`toolName` 等上下文信息。

### 12. 安全注意事项

*   **输入验证:** 严格验证来自 AI 的所有输入 (`tool_input`)。
*   **执行限制:** 确保通过 IPC 传递给插件的命令是受控的。
*   **资源管理:** 注意清理 IPC 连接、移除事件监听器等。
*   **依赖安全:** 定期更新依赖库 (`npm audit`)。

### 13. 客户端配置指南 (RooCode / Cline)

根据你提供的信息，RooCode 和 Cline 使用 `mcp_settings.json` 文件来配置通过 stdio 运行的本地 MCP 服务器。

#### 13.1 配置文件 (`mcp_settings.json`)

你需要找到并编辑这个配置文件。它的具体位置取决于 RooCode 或 Cline 的安装和文档，通常可能在用户配置目录（如 `~/.config/roocode/`, `~/.cline/`）或项目的工作区设置中。

该文件使用 JSON 格式，包含一个顶层的 `mcpServers` 对象。该对象下的每个键值对代表一个已命名的 MCP 服务器配置。

#### 13.2 配置示例

要配置你的 Roocode Debugger MCP 服务器，你需要在 `mcpServers` 对象中添加一个新的条目，例如命名为 `vscode-debugger-mcp`：

```json
{
  "mcpServers": {
    "vscode-debugger-mcp": {
      "command": "node", // 指定用 node 执行
      "args": [
        "/full/path/to/your/mcp-server/dist/server.js" // **必须是 server.js 的绝对路径**
        // 如果你的服务器需要额外的命令行参数，可以在这里添加
        // 例如： "--log-level", "debug"
      ],
      "env": {
        // 如果服务器需要环境变量，可以在这里设置
        // "LOG_LEVEL": "debug"
      }
    },
    // ... 可能存在的其他服务器配置 ...
    "another-server": {
        // ...
    }
  }
}
```

**请务必将 `/full/path/to/your/roocode-mcp-server/dist/server.js` 替换为你实际编译出的 `server.js` 文件的绝对路径。**

#### 13.3 配置项说明

*   `"vscode-debugger-mcp"`: 你为这个服务器配置选择的唯一名称。AI 客户端会使用这个名称来识别和调用你的服务器。
*   `"command"`: 启动服务器进程的可执行文件。对于 Node.js 服务器，通常是 `node`。对于已发布的 npm 包,则会使用 npx 
*   `"args"`: 一个字符串数组，包含传递给 `command` 的参数。**第一个参数必须是你的 `server.js` 的完整路径。** 后续可以添加你的服务器支持的其他命令行参数。
*   `"env"`: (可选) 一个对象，定义需要为服务器进程设置的环境变量。

配置完成后，保存 `mcp_settings.json` 文件。下次启动 RooCode 或 Cline 时，它应该能识别并根据需要启动你的 `vscode-debugger-mcp` MCP 服务器，并通过 stdio 与之通信。

### 14. 测试策略

*   **单元测试:** (同前) 测试单个函数，Mock IPC。
*   **集成测试:**
    *   **模拟 AI (stdio):** 编写脚本，启动你的 `server.js` 进程，向其 `stdin` 写入 MCP 请求 JSON (每行一个)，并从其 `stdout` 读取和验证响应 JSON。
    *   **模拟插件:** (同前) 编写模拟插件响应 IPC 请求。
*   **端到端测试:** (同前) 运行真实插件和服务器，使用配置好的 RooCode/Cline 客户端发送调试命令。

### 15. 相关资源

*   **Node.js 文档:** [https://nodejs.org/api/](https://nodejs.org/api/) (特别是 `process`, `readline`, `child_process`)
*   **TypeScript 文档:** [https://www.typescriptlang.org/docs/](https://www.typescriptlang.org/docs/)
*   **Pino (日志):** [https://getpino.io/](https://getpino.io/)
*   **UUID:** [https://github.com/uuidjs/uuid](https://github.com/uuidjs/uuid)
*   **Debug Adapter Protocol (DAP):** [https://microsoft.github.io/debug-adapter-protocol/](https://microsoft.github.io/debug-adapter-protocol/)
*   **JSON Schema:** [https://json-schema.org/](https://json-schema.org/)
*   **OpenAI Tool Calling:** [https://platform.openai.com/docs/guides/function-calling](https://platform.openai.com/docs/guides/function-calling)
*   **JSON-RPC 2.0:** [https://www.jsonrpc.org/specification](https://www.jsonrpc.org/specification)
*   **(重要) RooCode / Cline 文档:** 查找关于 `mcp_settings.json` 的官方文档以获取最准确的位置和配置细节。

---

这份更新后的指南完全侧重于 stdio 通信，并包含了针对 RooCode/Cline 的具体配置方法。