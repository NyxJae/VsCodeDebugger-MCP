# 项目文档
一个VsCode插件 用于启动和管理一个 Model Context Protocol 服务器,向AI 提供在VsCode 中 断点调试的能力
## 技术架构
语言:Ts
Model Context Protocol
VsCode API
VsCode Extension API
stdio
vscode 插件部分不需要 webview 
## 功能模块
## 项目文档目录
- [VS Code插件开发指南](Docs/Doc_VsCode_Extention.md) - VS Code插件开发基础知识和API指南
- [通用文档](Docs/Doc_Common.md) - 记录项目经验和收获
- [变更日志](Docs/ChangeLog.md) - 记录项目版本变更历史
## 当前整体需求
1. 前端 管理MCP服务器
   1. 启动MCP服务器
   2. 停止MCP服务器
   3. 重启MCP服务器
   4. 查看MCP服务器状态
   5. VsCode窗口多开,管理MCP服务器
      - 若插件初始化时没有启动MCP服务器,则启动本项目的MCP服务器
      - 若插件初始化时已经有启动的MCP服务器,则不启动本项目的MCP服务器
      - 若用户手动开启本项目的MCP服务器,则关闭其他MCP服务器,并启动本项目的
   6. 更改端口号
   7. 设置是否自动启动MCP服务器
      - 设置是否自动启动MCP服务器,若设置为自动启动,则在VsCode启动时自动启动MCP服务器(按)
      - 设置是否自动启动MCP服务器,若设置为不自动启动,则在VsCode启动时不自动启动MCP服务器(无论是否有其他MCP服务器启动)
    8. 在Vscode 右下角(应该是状态栏,很多插件的运行时信息都限制在这),显示当前项目的MCP服务器的状态(是否启动中),点击可弹出设置面板,可设置启停,更改端口号,设置是否自动启动等
    9. 弹出的设置面板中提供客户端配置模板一键复制按钮,(针对Claude客户端cursor,Cline等MCP客户端)
    10. 
2. MCP服务器
### MCP服务器 提供如下工具
**Roocode Debugger 工具组 - 完整详细需求文档**

**1. 概述**

该工具组的目标是使 AI 代理能够通过调用一系列预定义的、结构化的工具，与 Visual Studio Code (VS Code) 的调试功能进行交互。通过这种方式，AI 可以自动化地控制代码的执行、设置断点、检查变量状态、遍历调用栈，并最终完成复杂的调试任务。

**核心原则:**

*   **VS Code 调试能力映射:** 工具的功能设计紧密围绕 VS Code 的标准调试能力，其底层实现应尽可能利用或封装 VS Code Debug Adapter Protocol (DAP)，以确保广泛的兼容性和强大的功能。
*   **状态驱动交互:** AI 代理需要根据工具返回的信息（特别是 `status` 字段和相关数据负载，如 `stop_event_data`）来精确理解和维护当前调试会话的状态（例如：未启动、正在运行、在断点处暂停、已完成、已出错）。这是 AI 决定后续调试策略和工具调用的基础。
*   **清晰明确的接口:** 每个工具都具有严格定义的接口，包括其目的、类型（同步/异步）、必需和可选的输入参数（及其数据类型），以及详尽的返回值结构（覆盖成功和各种失败场景）。
*   **信息时效性:** 对于在调试会话期间可能频繁更新的关键信息（如断点列表、调试器停止时的状态快照），相关工具的返回值将包含一个标准格式的时间戳。这使 AI 能够在其对话历史上下文中有效区分信息的“新鲜度”，确保基于最新的状态进行决策。

**2. 核心概念**

*   **Roocode 工作范式:**
    *   **同步工具:** 调用后，Roocode 立即执行并返回结果给 AI。
    *   **异步工具:** 调用后，Roocode 启动操作并进入等待状态，直到特定的调试事件发生（如断点命中）、操作完成、超时，然后才将结果返回给 AI.。
