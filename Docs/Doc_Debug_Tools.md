# 调试工具开发文档

本文档详细描述了 VsCode Debugger 工具组的规格和实现细节，该工具组旨在使 AI 代理能够通过结构化的工具与 Visual Studio Code (VS Code) 的调试功能进行交互。

## 1. 概述

该工具组的核心目标是自动化调试任务，包括控制代码执行、设置断点、检查变量和遍历调用栈。

**核心原则:**

*   **VS Code 调试能力映射:** 工具功能紧密围绕 VS Code 标准调试能力，底层实现利用或封装 VS Code Debug Adapter Protocol (DAP)。
*   **状态驱动交互:** AI 代理根据工具返回信息（`status` 字段和数据负载）理解和维护调试会话状态。
*   **清晰明确的接口:** 每个工具都有严格定义的接口、输入参数和返回值结构。
*   **信息时效性:** 关键信息（如断点列表、停止状态）包含时间戳，帮助 AI 区分信息的新鲜度。

## 2. 核心概念

*   **工作范式:**
    *   **同步工具:** 调用后立即执行并返回结果。
    *   **异步工具:** 调用后启动操作并等待特定事件发生后返回结果。
*   **VS Code Debug Adapter Protocol (DAP):** 工具设计理念和术语源自 DAP。
*   **调试会话状态:** AI 需根据工具返回值推断会话状态 (`Idle`, `Starting`, `Running`, `Stopped`, `Terminating`, `Terminated`)。
*   **时间戳 (Timestamp):** 采用 ISO 8601 格式的 UTC 时间字符串，用于标记信息生成时刻。

## 3. 通用返回结构

所有工具返回值包含 `status` 字段：

*   `"success"`: (同步工具) 操作成功。
*   `"error"`: 操作失败，包含 `message` 字段。
*   `"stopped"`: (异步工具) 操作成功，调试器暂停，包含 `stop_event_data`。
*   `"completed"`: (异步工具) 操作成功，会话正常结束。
*   `"timeout"`: (异步工具) 操作超时，包含 `message` 字段。

## 4. 工具规格详述

### 4.1 `get_debugger_configurations` (获取调试器配置)

*   **目的:** 读取 `.vscode/launch.json` 中的调试配置。
*   **类型:** 同步工具。
*   **输入参数:** 无。
*   **返回值:** 成功时返回 `status: "success"` 和 `configurations` 列表，包含每个配置的 `name`, `type`, `request` 等信息。失败时返回 `status: "error"` 和 `message`。

### 4.2 `set_breakpoint` (设置断点)

*   **目的:** 在指定位置设置断点（常规、条件、命中次数、日志点）。
*   **类型:** 同步工具。
*   **输入参数:** `file_path` (必需), `line_number` (必需), `column_number` (可选), `condition` (可选), `hit_condition` (可选), `log_message` (可选)。
*   **返回值:** 成功时返回 `status: "success"` 和 `breakpoint` 对象，包含 `id`, `verified`, `source`, `line`, `timestamp` 等信息。失败时返回 `status: "error"` 和 `message`。

### 4.3 `remove_breakpoint` (移除断点)

*   **目的:** 移除一个或多个断点。
*   **类型:** 同步工具。
*   **输入参数:** `breakpoint_id` (可选), `location` (可选), `clear_all` (可选)。三选一。
*   **返回值:** 成功时返回 `status: "success"`。失败时返回 `status: "error"` 和 `message`。

### 4.4 `get_breakpoints` (获取所有断点)

*   **目的:** 获取当前调试会话中所有已设置的断点列表。
*   **类型:** 同步工具。
*   **输入参数:** 无。
*   **返回值:** 成功时返回 `status: "success"`, `timestamp` 和 `breakpoints` 列表。失败时返回 `status: "error"` 和 `message`。

### 4.5 `start_debugging` (启动调试)

