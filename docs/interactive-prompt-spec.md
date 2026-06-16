# 交互式提问卡需求 Spec

## 概述

本文档定义 Nanobot Chat UI 中“交互式提问卡”的产品与技术方案。

目标：

- 支持类似 Claude 的“助手主动提问 + 用户点选回答”的交互形式。
- 该交互可以进入聊天时间线，而不是临时浮层。
- 支持刷新后回放、历史恢复、继续执行。
- 与普通聊天、会话恢复、定时任务等现有机制兼容。

非目标：

- 不追求 Claude 的像素级还原。
- V1 不做通用表单引擎。
- V1 不支持任意复杂的嵌套问卷流程。

## 问题定义

当前系统已经支持：

- 用户消息
- 助手消息
- trace / activity 行
- 工具执行和文件编辑进度

但还不支持一种“结构化的助手问题”，它需要同时满足：

- 在聊天区渲染为可点击卡片
- 能在刷新后继续显示
- 能在历史回放中恢复
- 能让 Agent 暂停，等待用户回答
- 用户回答后能继续同一轮流程

如果只用临时 `agent_ui` blob 来做，这个交互不会成为 transcript 的一部分，刷新和回放都会出问题。

## 产品目标

1. 助手可以在对话中途发出一个结构化问题。
2. 前端把这个问题渲染成聊天时间线中的交互式卡片。
3. 用户可以通过以下方式回答：
   - 点击一个选项
   - 输入自由文本
   - 在允许时跳过
4. 提问和回答在刷新后仍可见。
5. 后端能明确知道用户回答的是哪一个 prompt，并据此继续执行。

## 核心设计决策

交互式提问卡必须是一等 transcript 消息，而不是临时 UI 浮层。

这意味着：

- prompt 本身会被持久化进 transcript
- 用户回答也会被持久化进 transcript
- 前端刷新和回放依赖 transcript 恢复
- `agent_ui` 仍可用于增强展示，但不是唯一数据源

## 范围

V1 范围：

- 同一时间只允许一个待回答 prompt
- 单选题
- 可选自由输入
- 可选 Skip
- prompt 状态支持：`pending`、`answered`、`skipped`
- transcript 可回放
- 后端支持等待 / 恢复

V1 不做：

- 多选
- 树状问卷
- 前端纯配置驱动的复杂条件分支
- 拖拽、富表单控件
- 已提交答案的编辑

## 用户体验

### 提问卡

助手可以发出一张问题卡，包含：

- 标题
- 问题正文
- 步骤指示，例如 `1 / 2`
- 选项列表
- 可选自由输入能力
- 可选 `Skip`

这张卡片出现在聊天时间线中，语义上属于助手消息。

### 提交答案

当用户点击选项或提交自由输入后：

- 该卡片状态从 `pending` 变成 `answered` 或 `skipped`
- 控件进入禁用态
- 时间线中追加一条用户回答消息
- 后端恢复等待中的流程继续执行

### 刷新与回放

页面刷新或会话恢复后：

- 卡片能按 transcript 正确重新渲染
- 已提交答案仍与原 prompt 关联
- 不会重复出现相同 prompt

## 触发规则

### 允许触发的场景

交互式提问卡只应在“缺少继续执行所必需的信息”时触发。

适合触发的典型场景：

- 用户目标明确，但缺少关键参数，无法继续执行
- 需要用户在少量明确分支中做选择，且不同选择会显著改变后续流程
- 需要补充的信息天然适合结构化表达，用户点选会明显快于自由输入
- 用户已经明确允许助手先问几个关键问题再继续执行

示例：

- “帮我做一个学习计划”，但没有说明学习主题、目标或截止时间
- “帮我建一个定时任务”，但没有说明执行频率或执行时间
- “帮我生成一个方案”，但没有说明输出形式、适用对象或优先级

### 一次性收集原则

如果某个任务在开始阶段就明显缺少多项必要信息，系统应优先在开头通过多步提问卡连续收集完整，而不是执行到一半再零散追问。

规则如下：

- 允许在任务开始阶段连续发出多步提问卡
- 每一步提问都必须服务于补齐继续执行所必需的信息
- 当系统已经收集到足够信息后，不应再继续弹出新的提问卡
- 后续执行阶段如果不再缺关键信息，应直接继续执行，而不是再次打断用户

产品意图：

- 开头集中补齐信息
- 中途尽量少打断
- 避免把一次任务拆成多轮零碎问答

### 禁止触发的场景

以下场景不应使用交互式提问卡：

- 用户已经提供了足够信息，系统可以直接执行
- 问题只是礼貌性补充，而不是继续执行所必需的信息
- 问题本身过于开放，不适合结构化选项表达
- 系统可以通过合理默认值、上下文或已有配置安全推断答案
- 触发场景属于自动运行、无人值守或无法及时获得人工回答的流程

典型禁止场景：

- “还有什么要补充的吗” 这种非必要追问
- 明明可以直接生成结果，却为了保险再额外确认一次
- 纯闲聊、开放讨论、探索式对话
- 定时任务、自动化执行、后台任务等无人可答场景