*   **VS Code Debug Adapter Protocol (DAP):** 虽然 AI 不直接与 DAP 交互，但这套工具的设计理念和许多术语（如断点、线程、堆栈帧、作用域、变量引用）都源自 DAP，理解 DAP 有助于理解工具的行为。
*   **调试会话状态:** AI 必须能够根据工具的返回值推断出调试会话的当前生命周期阶段：
    *   `Idle` / `Inactive`: 没有活动的调试会话。
    *   `Starting`: 正在启动调试会话。
    *   `Running`: 程序正在执行，未暂停。
    *   `Stopped`: 程序执行已暂停（例如在断点、异常处）。
    *   `Terminating`: 正在停止调试会话。
    *   `Terminated`: 调试会话已结束。
*   **时间戳 (Timestamp):**
    *   **目的:** 帮助 AI 在包含历史交互记录的上下文中，识别最新获取的状态信息。
    *   **格式:** 采用 **ISO 8601** 标准格式的字符串，表示 **UTC** 时间（例如: `"2025-04-16T03:14:00.123Z"`）。
    *   **应用:** 主要用于标记 `get_breakpoints` 返回的列表、`set_breakpoint` 返回的单个断点信息，以及 `stop_event_data` 结构。时间戳代表该份数据被工具检索或生成的精确时刻。

**3. 通用返回结构**

所有工具的返回值都必须包含一个顶层的 `status` 字段，用以明确指示该次工具调用的执行结果。常见的 `status` 值包括：

*   `"success"`: (同步工具) 操作成功完成。
*   `"error"`: 操作执行失败。返回值中必须包含一个 `message` 字段 (string) 来描述错误的原因。
*   `"stopped"`: (异步工具) 操作成功，且调试器当前在某个位置暂停执行。返回值中必须包含 `stop_event_data` 对象。
*   `"completed"`: (异步工具) 操作成功，且调试会话在此操作期间或之后正常运行结束。
*   `"timeout"`: (异步工具) 等待调试事件发生的操作超过了预设或指定的最大等待时间。返回值中应包含 `message` 字段说明超时。

**4. 工具规格详述**

---

**4.1 `get_debugger_configurations` (获取调试器配置)**

*   **目的:** 读取当前 VS Code 工作区（路径由 Roocode 环境自动确定）下 `.vscode/launch.json` 文件中定义的所有调试配置。这些配置信息主要供 `start_debugging` 工具使用，以确定启动哪个调试会话。强烈建议在调用 `start_debugging` 之前先调用此工具。
*   **类型:** 同步工具。
*   **输入参数:** 无。
*   **返回值:**
    *   **成功:**
        *   `status`: `"success"`
        *   `configurations`: 一个列表 (list)。列表中的每个元素都是一个对象 (object)，代表 `launch.json` 中的一个调试配置项。每个对象至少包含以下关键属性：
            *   `name`: 配置的名称 (string)，例如 `"Python: 当前文件"` 或 `"Attach to Node Process"`。这是用户在 `launch.json` 中定义的 `name`，也是 `start_debugging` 工具识别配置的主要依据。
            *   `type`: 调试器的类型 (string)，例如 `"python"`, `"node"`, `"cppvsdbg"`, `"java"`, `"go"`。对应 `launch.json` 中的 `type` 字段。
            *   `request`: 请求类型 (string)，通常是 `"launch"` (启动新进程) 或 `"attach"` (附加到已运行进程)。对应 `launch.json` 中的 `request` 字段。
            *   *(可选)* 其他 `launch.json` 中定义的与该配置相关的具体参数 (any type)，例如 `program`, `module`, `processId`, `port`, `cwd`, `args` 等。这些附加信息有助于 AI 更全面地理解每个配置的作用。
        *   *示例:*
            ```json
            {
              "status": "success",
              "configurations": [
                {
                  "name": "Python: 当前文件",
                  "type": "python",
                  "request": "launch",
                  "program": "${file}",
                  "console": "integratedTerminal"
                },
                {
                  "name": "Node: Attach by Process ID",
                  "type": "node",
                  "request": "attach",
                  "processId": "${command:PickProcess}",
                  "protocol": "inspector"
                }
              ]
            }
            ```
    *   **失败:**
        *   `status`: `"error"`
        *   `message`: 描述错误的字符串 (string)，例如 `"无法找到或解析 launch.json 文件"`, `"launch.json 格式错误"`, `"工作区路径无效"`。