*   **目的:** 根据配置名称启动新的调试会话或附加到进程，并异步等待首次暂停或结束。
*   **类型:** 异步工具。
*   **输入参数:** `configuration_name` (必需), `no_debug` (可选)。
*   **返回值 (异步结果):**
    *   `"stopped"`: 成功启动并在某处暂停，包含 `stop_event_data`。
    *   `"completed"`: 成功启动并正常结束。
    *   `"error"`: 启动失败，包含 `message`。
    *   `"timeout"`: 等待首次停止超时，包含 `message`。
    *   `"interrupted"`: 用户手动中断等待，包含 `message`。
### 4.6 `continue_debugging` (继续)

*   **目的:** 当调试器当前处于暂停状态时，命令其恢复执行。程序将继续运行，直到遇到下一个断点、发生未捕获的异常、程序自然结束，或者被其他方式再次暂停。
*   **类型:** 异步工具。
*   **输入参数:**
    *   `session_id` (可选, string): 目标调试会话的唯一 ID。如果省略，工具将自动尝试使用当前活动的调试会话。如果提供了此 ID，则必须是从之前的 `start_debugging` 工具调用成功后的响应，或任何返回 `status: "stopped"` 的工具响应中的 `stop_event_data.session_id` 获取。
    *   `thread_id` (必需, number): 需要恢复执行的线程的 ID。这个 ID 通常从上一次 `status: "stopped"` 返回的 `stop_event_data.thread_id` 中获取。
*   **返回值 (异步结果):**
    *   `status`: `"stopped"`, `stop_event_data`: (见 **5. Stop Event Data 结构**) - 程序继续执行后，在另一个位置再次暂停。`stop_event_data` 中将包含新的暂停信息，包括 `session_id`。
    *   `status`: `"completed"`, `message`: `"调试会话正常结束。"` (string) - 程序继续执行后，没有再遇到暂停事件就正常结束了。
    *   `status`: `"error"`, `message`: 描述继续执行失败原因的字符串 (string)，例如 `"无效的会话 ID 或线程 ID"`, `"无法恢复执行"`。
    *   `status`: `"timeout"`, `message`: `"等待调试器再次停止或结束超时。"` (string) - 发出了继续命令，但在规定时间内没有收到调试器再次暂停或结束的事件。
    *   `status`: `"interrupted"`, `message`: `"用户手动中断了继续执行的等待。"` (string) - 在等待期间，用户中断了操作。

### 4.7 `step_execution` (执行单步)

*   **目的:** 当调试器当前处于暂停状态时，命令其执行一次精细控制的单步操作。根据指定的类型（步过、步入、步出），执行一小段代码后再次暂停。
*   **类型:** 异步工具。
*   **输入参数:**
    *   `session_id` (可选, string): 目标调试会话的唯一 ID。如果省略，工具将自动尝试使用当前活动的调试会话。如果提供了此 ID，则必须是从之前的 `start_debugging` 工具调用成功后的响应，或任何返回 `status: "stopped"` 的工具响应中的 `stop_event_data.session_id` 获取。
    *   `thread_id` (必需, number): 需要执行单步操作的线程的 ID。这个 ID 通常从上一次 `status: "stopped"` 返回的 `stop_event_data.thread_id` 中获取。
    *   `step_type` (必需, string): 指定单步执行的具体类型。必须是以下三个值之一：
        *   `"over"`: **步过 (Step Over)**...
        *   `"into"`: **步入 (Step Into)**。如果当前行包含函数调用，则进入该函数内部，并暂停在被调用函数的第一个可执行语句上。如果当前行不包含函数调用，则行为类似于步过。
        *   `"out"`: **步出 (Step Out)**。继续执行当前函数的剩余部分，直到函数返回。然后暂停在调用该函数的语句之后的那一行代码上。