### 默认行为原则

默认优先级如下：

1. 如果信息足够，直接执行。
2. 如果信息不足但可以安全推断，优先推断并继续。
3. 如果信息不足且无法安全推断，再触发交互式提问卡。
4. 如果存在多项必要信息缺失，优先在任务开始阶段连续问完。

## 数据模型

### Transcript 消息类型

扩展 canonical WebUI message model，使 assistant 消息支持结构化 prompt 内容。

新增 prompt 数据结构：

```ts
type UIInteractivePromptStatus = "pending" | "answered" | "skipped" | "expired";

interface UIInteractivePromptOption {
  id: string;
  label: string;
  description?: string;
}

interface UIInteractivePrompt {
  promptId: string;
  title?: string;
  question: string;
  options: UIInteractivePromptOption[];
  allowFreeform?: boolean;
  allowSkip?: boolean;
  stepIndex?: number;
  totalSteps?: number;
  status: UIInteractivePromptStatus;
  answeredOptionId?: string;
  answeredText?: string;
}
```

扩展 `UIMessage`：

```ts
interface UIMessage {
  ...
  interactivePrompt?: UIInteractivePrompt;
}
```

### 用户回答元数据

当用户回答该问题时，提交的用户消息需要携带结构化 metadata：

```ts
interface InteractivePromptAnswerMeta {
  promptId: string;
  answerType: "option" | "freeform" | "skip";
  optionId?: string;
}
```

这份 metadata 必须能被后端 runner 读取，也必须能进入 session history。

### 用户回答消息内容

用户提交答案时，发送给后端的内容分为两层：

- 展示文本：用于正常用户消息显示，例如选项文案或自由输入内容
- 结构化 metadata：用于精确标识该回答属于哪个 prompt

约束：

- 选项回答时，用户消息正文使用用户点击的选项文案
- 自由输入回答时，用户消息正文使用用户输入的原始文本
- Skip 时，用户消息正文使用统一文本，例如 `Skip`

结论：

- LLM 看到的是一条正常的 user message
- 系统同时通过 metadata 保留 `promptId`、`answerType`、`optionId`

## 后端设计

### 新能力

后端需要支持“等待用户回答”的会话状态。

流程概念如下：

1. agent 发出 interactive prompt
2. 后端把 prompt 写入 transcript
3. 后端把 session 标记为等待 `promptId`
4. 前端提交用户回答
5. 后端校验该回答是否匹配当前待回答 prompt
6. 后端持久化用户回答
7. 后端继续执行

### 后端状态

每个 session 至少需要维护：

- `pending_interactive_prompt_id: str | None`
- prompt schema 快照或可恢复引用
- waiting 状态标记

这部分状态可以落在 session metadata 或 continuation metadata 中，但必须支持断线恢复。如果 transcript 中存在未回答 prompt，系统也要能识别出来。

### 后端 API / 协议

有两种可行实现：

方案 A：把回答当成普通用户消息发送，但附带 metadata

- 对现有 WebSocket 发消息链路改动最小
- 适合作为 V1

方案 B：新增专门的 `interactive_prompt_answer` 客户端事件

- 语义更清晰
- 协议改动更大

V1 采用方案 A。

前端发送一个普通用户消息，同时附带：

```json
{
  "interactive_prompt_answer": {
    "promptId": "p_123",
    "answerType": "option",
    "optionId": "opt_language"
  }
}
```

### Transcript 持久化

transcript 必须持久化以下内容：

- 助手发出的 prompt 消息
- 用户的回答消息
- prompt 的最终状态

回放构建逻辑需要能根据 transcript 还原 prompt 卡片及其状态。

多步提问建模结论：

- V1 中每一步提问都是一条独立 assistant 消息
- 不采用“单条 prompt 消息内部不断切换 step”的更新方式
- 每一步都有自己的独立 `promptId`

### 校验规则

后端必须拒绝以下非法回答：

- `promptId` 不存在
- prompt 已经回答过
- `optionId` 不属于当前 prompt
- 要求自由输入时提交为空

这类错误必须以用户可见的方式反馈到当前会话中。

## 前端设计

### 消息模型

需要同时扩展：

- `src/core/types.ts`
- `src/types/index.ts`

用于表示：

- 回放得到的 interactive prompt
- 本地运行时消息中的 interactive prompt

### 渲染

新增独立组件：

- `InteractivePromptCard`

推荐渲染路径：

- `ThreadMessages` 检测 `message.interactivePrompt`
- 分流到 `MessageBubble` 的特殊分支，或独立渲染组件

卡片应具备：

- 明确的 assistant 语义
- 紧凑的标题 / 问题 / 选项布局
- 键盘可操作
- 已提交后的禁用态

assistant 文本与交互卡片的组合结论：

- 普通 assistant 文本与 interactive prompt 不放在同一条消息中
- 如果某轮既要解释又要提问，拆成两条 assistant 消息：
  - 第一条为普通文本消息
  - 第二条为 interactive prompt 卡片消息

### 提交流程

用户点击选项或提交自由输入时：