---

**4.2 `set_breakpoint` (设置断点)**

*   **目的:** 在源代码文件的指定位置尝试设置一个断点。可以设置常规断点、条件断点、命中次数断点或日志点 (Logpoint)。
*   **类型:** 同步工具。
*   **输入参数:**
    *   `file_path` (必需, string): 目标源代码文件的绝对路径或相对于工作区的路径。
    *   `line_number` (必需, number): 要设置断点的行号 (基于 1 开始计数)。
    *   `column_number` (可选, number): 要设置断点的列号 (基于 1 开始计数)。如果省略，通常指该行的第一个有效位置。
    *   `condition` (可选, string): 一个布尔表达式。只有当程序执行到此断点且该表达式计算结果为真时，调试器才会暂停。
    *   `hit_condition` (可选, string): 命中次数条件。例如 `"> 5"` 表示只有在第 6 次及之后命中此断点时才暂停；`"== 3"` 表示仅在第 3 次命中时暂停；`"% 2 == 0"` 表示仅在偶数次命中时暂停。
    *   `log_message` (可选, string): 如果提供此参数，则将断点设置为日志点。当命中此位置时，调试器不会暂停执行，而是会在调试控制台输出指定的 `log_message`（可以包含 `{expression}` 形式的插值）。设置了 `log_message` 通常会忽略 `condition` 和 `hit_condition`。
*   **返回值:**
    *   **成功:**
        *   `status`: `"success"`
        *   `breakpoint`: 一个描述已请求设置的断点的对象 (object)，包含:
            *   `id`: 由调试器后端分配的此断点的唯一标识符 (number)。此 ID 非常重要，用于后续通过 `remove_breakpoint` 或在 `stop_event_data` 中识别命中的断点。
            *   `verified`: 一个布尔值 (boolean)，指示调试器是否已成功验证并将断点设置在实际代码位置。初始调用此工具时，此值可能为 `false`（表示请求已发送但尚未确认），在调试会话启动或运行时可能会更新为 `true`。AI 应主要关注 `id`，并通过后续的 `get_breakpoints` 或 `stop_event_data` 来确认 `verified` 状态。
            *   `source`: 包含断点所在文件信息的对象 (object)，至少有 `path` (string)。
            *   `line`: 请求设置断点的行号 (number)。
            *   `column`: 请求设置断点的列号 (number, optional)。
            *   `message`: (可选, string) 关于断点状态的附加信息，例如验证失败的原因。
            *   `timestamp`: **此断点信息生成时的 UTC 时间戳 (string, ISO 8601)**。
        *   *示例:*
            ```json
            {
              "status": "success",
              "breakpoint": {
                "id": 3,
                "verified": false,
                "source": { "path": "/home/user/project/src/utils.py" },
                "line": 42,
                "timestamp": "2025-04-16T03:30:15.123Z"
              }
            }
            ```
    *   **失败:**
        *   `status`: `"error"`
        *   `message`: 描述设置断点失败原因的字符串 (string)，例如 `"文件路径无效"`, `"调试适配器不支持条件断点"`。

---

**4.3 `remove_breakpoint` (移除断点)**

*   **目的:** 移除一个或多个之前设置的断点。
*   **类型:** 同步工具。
*   **输入参数 (三选一):**
    *   `breakpoint_id` (必需, number): 要移除的断点的唯一 ID (通过 `set_breakpoint` 或 `get_breakpoints` 获取)。这是最精确的方式。
    *   *或者* `location` (必需, object): 一个包含 `file_path` (string) 和 `line_number` (number) 的对象，用于指定要移除断点的位置。如果该位置有多个断点（例如，同一行的不同列），可能移除所有匹配的断点。
    *   *或者* `clear_all` (必需, boolean): 如果设置为 `true`，则尝试移除当前调试会话中所有已设置的断点。
