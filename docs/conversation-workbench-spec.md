# 会话工作台（Steps / Progress / Artifacts）Spec

> Turn 实时运行态、Plan 终态和重连恢复以
> [turn-lifecycle-runtime-spec.md](turn-lifecycle-runtime-spec.md) 为权威规范。

## 背景

长任务执行期间，用户需要同时知道：

1. Agent 当前准备做什么。
2. 已经调用了哪些工具，结果是否成功。
3. 整体计划进行到哪一步。
4. 本轮产生了哪些可交付文件。
5. 哪一段才是 Agent 的最终回答。

旧版会话把模型普通文本、模型 reasoning、工具提示和最终回答投影到同一条消息流中。
当模型在工具调用前输出类似“接下来读取更详细的市场数据”的说明时，GUI 可能把它当作
最终正文。右侧面板也只有用户打开某个文件后才出现，缺少持续可见的任务状态和产物入口。

本 Spec 将会话展示拆成三个互不混淆的层次：

```text
私有推理 reasoning
    └─ 不进入回答正文，只显示安全的“正在分析”状态

公开行动说明 narration
    └─ 与工具调用一起进入可折叠 Steps

最终回答 final answer
    └─ 作为普通 assistant 正文展示
```

右侧会话工作台持续展示：

```text
Progress
  ● 获取市场数据
  ● 分析板块表现
  ○ 整理资金流向
  ○ 生成报告

Artifacts
  A股周报.docx
  市场数据.xlsx
  板块涨跌.png
```

## 目标

1. 模型在工具调用前产生的公开说明必须显示在 Steps 内，不得冒充最终回答。
2. `reasoning_delta` 与 narration、final answer 保持协议级隔离。
3. 多步骤任务通过结构化 `task_progress` 驱动 Progress，不由 GUI 猜测执行计划。
4. 工具调用显示为简洁、面向用户的动作描述。
5. 当前会话始终可以打开右侧工作台，无需先点击文件。
6. Artifacts 由 nanobot gateway 按当前会话的 workspace scope 提供，GUI 不扫描本地目录。
7. 点击 Artifact 复用现有 PDF、DOCX、XLSX、图片、文本等预览能力。
8. 历史会话重放后仍能恢复 Steps、Progress 和 Artifacts。
9. 新旧 GUI/gateway 可以在升级期间互相兼容。

## 非目标

1. 不重新引入 GUI 本地 Agent、tool registry 或任务调度器。
2. 不在 GUI 中读取任意文件系统路径。
3. 不展示模型原始私有思维链。
4. 不把 Artifacts 做成独立云存储或版本管理系统。
5. 不改变 nanobot session history 作为会话事实来源的地位。
6. 不要求所有短问题都创建计划；简单问答保持普通聊天体验。

## 术语

- **reasoning**：模型供应商返回的 reasoning/thinking 内容，仅用于受控的分析状态展示。
- **narration**：Agent 主动提供给用户的简短、公开行动说明，例如“接下来核对三家来源的数据”。
- **step**：一次 narration、工具调用、文件编辑或计划更新在时间线中的一项用户可见动作。
- **progress**：由 `update_task_progress` 发布的结构化任务阶段。
- **artifact**：当前会话工作区中由任务产生或更新、可以安全预览的文件。
- **final answer**：本轮不再继续调用工具时产生的最终 assistant 文本。

## 产品行为

### 聊天正文

聊天主区域只展示：

- 用户消息；
- 一个可展开/折叠的执行组，例如“进行中 12s · 12 steps”或“已完成 48s · 22 steps”；
- 最终 assistant 回答；
- 需要用户立即处理的提问或审批组件。

执行组内按实际发生顺序展示：

- narration；
- 计划更新；
- 搜索、网页读取、Shell、MCP、文件等工具动作；
- 文件创建或修改；
- 工具失败和重试状态。

任务运行时执行组默认展开；`turn_end` 后默认折叠，但保留用户手动展开状态。

