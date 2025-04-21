# 当前任务规划

**任务描述:**
修复 `set_breakpoint` 工具的 bug。根据 `ProjectBrief.md` (line 464) 和用户提供的截图，当客户端调用 `set_breakpoint` 时，传递到 `src/mcpServerManager.ts` 的参数（如 `filePath`, `lineNumber` 等）似乎都是 `undefined` 或空的。

## 任务上下文

### 参数传递流程分析

客户端调用 `set_breakpoint` 工具的请求首先由 MCP 服务器接收，并在 `mcp-server/src/toolProviders/debuggerTools.ts` 的 `handleSetBreakpoint` 函数中处理。该函数使用 `setBreakpointSchema` 对输入的参数进行验证。

**mcp-server/src/toolProviders/debuggerTools.ts:**
```typescript
107 | export const setBreakpointSchema = z.object({
108 |     file_path: z.string().min(1, "File path cannot be empty."),
109 |     line_number: z.number().int().positive("Line number must be a positive integer."),
110 |     column_number: z.number().int().positive("Column number must be a positive integer.").optional(),
111 |     condition: z.string().optional(),
112 |     hit_condition: z.string().optional(),
113 |     log_message: z.string().optional(),
114 | });
...
129 | export async function handleSetBreakpoint(
130 |     args: SetBreakpointArgs, // 恢复为 SetBreakpointArgs 类型
131 |     extra: any
132 | ): Promise<SetBreakpointResult> {
133 |     console.log('[MCP Server] Handling set_breakpoint request...');
134 | 
135 |     // 参数校验由 MCP SDK 使用 setBreakpointSchema 完成。
136 | 
137 |     try {
138 |         // 调用 pluginCommunicator 向插件发送设置断点请求
139 |         // 'setBreakpoint' 是自定义的命令字符串，需要与插件端监听的命令一致
140 |         // 使用 type 字段（pluginCommunicator 内部会映射到 command），并直接传递 args 作为 payload
141 |         const pluginResponse: PluginResponse = await sendRequestToPlugin({ type: 'setBreakpoint', payload: args });
```
在 `handleSetBreakpoint` 函数中，经过验证的参数 `args` 被直接作为 `payload` 发送给插件端。`setBreakpointSchema` 中定义的参数名使用了蛇形命名法（snake_case），例如 `file_path` 和 `line_number`。

插件端 (`src/mcpServerManager.ts`) 通过 IPC 监听来自 MCP 服务器子进程的消息。在接收到类型为 'request'、命令为 'setBreakpoint' 的消息后，会尝试从 `payload` 中解构出参数。