*   **返回值:**
    *   **成功:**
        *   `status`: `"success"`
        *   *(可选)* `message`: (string) 可能包含移除操作的附加信息，例如 "已移除 ID 为 3 的断点" 或 "已清除所有断点"。
    *   **失败:**
        *   `status`: `"error"`
        *   `message`: 描述移除断点失败原因的字符串 (string)，例如 `"未找到 ID 为 99 的断点"`, `"指定位置没有断点"`。

---

**4.4 `get_breakpoints` (获取所有断点)**

*   **目的:** 获取当前调试会话中所有已设置（包括已验证和未验证）的断点列表。这对于 AI 了解当前的断点状态非常有用。
*   **类型:** 同步工具。
*   **输入参数:** 无。
*   **返回值:**
    *   **成功:**
        *   `status`: `"success"`
        *   `timestamp`: **此断点列表被检索时的 UTC 时间戳 (string, ISO 8601)**。AI 应使用此时间戳来判断这份列表的新鲜度。
        *   `breakpoints`: 一个断点对象 (object) 的列表 (list)。每个断点对象的结构与 `set_breakpoint` 成功时返回的 `breakpoint` 对象类似，包含 `id`, `verified`, `source`, `line`, `column` (可选), `condition` (可选), `hit_condition` (可选), `log_message` (可选) 等信息。**注意：** 列表中的单个断点对象**不**再重复包含时间戳，整个列表共享顶层的 `timestamp`。
        *   *示例:*
            ```json
            {
              "status": "success",
              "timestamp": "2025-04-16T03:35:02.987Z",
              "breakpoints": [
                {
                  "id": 1,
                  "verified": true,
                  "source": { "path": "/path/to/main.py" },
                  "line": 15
                },
                {
                  "id": 3,
                  "verified": true,
                  "source": { "path": "/path/to/utils.py" },
                  "line": 42,
                  "condition": "count > 10"
                },
                {
                  "id": 4,
                  "verified": false, // 可能文件还未加载或位置无效
                  "source": { "path": "/path/to/future_code.js" },
                  "line": 100
                }
              ]
            }
            ```
    *   **失败:**
        *   `status`: `"error"`
        *   `message`: 描述获取断点列表失败原因的字符串 (string)，例如 `"无法连接到调试适配器"`。

---

**4.5 `start_debugging` (启动调试)**

*   **目的:** 根据 `get_debugger_configurations` 获取到的配置名称，启动一个新的调试会话（对于 `request: "launch"`）或附加到一个已存在的进程（对于 `request: "attach"`）。启动后，此工具会**异步等待**，直到调试器首次暂停（例如命中入口断点、用户设置的断点、未捕获的异常）或程序执行完毕。
*   **类型:** 异步工具。
*   **输入参数:**
    *   `configuration_name` (必需, string): 要使用的 `launch.json` 中的配置 `name`。
    *   `no_debug` (可选, boolean): 如果设置为 `true`，则尝试以非调试模式启动程序（类似于 VS Code 中的 "Run Without Debugging" 或 Ctrl+F5）。在这种模式下，断点不会被命中，调试器相关的开销也较小。工具仍然会等待程序结束。默认为 `false`（即以调试模式启动）。
*   **返回值 (异步结果):**
    *   `status`: `"stopped"`, `stop_event_data`: (见 **5. Stop Event Data 结构 (带时间戳)**) - 调试会话成功启动，并且程序执行已在某个位置暂停。这是最常见的成功情况。
    *   `status`: `"completed"`, `message`: `"调试会话正常结束。"` (string) - 调试会话成功启动并运行，但程序在没有触发任何暂停事件的情况下就正常结束了（或者是在 `no_debug: true` 模式下运行结束）。
    *   `status`: `"error"`, `message`: 描述启动失败原因的字符串 (string)，例如 `"找不到名为 'XYZ' 的调试配置"`, `"启动调试器进程失败"`, `"附加到进程超时"`, `"编译错误导致无法启动"`。
    *   `status`: `"timeout"`, `message`: `"等待调试器首次停止超时。"` (string) - 启动操作已发出，但在规定的时间内没有收到调试器暂停或结束的事件。
    *   `status`: `"interrupted"`, `message`: `"用户手动中断了启动调试的等待。"` (string) - 在等待调试器首次停止期间，用户通过 Roocode 界面中断了等待。