### Narration

Narration 应满足：

- 一次工具批次前最多一条；
- 一至两句，使用用户当前语言；
- 只解释即将执行的动作和目的；
- 不包含系统提示、内部决策规则、私有 reasoning 或敏感本地路径；
- 不代替最终回答。

确定性分类规则：

```text
模型响应包含 tool_calls 且 content 非空
    => content 是 narration

模型响应不再执行 tool_calls 且 content 非空
    => content 是 final answer
```

GUI 不应仅靠文本位置猜测类型。gateway 必须发送明确事件。

### Progress

预计调用工具的任务必须把 `update_task_progress` 作为第一批中的首个工具调用：

- 2 至 4 个用户能理解的目标或交付物阶段；
- 保持稳定的 step id；
- 非终态快照恰好一个 `running`，全终态快照不含 `running`；
- 阶段变化时发送新的完整快照；
- 禁止把搜索、读取、命令、写文件或具体工具名作为阶段标题；
- 最终回答前发送全部为 `completed` / `error` 的快照；
- `note` 是公开进度说明，不得包含私有 reasoning。

右侧 Progress 展示最新快照。聊天 Steps 保留关键历史快照，便于理解计划何时更新。

如果模型没有发布结构化计划：

- Steps 仍展示 narration 和工具动作；
- Progress 保持“正在制定任务计划”或空状态；
- GUI 不把工具调用投影为 Progress，也不从工具名称伪造业务阶段；
- gateway 不发送按工具类别自动合成的 `task_progress`；预计调用工具的任务必须由 Agent
  通过 `update_task_progress` 发布面向用户目标的真实计划。

### Artifacts

右侧 Artifacts 展示当前会话 workspace scope 内的安全文件列表：

- 文件名；
- 类型；
- 大小；
- 最后修改时间；
- 相对工作区路径。

默认按 `modified_at` 降序，首版最多返回 100 项。以下内容不进入列表：

- workspace scope 之外的路径；
- 目录、socket、设备文件；
- `.git`、依赖缓存、构建缓存和隐藏的运行时目录；
- 超过服务端安全上限或不支持预览的内部文件；
- nanobot 配置、密钥、session 内部状态文件。

Artifact 读取和 reveal 必须重新执行路径 containment 校验，不能信任列表返回后的客户端 path。

### 右侧工作台

Chat 模式存在当前会话时，右侧工作台可以显示：

1. `Progress`：最新结构化任务进度。
2. `Artifacts`：会话产物列表。
3. Artifact 预览：点击文件后替换工作台内容，返回后恢复 Progress/Artifacts。

当没有 Progress/Artifacts 时，工作台使用紧凑空状态，不应强制占用过多聊天宽度。
窄窗口可以自动收起为图标入口；用户打开 Artifact 后仍可使用现有全屏预览。

桌面布局与 OpenWorker 保持一致：

- 主窗口默认 `1360 × 900`，最小 `980 × 640`；
- 工作台列表宽度为 `332px`；
- Artifact 阅读栏宽度为 `min(62vw, 960px)`，不遮住聊天；
- 打开 Artifact 时临时收起左侧导航，关闭预览后恢复原状态；
- 阅读栏顶部使用返回箭头和 `Artifacts / 文件名` breadcrumb；
- 工具栏提供 HTML 刷新、默认应用打开、复制完整路径、在文件夹中显示、下载和全屏；
- PDF 以连续多页方式阅读，图片使用棋盘背景，表格、文档、Markdown、HTML 和代码使用
  对应的内嵌 renderer。

## WebSocket 协议

### Provisional stream 与 narration commit

流式生成开始时，gateway 尚不知道本次模型响应最终是否包含工具调用。因此不得为了分类
而延迟所有回答，也不得在第一个 token 到达时猜测它是 narration。

兼容方案：

1. 模型文本仍通过现有 `delta` 实时到达，GUI 将其视作当前未提交的 provisional stream。
2. 模型响应结束且确认后面存在工具调用时，`stream_end` 携带
   `resuming: true` 和 `stream_kind: "narration"`。