*   **返回值 (异步结果):**
    *   `status`: `"stopped"`, `stop_event_data`: (见 **5. Stop Event Data 结构 (带时间戳和顶层变量)**) - 单步操作成功完成，调试器已在新的位置暂停。这是单步操作最典型的成功结果。
    *   `status`: `"completed"`, `message`: `"调试会话在单步执行后正常结束。"` (string) - 单步操作（例如步过最后一行代码或步出最后一个函数）导致了程序的正常结束。
    *   `status`: `"error"`, `message`: 描述单步执行失败原因的字符串 (string)，例如 `"无效的线程 ID"`, `"当前状态无法执行步入操作"`。
    *   `status`: `"timeout"`, `message`: `"等待调试器在单步执行后停止超时。"` (string) - 发出了单步命令，但在规定时间内没有收到调试器再次暂停或结束的事件。
    *   `status`: `"interrupted"`, `message`: `"用户手动中断了单步执行的等待。"` (string) - 在等待期间，用户中断了操作。

---
### 4.8 `get_scopes` (获取作用域)

*   **目的:** 调试器暂停时，获取指定堆栈帧内可用的变量作用域列表。
*   **类型:** 同步工具。
*   **输入参数:** `frame_id` (必需)。
*   **返回值:** 成功时返回 `status: "success"` 和 `scopes` 列表，包含 `name`, `variables_reference` 等信息。失败时返回 `status: "error"` 和 `message`。

### 4.9 `get_variables` (获取变量)

*   **目的:** 获取由 `variables_reference` 标识的作用域或可展开变量下的具体变量列表及其值。
*   **类型:** 同步工具。
*   **输入参数:** `variables_reference` (必需)。
*   **返回值:** 成功时返回 `status: "success"` 和 `variables` 列表，包含 `name`, `value`, `type`, `variables_reference` 等信息。失败时返回 `status: "error"` 和 `message`。

### 4.10 `evaluate_expression` (求值表达式)

*   **目的:** 调试器暂停时，于指定堆栈帧上下文中计算表达式并返回结果。
*   **类型:** 同步工具。
*   **输入参数:** `expression` (必需), `frame_id` (必需), `context` (可选)。
*   **返回值:** 成功时返回 `status: "success"`, `result`, `type` (可选), `variables_reference`。失败时返回 `status: "error"` 和 `message`。

### 4.11 `stop_debugging` (停止调试)

*   **目的:** 强制终止当前调试会话。
*   **类型:** 同步工具。
*   **输入参数:** 无。
*   **返回值:** 成功时返回 `status: "success"` 和 `message`。失败时返回 `status: "error"` 和 `message`。

## 5. Stop Event Data 结构 (带时间戳和顶层变量)

当异步工具返回 `status: "stopped"` 时，包含 `stop_event_data` 对象，提供暂停详细信息：

```json
{
  "timestamp": string, // UTC 时间戳
  "reason": string, // 暂停原因
  "thread_id": number, // 线程 ID
  "description": string | null, // 描述
  "text": string | null, // 异常信息
  "all_threads_stopped": boolean | null, // 所有线程是否暂停

  "source": { // 暂停位置
    "path": string,
    "name": string
  } | null,
  "line": number | null,
  "column": number | null,

  "call_stack": [ // 调用栈
    {
      "frame_id": number,
      "function_name": string,
      "file_path": string,
      "line_number": number,
      "column_number": number
    },
    // ...
  ],

  "top_frame_variables": { // 顶层帧变量快照
    "scope_name": string,
    "variables": [
      {
        "name": string,
        "value": string,
        "type": string | null,
        "variables_reference": number
      },
      // ...
    ]
  } | null,

  "hit_breakpoint_ids": [ number, ... ] | null // 命中断点 ID 列表
}
```

## 6. 一般注意事项与要求

*   **错误处理:** 健壮处理 `status: "error"`。
*   **状态管理:** 维护调试会话状态的内部模型，优先使用时间戳最新的信息。
*   **异步工具处理:** 理解并处理异步工具的多种返回状态。
*   **超时:** 异步工具应有合理默认超时时间。
*   **线程处理:** 设计支持多线程调试，操作需提供 `thread_id`。
*   **时间戳使用:** 处理结果时检查并记录 `timestamp`，以时间戳较晚的信息为准。