---

**4.6 `continue_debugging` (继续)**

*   **目的:** 当调试器当前处于暂停状态时，命令其恢复执行。程序将继续运行，直到遇到下一个断点、发生未捕获的异常、程序自然结束，或者被其他方式再次暂停。
*   **类型:** 异步工具。
*   **输入参数:**
    *   `thread_id` (必需, number): 需要恢复执行的线程的 ID。这个 ID 通常从上一次 `status: "stopped"` 返回的 `stop_event_data.thread_id` 中获取。对于单线程应用，可能只有一个线程 ID；对于多线程应用，需要指定要操作的线程。
*   **返回值 (异步结果):**
    *   `status`: `"stopped"`, `stop_event_data`: (见 **5. Stop Event Data 结构 (带时间戳)**) - 程序继续执行后，在另一个位置再次暂停。
    *   `status`: `"completed"`, `message`: `"调试会话正常结束。"` (string) - 程序继续执行后，没有再遇到暂停事件就正常结束了。
    *   `status`: `"error"`, `message`: 描述继续执行失败原因的字符串 (string)，例如 `"无效的线程 ID"`, `"无法恢复执行"`。
    *   `status`: `"timeout"`, `message`: `"等待调试器再次停止或结束超时。"` (string) - 发出了继续命令，但在规定时间内没有收到调试器再次暂停或结束的事件。
    *   `status`: `"interrupted"`, `message`: `"用户手动中断了继续执行的等待。"` (string) - 在等待期间，用户中断了操作。

---

**4.7 `step_execution` (执行单步)**

*   **目的:** 当调试器当前处于暂停状态时，执行一次精细控制的单步操作。根据指定的类型（步过、步入、步出），执行一小段代码后再次暂停。
*   **类型:** 异步工具。
*   **输入参数:**
    *   `thread_id` (必需, number): 需要执行单步操作的线程的 ID (从 `stop_event_data.thread_id` 获取)。
    *   `step_type` (必需, string): 指定单步执行的具体类型。必须是以下三个值之一：
        *   `"over"`: **步过 (Step Over)**。执行当前行代码。如果当前行包含函数调用，则执行整个函数调用，然后暂停在源代码中的下一行（同一函数内或调用者函数中）。
        *   `"into"`: **步入 (Step Into)**。如果当前行包含函数调用，则进入该函数内部，并暂停在被调用函数的第一个可执行语句上。如果当前行不包含函数调用，则行为类似于步过。
        *   `"out"`: **步出 (Step Out)**。继续执行当前函数的剩余部分，直到函数返回。然后暂停在调用该函数的语句之后的那一行代码上。
*   **返回值 (异步结果):**
    *   `status`: `"stopped"`, `stop_event_data`: (见 **5. Stop Event Data 结构 (带时间戳)**) - 单步操作成功完成，调试器已在新的位置暂停。这是单步操作最典型的成功结果。
    *   `status`: `"completed"`, `message`: `"调试会话在单步执行后正常结束。"` (string) - 单步操作（例如步过最后一行代码或步出最后一个函数）导致了程序的正常结束。
    *   `status`: `"error"`, `message`: 描述单步执行失败原因的字符串 (string)，例如 `"无效的线程 ID"`, `"当前状态无法执行步入操作"`。
    *   `status`: `"timeout"`, `message`: `"等待调试器在单步执行后停止超时。"` (string) - 发出了单步命令，但在规定时间内没有收到调试器再次暂停或结束的事件。
    *   `status`: `"interrupted"`, `message`: `"用户手动中断了单步执行的等待。"` (string) - 在等待期间，用户中断了操作。

---

**4.8 `get_scopes` (获取作用域)**

*   **目的:** 当调试器处于暂停状态时，获取指定堆栈帧（Stack Frame）内可用的变量作用域列表。作用域通常包括 "Locals" (局部变量)、"Globals" (全局变量)、"Closure" (闭包变量) 等，具体取决于编程语言和调试器。获取作用域是进一步获取变量值的第一步。
*   **类型:** 同步工具。
*   **输入参数:**
    *   `frame_id` (必需, number): 目标堆栈帧的唯一 ID。这个 ID 从 `stop_event_data.call_stack` 列表中获取，通常 AI 会对调用栈顶部的帧（即当前暂停点所在的函数）感兴趣。