3. gateway 随后发送 narration commit 事件；新 GUI 将同一 `stream_id` 的 provisional
   文本从正文移入 Steps。
4. 没有工具调用时，`stream_end` 携带 `resuming: false` 和
   `stream_kind: "answer"`，provisional stream 原地提交为最终回答。

这使最终回答仍保持逐 token 流式体验，同时分类结果由后端事实决定。

### `narration_delta`

工具调用得到确认后，gateway 发送经过清洗的公开行动说明。首版允许一次性发送完整文本，
字段名保留 `delta` 是为了以后支持 provider 能提前确定工具调用时的真正流式 narration：

```json
{
  "event": "narration_delta",
  "chat_id": "conversation-id",
  "stream_id": "stream-id",
  "replaces_stream_id": "stream-id",
  "text": "接下来核对几篇来源中的市场数据。"
}
```

规则：

- `text` 可以是一个完整 narration，也可以是增量片段；
- 只允许公开 narration；
- 同一 `stream_id` 的片段按收到顺序拼接；
- `replaces_stream_id` 指示 GUI 移除或重分类对应 provisional assistant；
- narration 开始时关闭当前 reasoning 段；
- narration 不写入最终回答正文。

### `narration_end`

```json
{
  "event": "narration_end",
  "chat_id": "conversation-id",
  "stream_id": "stream-id",
  "replaces_stream_id": "stream-id"
}
```

收到后 GUI 关闭当前 narration 流，并把它保留在当前执行组中。

### `reasoning_delta` / `reasoning_end`

沿用现有协议。reasoning 与 narration 使用不同状态槽：

- reasoning 不得写入 narration 文本；
- GUI 默认只显示安全的“整理思路/正在分析”状态；
- 原始 reasoning 不进入普通 `MessageBubble`；
- provider 把 `<think>` 或 reasoning 错放入 `content` 时，后端必须先清洗再分类。

### `delta` / `stream_end`

`delta` 是 provisional 文本流；最终分类在 `stream_end` 时确定：

```json
{
  "event": "stream_end",
  "chat_id": "conversation-id",
  "stream_id": "stream-id",
  "resuming": true,
  "stream_kind": "narration"
}
```

- `resuming: true` 表示 Agent 将继续执行工具或下一轮模型调用；
- `stream_kind: "narration"` 表示对应文本不是最终回答；
- `stream_kind: "answer"` 表示普通回答片段；最终片段同时带 `resuming: false`；
- 未设置这两个字段的旧事件按既有最终回答行为处理。

兼容期内：

- 旧 gateway 仍可能将 narration 作为 `delta` 发送；
- GUI 保持旧事件解析能力；
- 新行为以 `stream_end` 分类和明确的 `narration_*` commit 为准，不对普通文本做
  激进启发式重分类。

### `message` + `agent_ui`

结构化 Progress 沿用：

```json
{
  "event": "message",
  "kind": "progress",
  "text": "",
  "agent_ui": {
    "kind": "task_progress",
    "steps": [
      {"id": "research", "title": "收集市场数据", "status": "completed"},
      {"id": "analysis", "title": "分析板块表现", "status": "running"},
      {"id": "report", "title": "生成报告", "status": "pending"}
    ],
    "current_step_id": "analysis",
    "note": "基础行情已核对，开始比较行业表现。"
  }
}
```

### `artifact_created`

文件工具成功产生可预览文件时，gateway 可以发送增量事件：

```json
{
  "event": "artifact_created",
  "chat_id": "conversation-id",
  "artifact": {
    "path": "reports/A股周报.docx",
    "name": "A股周报.docx",
    "kind": "document",
    "size": 48321,
    "modified_at": 1784908800
  }
}
```

`artifact_created` 用于即时刷新体验，不是最终事实来源。GUI 在以下时机重新调用 Artifacts API：