1. 前端先进入提交中状态
2. 发送一条带 prompt-answer metadata 的用户消息
3. 最终状态以后端会话更新 / replay 为准

前端不应只靠本地状态永久把 prompt 改成 answered；最终必须以后端确认后的 canonical 状态为准。

提交后修改策略结论：

- V1 中用户答案一旦提交即锁定
- 在 agent 恢复执行前，不支持修改、覆盖、撤回刚提交的 interactive prompt answer
- 如果用户需要补充说明，作为下一条普通 user message 继续发送

### 状态归属

真实状态来源：

- 后端 transcript
- session state

前端短期状态：

- 正在提交
- 本地错误
- 焦点选项

## 状态机

### Prompt 生命周期

1. `pending`
2. `answered` 或 `skipped`
3. 可选 `expired`

### Session 生命周期

1. agent 正在运行
2. 发出 prompt
3. session 进入等待用户回答状态
4. 用户回答
5. agent 恢复执行
6. 正常结束，或进入下一次提问

约束：

- V1 中同一 session 只允许一个 pending interactive prompt
- 如果 session 中已经存在一个 pending prompt，后端必须拒绝创建第二个 pending prompt

## WebSocket / 回放要求

### 实时流

实时 WebSocket 消息必须支持 assistant 消息中携带 `interactivePrompt`。

### 回放

`fetchWebuiThread` 返回的历史消息也必须包含相同结构，这样刷新才能恢复一致的视觉状态。

### 定时任务

从传输层能力上，交互式 prompt 也可以用于定时任务 session；但从产品策略看，如果没有实时用户可回答，会导致任务卡死。

建议 V1 策略：

- 禁止定时任务执行期间发出 interactive prompt
- 如果自动化流程尝试发出，应由后端返回明确错误

## 错误处理

前端错误场景：

- 答案提交失败
- prompt 已过期
- prompt 已在别处被回答

后端错误场景：

- prompt 不存在
- 选项非法
- 重复提交
- 当前 session 没有待回答 prompt

UI 行为建议：

- 保留卡片可见
- 展示小型 inline error
- 仅在安全时允许重试

## 可访问性

卡片必须支持：

- 键盘导航
- 明确焦点态
- 语义化按钮或 radio 类控件
- 标题 / 问题 / 当前选择状态可被屏幕阅读器读取

## 埋点

建议记录：

- prompt 发出次数
- prompt 回答次数
- prompt skip 次数
- 平均回答耗时
- 非法提交次数

便于后续评估交互 prompt 的真实使用价值。

## 安全边界

后端不能信任前端提交的 `optionId`。

后端必须校验：

- prompt 是否存在
- prompt 是否属于当前 session
- prompt 是否仍处于 pending
- 选项是否有效

## 分阶段交付

### Phase 1：协议与回放

- 增加 interactive prompt transcript schema
- prompt 和 answer 都能持久化
- replay 能恢复该卡片

完成标准：

- 页面刷新后，prompt 状态不丢失

### Phase 2：实时交互 UI

- 在聊天区渲染提问卡
- 支持选项点击 / skip / 自由输入
- 前端把答案作为用户消息发送，并带 metadata

完成标准：

- 一次完整的“提问 -> 回答 -> 继续执行”链路可端到端跑通

### Phase 3：体验打磨

- 步骤指示 `1 / N`
- inline loading / error
- 键盘体验
- 视觉细节优化

## 验收标准

1. 助手可以在聊天中发出结构化提问卡。
2. 该卡片在实时对话和历史回放中都能看到。
3. 用户可以通过点击选项完成回答。
4. 用户回答能正确关联到对应的 `promptId`。
5. 后端在收到回答后能恢复等待中的会话继续执行。
6. 提问卡在回答后进入不可编辑状态。
7. 页面刷新后，pending / answered / skipped 状态保持一致。
8. V1 中定时任务不会进入一个无人可答的等待态。

## 已确认决策

1. 多步提问采用“每一步一条独立 prompt 消息”的建模方式，不做单消息多步更新。
2. 自由输入回答提交后，时间线中显式追加一条普通 user message。
3. 用户提交 interactive prompt answer 后，V1 不支持修改或撤回。
4. 导出 transcript 时默认降级为文本表示，内部存储仍保留结构化数据。
5. 用户答案的提交协议为“普通 user message + `interactive_prompt_answer` metadata”。
6. assistant 文本说明与 interactive prompt 卡片拆成两条独立 assistant 消息，不混在同一条消息里。
7. 同一个 session 在 V1 中只允许一个 pending prompt；第二个 pending prompt 由后端拒绝。

## 推荐结论

V1 建议采用以下方案：

- 每个问题就是一条独立 assistant 消息，携带一个 `interactivePrompt`
- 用户回答作为普通 user message 持久化，同时附带结构化 metadata
- 选项回答显示为用户点击的选项文案；自由输入显示为原始输入；Skip 使用统一文本
- 每个 session 同时只允许一个 pending prompt
- assistant 说明文本与 prompt 卡片拆成两条独立消息
- 定时任务默认禁止发出 interactive prompt
- 刷新和历史回放全部依赖 transcript，而不是临时浮层状态