*   **返回值:**
    *   **成功:**
        *   `status`: `"success"`
        *   `scopes`: 一个作用域对象 (object) 的列表 (list)。每个作用域对象包含:
            *   `name`: 作用域的名称 (string)，例如 `"Local"`, `"Globals"`, `"Arguments"`, `"Registers"`。
            *   `variables_reference`: 一个大于 0 的数字 (number)。这是获取该作用域下具体变量列表的关键句柄，将作为 `get_variables` 工具的输入参数。如果 `variables_reference` 为 0，表示该作用域为空或不可展开。
            *   `expensive`: 一个布尔值 (boolean)，提示获取此作用域下的变量可能是一个耗时操作。AI 可以据此决定是否自动展开。
            *   *(可选)* `named_variables`: (number) 该作用域中命名变量的数量（估计值）。
            *   *(可选)* `indexed_variables`: (number) 该作用域中索引变量（如数组元素）的数量（估计值）。
    *   **失败:**
        *   `status`: `"error"`
        *   `message`: 描述获取作用域失败原因的字符串 (string)，例如 `"无效的堆栈帧 ID"`, `"调试器未暂停"`。

---

**4.9 `get_variables` (获取变量)**

*   **目的:** 获取由 `variables_reference` 标识的作用域或可展开变量（例如对象、数组）下的具体变量列表及其值。
*   **类型:** 同步工具。
*   **输入参数:**
    *   `variables_reference` (必需, number): 要查询的变量容器的引用 ID。这个 ID 来自 `get_scopes` 返回的作用域对象，或者来自上一次 `get_variables` 调用返回的可展开变量对象（其 `variables_reference` > 0）。
*   **返回值:**
    *   **成功:**
        *   `status`: `"success"`
        *   `variables`: 一个变量对象 (object) 的列表 (list)。每个变量对象描述一个变量，包含:
            *   `name`: 变量的名称 (string)。
            *   `value`: 变量当前值的字符串表示 (string)。对于复杂类型（如对象、数组），这通常是一个摘要或类型名，例如 `"Object"`, `"Array[5]"`。
            *   `type`: 变量的数据类型 (string, optional)，例如 `"string"`, `"number"`, `"boolean"`, `"MyClass"`。
            *   `variables_reference`: 一个数字 (number)。如果这个变量本身是可展开的（例如它是一个对象、数组或集合），则此值大于 0，可以作为下一次调用 `get_variables` 的输入，以获取其内部成员或元素。如果此值为 0，表示该变量是原子类型或不可展开。
            *   *(可选)* `evaluate_name`: (string) 如果需要通过 `evaluate_expression` 来获取此变量的更精确值或执行操作，可以使用这个名称。
            *   *(可选)* `memory_reference`: (string) 指向该变量内存地址的引用，可用于内存检查等高级功能（如果调试器支持）。
    *   **失败:**
        *   `status`: `"error"`
        *   `message`: 描述获取变量失败原因的字符串 (string)，例如 `"无效的 variables_reference"`, `"无法访问变量值"`。

---

**4.10 `evaluate_expression` (求值表达式)**

*   **目的:** 在调试器暂停时，于指定的堆栈帧上下文中计算一个任意的表达式，并返回其结果。这对于检查变量的属性、调用简单函数或执行临时计算非常有用。
*   **类型:** 同步工具。
*   **输入参数:**
    *   `expression` (必需, string): 要计算的表达式字符串。表达式的语法必须符合被调试代码的语言规范。
    *   `frame_id` (必需, number): 指定在哪个堆栈帧的上下文中执行此表达式。这决定了表达式中可访问的局部变量等。ID 从 `stop_event_data.call_stack` 获取。
    *   `context` (可选, string): 提供表达式求值的上下文信息。常见值包括：
        *   `"watch"`: 用于监视窗口中的表达式求值。
        *   `"repl"`: 用于调试控制台（REPL）中的求值。
        *   `"hover"`: 用于鼠标悬停提示中的求值。
        *   `"clipboard"`: 用于将结果复制到剪贴板的场景。
        此参数可能影响结果的格式或某些副作用（如赋值）是否被允许。如果省略，通常默认为 `"watch"` 或 `"repl"`。