- 切换会话；
- 收到 `artifact_created`；
- 收到成功的文件编辑事件；
- `turn_end`；
- 用户点击刷新。

## HTTP API

所有请求必须显式使用 gateway base URL，并携带 bootstrap token。

### 列出 Artifacts

```http
GET /api/sessions/{encoded_session_key}/artifacts
Authorization: Bearer {token}
```

返回：

```json
{
  "artifacts": [
    {
      "path": "reports/A股周报.docx",
      "name": "A股周报.docx",
      "kind": "document",
      "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "size": 48321,
      "modified_at": 1784908800,
      "preview_url": "/api/sessions/websocket%3Achat/artifacts/content?path=reports%2FA%E8%82%A1%E5%91%A8%E6%8A%A5.docx",
      "download_url": "/api/sessions/websocket%3Achat/artifacts/content?path=reports%2FA%E8%82%A1%E5%91%A8%E6%8A%A5.docx&download=1",
      "reveal_path": "reports/A股周报.docx"
    }
  ]
}
```

`path` 必须是相对当前 workspace 根目录的 POSIX 风格路径，不返回绝对本地路径。
默认只列出 session 创建后产生或更新的文件；显式文件事件中属于该 session 的路径可以补入。
首版最多检查 20,000 个文件和 4,000 个目录，最多返回 100 项；超过限制时响应中的
`truncated` 为 `true`。

### 读取 Artifact

文本源码预览可以复用现有安全文件预览接口：

```http
GET /api/sessions/{encoded_session_key}/file-preview?path={relative_path}
```

PDF、DOCX、XLSX、图片等二进制文件使用：

```http
GET /api/sessions/{encoded_session_key}/artifacts/content?path={relative_path}
Authorization: Bearer {token}
```

下载时增加 `download=1`。响应必须设置正确的 `Content-Type` 和安全的
`Content-Disposition`，单文件读取上限为 64 MiB。GUI 继续复用 `src/core/artifacts.ts`
和现有 PreviewPanel，读取 gateway artifact 时必须携带当前 token。
受保护的 preview/download URL 必须与 bootstrap gateway 同源，GUI 不得把 Bearer token
发送到 gateway 之外的绝对 URL。

### Reveal Artifact

Reveal 属于桌面行为。gateway 只返回经过 workspace scope 校验的相对 `reveal_path`；
GUI 再用当前会话的已知 workspace root 做绝对路径、协议、空字节和 `..` 校验后重建
native path，交给 Electron 既有 shell IPC。纯 WebUI 环境不提供 reveal 时隐藏该按钮。
不得新增浏览器端任意路径打开能力，也不得把 gateway 的 Bearer token 放进 shell URL。

## 后端实现边界

### Narration

- `AgentRunner` 只负责确定“此响应将继续执行工具”这一事实。
- WebSocket wire event 的翻译属于 WebSocket channel/hook。
- 对 `agent/runner.py` 的修改应保持最小，只增加通用 hook 语义，不写 WebUI JSON。
- narration 需要进入 WebUI transcript event log，历史 replay 必须重建相同 Steps。
- session provider history仍保留合法的 assistant `content + tool_calls`，不能为了 UI 删除模型上下文。

### Artifacts

- 路径解析必须使用 `workspace_scope` 和现有 workspace path guard。
- GUI 不得传入或获得未经校验的绝对路径。
- 列表和读取分别校验，防止 TOCTOU 或客户端篡改。
- 文件遍历应有限额、忽略常见大目录，并在线程中执行，避免阻塞 event loop。
- session 的 workspace root 不存在时返回空列表，不扩大到 workspace scope 之外扫描。

## GUI 数据模型

Narration 在 renderer 中是一等活动消息：

```ts
interface NarrationActivity {
  kind: "narration";
  content: string;
  isStreaming: boolean;
  streamId?: string;
  activitySegmentId?: string;
}
```

它必须满足：