**src/mcpServerManager.ts:**
```typescript
128 |                 this.mcpServerProcess.on('message', async (message: PluginRequest | any) => {
129 |                     console.log('[Plugin] Received IPC message from server:', message);
130 |                     this.outputChannel.appendLine(`[IPC] Received message: ${JSON.stringify(message)}`);
131 | 
132 |                     // 检查是否为 setBreakpoint 请求
133 |                     if (message?.type === 'request' && message.command === 'setBreakpoint') {
134 |                         const { requestId, payload } = message;
135 |                         try {
136 |                             const { filePath, lineNumber, columnNumber, condition, hitCondition, logMessage } = payload;
137 | 
138 |                             // 基本参数校验
139 |                             if (!filePath || typeof lineNumber !== 'number' || lineNumber <= 0) {
140 |                                 throw new Error('Invalid setBreakpoint request payload: missing or invalid filePath or lineNumber.');
```
57 | 在 `src/mcpServerManager.ts` 的消息监听器中，解构 `payload` 时使用了驼峰命名法（camelCase），例如 `filePath` 和 `lineNumber`。
58 |
59 | ## 任务规划
60 |
61 | **目标:** 解决 MCP 服务器与 VSCode 插件之间因参数命名规范不一致导致的 `set_breakpoint` 参数传递失败问题。
62 |
63 | **问题根源:**
64 | MCP 服务器 (`mcp-server/src/toolProviders/debuggerTools.ts`) 发送的 `setBreakpoint` 请求 `payload` 中，参数使用了蛇形命名法 (snake_case)，例如 `file_path`, `line_number`。
65 | VSCode 插件 (`src/mcpServerManager.ts`) 在接收消息时，尝试使用驼峰命名法 (camelCase) 解构 `payload`，例如 `filePath`, `lineNumber`，导致无法正确获取参数值。
66 |
67 | **修复方案分析:**
68 |
69 | 1.  **方案一：修改插件端接收逻辑 (推荐)**
70 |     *   **描述:** 在 `src/mcpServerManager.ts` 中，修改解构赋值语句，使其能够正确接收蛇形命名的参数，并将其映射到驼峰命名的变量上。
71 |     *   **优点:**
72 |         *   改动范围最小，仅需修改插件端的一个文件。
73 |         *   逻辑直接，易于理解和实现。
74 |         *   风险较低，对其他部分影响小。
75 |     *   **缺点:**
76 |         *   可能轻微破坏插件端代码内部命名风格的统一性（如果其他部分强制使用驼峰）。
77 |         *   如果未来增加更多工具，可能需要在插件端重复处理类似命名转换。
78 |
79 | 2.  **方案二：修改服务器端发送逻辑**
80 |     *   **描述:** 在 `mcp-server/src/toolProviders/debuggerTools.ts` 的 `handleSetBreakpoint` 函数中，在调用 `sendRequestToPlugin` 之前，将 `args` 对象中的蛇形命名键转换为驼峰命名。
81 |     *   **优点:**
82 |         *   保持插件端代码风格统一。
83 |         *   将命名转换逻辑集中在服务器端。
84 |     *   **缺点:**
85 |         *   需要修改服务器端代码。
86 |         *   如果服务器未来需要与其他遵循蛇形命名规范的客户端交互，可能会增加复杂性。
87 |         *   需要引入转换函数或库。
88 |
89 | 3.  **方案三：引入转换层或工具库**
90 |     *   **描述:** 在服务器端或插件端引入一个专门处理命名规范转换的库（如 `lodash` 的 `mapKeys`, `camelCase`, `snakeCase` 或自定义转换函数），在数据发送或接收时自动进行转换。
91 |     *   **优点:**
92 |         *   代码更规范、可读性更高。
93 |         *   通用性强，方便处理其他接口或工具的命名转换。
94 |     *   **缺点:**
95 |         *   增加项目依赖（如果使用外部库）。
96 |         *   可能引入轻微的性能开销。
97 |         *   需要学习和配置库的使用。
98 |
99 | **推荐方案:** **方案一：修改插件端接收逻辑**
100|
101| **理由:** 这是当前最直接、改动最小、风险最低的解决方案。虽然牺牲了插件端部分代码的命名统一性，但避免了修改服务器端逻辑或引入新依赖的复杂性。待未来命名转换需求普遍时，再考虑重构为方案二或方案三。
102|
103| **详细实施步骤 (方案一):**
104|
105| 1.  **目标文件:** `src/mcpServerManager.ts`
106| 2.  **定位代码:** 找到 `this.mcpServerProcess.on('message', ...)` 监听器内部，处理 `message.command === 'setBreakpoint'` 的代码块。
107| 3.  **修改内容:** 修改 `payload` 的解构赋值语句，使用冒号 `:` 来将蛇形命名的属性赋值给驼峰命名的变量。
108|     ```typescript
109|     // 定位到大约第 136 行
110|     // 原始代码:
111|     // const { filePath, lineNumber, columnNumber, condition, hitCondition, logMessage } = payload;
112|
113|     // 修改后:
114|     const {
115|         file_path: filePath,      // 将 snake_case 映射到 camelCase
116|         line_number: lineNumber,    // 将 snake_case 映射到 camelCase
117|         column_number: columnNumber, // 可选参数，同样处理
118|         condition,                 // 如果命名一致则无需映射
119|         hit_condition: hitCondition, // 将 snake_case 映射到 camelCase
120|         log_message: logMessage     // 将 snake_case 映射到 camelCase
121|     } = payload;
122|     ```
123| 4.  **验证:** 确保后续代码（如第 139 行的校验逻辑）使用的是修改后的驼峰变量名 (`filePath`, `lineNumber` 等）。从 `CurrentTask.md` 的代码片段看，后续代码已经是使用驼峰变量，因此无需更改。
124|
125| **下一步:**
126| 将此任务规划交给编码者 (coder) 执行具体的代码修改。