*   **返回值:**
    *   **成功:**
        *   `status`: `"success"`
        *   `result`: 表达式计算结果的字符串表示 (string)。
        *   `type`: (可选, string) 结果的数据类型。
        *   `variables_reference`: 一个数字 (number)。如果表达式的结果是一个可展开的对象或数组，则此值大于 0，可以用于后续的 `get_variables` 调用。否则为 0。
    *   **失败:**
        *   `status`: `"error"`
        *   `message`: 描述求值失败原因的字符串 (string)，例如 `"表达式语法错误"`, `"变量 'x' 未定义"`, `"无法在当前上下文求值"`, `"表达式有副作用，在当前上下文不允许"`。

---

**4.11 `stop_debugging` (停止调试)**

*   **目的:** 强制终止当前正在运行或暂停的调试会话。这会尝试结束被调试的进程（对于 launch 模式）或从进程分离（对于 attach 模式）。
*   **类型:** 同步工具 (命令发出后 Roocode 立即返回，不保证等待进程完全退出或分离完成)。
*   **输入参数:** 无。
*   **返回值:**
    *   **成功:**
        *   `status`: `"success"`
        *   `message`: `"已发送停止调试会话的请求。"` (string)。这表示停止命令已成功发出，但不保证调试会话状态立即变为 `Terminated`。AI 可能需要通过后续的心跳或状态检查来确认会话确实结束。
    *   **失败:**
        *   `status`: `"error"`
        *   `message`: 描述停止失败原因的字符串 (string)，例如 `"当前没有活动的调试会话可停止"`。

---

**5. Stop Event Data 结构 (带时间戳和顶层变量)**

当异步工具 (`start_debugging`, `continue_debugging`, `step_execution`) 返回 `status: "stopped"` 时，其返回值中必须包含一个名为 `stop_event_data` 的对象。该对象提供了关于调试器为何暂停以及在何处暂停的详细信息，**并包含当前暂停点（顶层堆栈帧）的局部变量快照**，以方便 AI 快速获取上下文。其结构如下：

```json
{
  "timestamp": string, // **必需**: 调试器停止并捕获此状态快照时的 UTC 时间戳 (ISO 8601 格式)。
  "reason": string, // **必需**: 导致调试器暂停的原因 (e.g., "breakpoint", "exception", "step")。
  "thread_id": number, // **必需**: 触发暂停事件的线程的唯一 ID。
  "description": string | null, // (可选): 对暂停原因的文本描述。
  "text": string | null, // (可选): 异常信息 (如果 reason 是 'exception')。
  "all_threads_stopped": boolean | null, // (可选): 是否所有线程都已暂停。

  // --- 暂停位置的详细信息 ---
  "source": { // (可选)
    "path": string, // 暂停点所在源代码文件的完整路径。
    "name": string // 源代码文件的基本名称。
  } | null,
  "line": number | null, // (可选) 暂停点所在的行号 (基于 1)。
  "column": number | null, // (可选) 暂停点所在的列号 (基于 1)。

  // --- 调用栈信息 ---
  "call_stack": [ // **必需**: 当前线程调用栈列表。
    {
      "frame_id": number, // **必需**: 堆栈帧 ID。
      "function_name": string, // **必需**: 函数名。
      "file_path": string, // **必需**: 文件路径。
      "line_number": number, // **必需**: 行号。
      "column_number": number // **必需**: 列号。
    },
    // ... more frames
  ],

  // --- 顶层帧变量快照 ---
  "top_frame_variables": { // **新增**: (可选) 包含顶层堆栈帧 (call_stack[0]) 的主要作用域 (通常是 'Locals') 的顶层变量信息。如果获取失败或无变量，可能为 null。
    "scope_name": string, // (例如 "Locals", "Local") 标识这些变量来自哪个作用域。
    "variables": [ // 一个变量对象列表，结构同 get_variables 返回的列表项。
      {
        "name": string, // 变量名
        "value": string, // 变量值的字符串表示
        "type": string | null, // 变量类型
        "variables_reference": number // >0 表示可展开，用于后续 get_variables 调用
        // (可选) evaluate_name, memory_reference 等
      },
      // ... more variables in this scope
    ]
  } | null,

  // --- 命中断点信息 ---
  "hit_breakpoint_ids": [ number, ... ] | null // (可选): 如果 reason 是 'breakpoint'，包含命中断点的 ID 列表。
}
```
*示例 (更新后):*
```json
{
  "status": "stopped",
  "stop_event_data": {
    "timestamp": "2025-04-16T03:55:45.123Z",
    "reason": "breakpoint",
    "thread_id": 1,
    "description": "Paused on breakpoint",
    "text": null,
    "all_threads_stopped": true,
    "source": { "path": "/path/to/main.py", "name": "main.py" },
    "line": 15,
    "column": 4,
    "call_stack": [
      { "frame_id": 1001, "function_name": "my_function", "file_path": "/path/to/main.py", "line_number": 15, "column_number": 4 },
      { "frame_id": 1000, "function_name": "<module>", "file_path": "/path/to/main.py", "line_number": 25, "column_number": 1 }
    ],
    "top_frame_variables": { // 新增部分
      "scope_name": "Locals",
      "variables": [
        { "name": "count", "value": "10", "type": "int", "variables_reference": 0 },
        { "name": "data", "value": "list[3]", "type": "list", "variables_reference": 1002 }, // 可展开
        { "name": "config", "value": "dict{...}", "type": "dict", "variables_reference": 1003 } // 可展开
      ]
    },
    "hit_breakpoint_ids": [ 1 ]
  }
}
```