- `isAgentActivityMember(message) === true`；
- `TaskNarrativeTimeline` 生成 `kind: "narration"` entry；
- `MessageBubble` 不直接渲染 narration；
- narration 与其后的工具事件属于同一个 activity segment；
- legacy `turn_end` 只关闭流，不把 narration 提升为最终回答；v2 Turn 终态由
  `turn_completed` Turn Resource 表达。

右侧工作台不拥有新的执行状态。新会话的 Progress 从 gateway Runtime Snapshot 中的
Turn Plan Resource 投影，canonical GUI messages 仅作为 legacy transcript fallback；
Artifacts 从 gateway API 获取。

## 状态机

```text
user message
    ↓
reasoning_delta* → reasoning_end
    ↓
delta* → stream_end(resuming=true, stream_kind=narration)
    ↓
narration_delta* → narration_end（commit/reclassify）
    ↓
task_progress / tool start / tool end / file edit
    ↓
（可以重复 reasoning → narration → tools）
    ↓
delta* → stream_end(resuming=false, stream_kind=answer)
    ↓
turn_completed（legacy: turn_end）
```

关键不变量：

1. 同一时刻最多一个 narration 流。
2. narration 开始会关闭 reasoning 流。
3. 最终 answer 开始会关闭 narration 流。
4. v2 `turn_completed` 关闭 Turn 运行态；legacy `turn_end` 只作为兼容适配。没有明确
   terminal Turn Resource 时不伪造成功或 idle。
5. narration 永不参与“复制最终回答”。

## 国际化与可访问性

- narration 由模型使用用户语言生成，工具动作标题由 GUI i18n 模板生成。
- `Progress`、`Artifacts`、状态和空状态必须进入 i18n。
- 执行组使用 `aria-expanded` 和 `aria-controls`。
- 实时更新区域使用 `aria-live="polite"`，不得逐 token 高频朗读。
- 状态不能只靠颜色表达。

## 兼容与迁移

### 新 GUI + 旧 gateway

- 忽略不存在的 narration/artifact 事件；
- 继续展示旧 `delta`、`reasoning_delta`、tool hint 和 file edit；
- Artifacts API 返回 404 时显示兼容空状态，不影响聊天。

### 旧 GUI + 新 gateway

- gateway 保持现有 `message`、`reasoning_delta`、`delta`、`turn_end` 字段；
- narration 是新增事件，旧 GUI 会忽略它，但最终回答仍正常；
- 不修改已有 REST 响应的必填字段。

### 历史 transcript

- 带 narration 事件的新历史精确恢复；
- 旧历史不进行文本启发式迁移，避免把真实回答误判成 narration；
- 旧 `task_progress` 和工具事件继续正常投影。

## 验收标准

### Narration

- 模型输出“接下来读取更详细的市场数据”并随后调用工具时，该文本只出现在 Steps。
- 最终回答只出现一次，不在 Steps 和正文重复。
- reasoning 原文不会出现在正文或 narration。
- 连续多批工具调用产生多条按顺序排列的 narration。
- 刷新会话后 narration 的位置和类型保持不变。

### Progress

- `update_task_progress` 的最新状态显示在右侧。
- 聊天中的计划更新与工具调用顺序正确。
- 停止任务后 running 项变成中断/错误状态。
- 没有结构化计划时显示轻量工作状态，不伪造业务步骤。

### Artifacts

- 创建 DOCX/XLSX/PDF/图片后，右侧列表自动刷新。
- 点击文件打开现有预览组件。
- 切换会话不会泄漏上一个会话的文件。
- 构造 `../`、绝对路径和 symlink escape 均被后端拒绝。
- 未认证请求返回 401。

### 回归

- 普通短问答仍只显示一问一答。
- `reasoning_delta`、工具 trace、文件编辑、专家团队和交互式提问卡不回归。
- 旧 gateway 下聊天仍可用。
- GUI 构建和相关 Vitest 通过。
- nanobot narration、transcript replay、artifact path boundary 的 pytest 通过。