**6. 一般注意事项与要求**

*   **错误处理:** AI 代理必须能够健壮地处理所有工具可能返回的 `status: "error"` 情况。应检查 `message` 字段以理解错误原因，并据此决定下一步行动（例如：通知用户、尝试修正输入参数后重试、放弃当前调试路径、调用其他工具获取更多信息）。
*   **状态管理:** AI 代理的核心职责之一是维护一个关于当前调试会话状态的内部模型。这个模型需要根据每次工具调用的返回值（特别是 `status`、`timestamp` 和 `stop_event_data`）进行持续更新。**必须优先使用时间戳最新的信息来更新状态。**
*   **异步工具处理:** AI 必须完全理解异步工具的多种可能的返回状态 (`stopped`, `completed`, `timeout`, `interrupted`, `error`)，并为每种情况设计合理的响应逻辑。例如，收到 `stopped` 后通常会调用 `get_scopes`/`get_variables` 来检查状态，然后决定是 `continue` 还是 `step`；收到 `completed` 表示调试结束；收到 `timeout` 或 `interrupted` 可能需要通知用户或调整策略。
*   **用户交互:** Roocode 框架负责处理异步工具等待期间的用户中断请求，并确保在这种情况下工具能返回明确的 `status: "interrupted"`。AI 需要能处理此状态。
*   **超时:** 所有异步工具都应有一个合理的默认超时时间（例如 30 秒或 60 秒）。理想情况下，Roocode 框架或工具调用本身应允许 AI 指定一个自定义的超时时间。超时后必须返回 `status: "timeout"`。
*   **线程处理:** 设计必须支持多线程调试。所有需要针对特定执行流进行的操作（`continue`, `step`, `get_scopes`, `evaluate`）都要求提供 `thread_id`。AI 需要从最新的 `stop_event_data` 中获取当前暂停的 `thread_id`，并可能需要处理 `all_threads_stopped` 标志以及潜在的其他线程状态（如果 Roocode 框架支持获取所有线程信息）。
*   **时间戳使用:** AI 在处理 `get_breakpoints` 和 `stop_event_data` 的结果时，应始终检查并记录 `timestamp`。在比较来自不同时间点的信息时（例如，比较旧的 `stop_event_data` 和新的 `get_breakpoints` 结果），应以时间戳较晚的信息为准来判断当前状态。

---
### 当前任务
