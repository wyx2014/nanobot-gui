# 交互式提问卡 Spec

## 概述

交互式提问卡用于在 WebUI 会话中收集继续执行所必需的少量结构化信息。

当前实现的核心原则：

- 交互式 prompt 是 transcript/session 中的一等结构化数据。
- 交互卡片本身不是消息流 UI，不在聊天时间线中展示。
- 未回答的 prompt 只显示在输入框上方。
- 回答后只在消息流中保留一条普通用户 Q/A 消息。
- 刷新、切换会话、重启应用后，显示状态以后端 transcript/session replay 为准。

## 产品行为

### 显示位置

交互式卡片只属于 composer/input 区：

- 当前会话存在 `interactivePrompt.status === "pending"` 时，卡片显示在输入框上方。
- 切换到其他会话时，卡片随当前会话隐藏。
- 切回原会话时，如果 prompt 仍是 pending，卡片重新显示。
- 聊天消息流过滤所有 `interactivePrompt` 消息，不显示 pending/answered/skipped 卡片。

消息流中只展示：

- 用户原始提问
- 用户回答交互卡后自动生成的 Q/A 文本
- 后续 assistant 正常回答、trace、工具进度等

### 卡片交互

卡片是统一的分页 wizard：

- 单题和多题使用同一个 `InteractivePromptCard`。
- 多题时一次只展示当前一个问题。
- 右上角显示 `1 of N`，支持上一题/下一题切换。
- 用户选择当前题选项后自动进入下一题。
- 所有题都支持“其他”自由输入。
- “其他”由前端固定提供，模型生成的 `options` 不应包含“其他 / Something else / Custom”等兜底选项。
- 自由输入草稿按 questionId 缓存；切换题目再回来不会丢失。
- 全部问题回答完后，前端合成一条用户消息并提交。

合成消息格式：

```text
Q: What are you learning, and what's your goal or deadline? A: A spoken language

Q: How much time can you dedicate per day? A: 30-60 min
```

提交成功后，前端会把本地 prompt 临时标记为 `answered` 或 `skipped`，从而立即关闭输入区卡片；后端 replay 随后以 canonical 状态覆盖。

### 已回答历史

已回答、跳过或过期的 prompt 不再显示卡片。

历史页面只显示用户 Q/A 消息。对于旧数据：

- 如果 WebUI transcript 缺少 `interactive_prompt_answer`，但 session history 中同一 `promptId` 已经是 answered/skipped/expired，replay 会用 session 状态覆盖 transcript 中的 pending 状态。
- 如果 transcript 和 session 都缺少回答状态，系统无法判断该 prompt 已回答，仍会按 pending 处理。

## 触发规则

交互式提问卡只应在缺少继续执行所必需的信息时触发。

适合触发：

- 用户目标明确，但缺少关键参数。
- 用户明确允许先问 1-2 个关键问题。
- 缺失信息天然适合选项或短文本回答。
- 不同选择会显著改变后续执行。

不应触发：

- 信息已经足够，可以直接执行。
- 可以安全使用默认值或上下文推断。
- 只是礼貌性补充问题。
- 开放式闲聊或探索性讨论。
- 定时任务、自动化任务、无人值守流程。

多问题原则：

- 触发前先评估所有待补充信息。
- 用贪心策略选择最多 2 个最关键、互不依赖、最能阻塞任务继续的问题，放在同一张卡的 `questions[]` 中。
- 如果凑不到 2 个互不依赖的关键问题，只问 1 个最关键问题。
- 交互式卡片在同一 session/task 中最多使用 2 轮。
- 第 2 轮交互式卡片只允许用于“问题依赖第 1 轮答案”的场景。
- 两个开场阶段就能判断出来的独立问题，禁止拆成两张连续卡片。
- 超过 2 轮后，任何剩余追问都必须用普通文本提问，不再弹交互式卡片。
- 同一 session 同一时间只允许一个 pending prompt。

## 数据模型

### UI 类型

`src/core/types.ts` 中的核心结构：

```ts
type UIInteractivePromptStatus = "pending" | "answered" | "skipped" | "expired";

interface UIInteractivePromptOption {
  id: string;
  label: string;
  description?: string;
}

interface UIInteractivePromptQuestion {
  id: string;
  question: string;
  options: UIInteractivePromptOption[];
  allowFreeform?: boolean;
  answeredOptionId?: string;
  answeredText?: string;
}

interface UIInteractivePrompt {
  promptId: string;
  title?: string;
  question: string;
  options: UIInteractivePromptOption[];
  questions?: UIInteractivePromptQuestion[];
  allowFreeform?: boolean;
  allowSkip?: boolean;
  stepIndex?: number;
  totalSteps?: number;
  status: UIInteractivePromptStatus;
  answeredOptionId?: string;
  answeredText?: string;
}

interface UIInteractivePromptAnswer {
  promptId: string;
  answerType: "option" | "freeform" | "skip" | "group";
  optionId?: string;
  answers?: Array<{
    questionId: string;
    answerType: "option" | "freeform";
    optionId?: string;
    text: string;
  }>;
}
```

单题兼容：

- 旧式 `question + options` 会在前端规范化为一个内部 question。
- 单题选项回答可以发送 `answerType: "option"`。
- 单题自由输入会发送 grouped answer，以便携带 question text 和回答文本。

多题：

- 使用 `questions[]`。
- 每个 question 有独立 `id`、`question`、`options`、answer 状态。
- `options` 只包含具体、有业务含义的选项，不包含“其他”兜底项。
- 前端提交时发送 `answerType: "group"`，并附带每题 answer。

### WebSocket 出站

后端通过普通 assistant message 携带结构化 prompt：

```json
{
  "event": "message",
  "chat_id": "chat-id",
  "text": "What are you learning?",
  "interactive_prompt": {
    "promptId": "prompt:abc",
    "question": "A couple of quick questions",
    "questions": [
      {
        "id": "topic",
        "question": "What are you learning?",
        "options": [{ "id": "language", "label": "A spoken language" }],
        "allowFreeform": true
      }
    ],
    "status": "pending"
  }
}
```

`text` 不应为空；当没有根级 question 时，后端会使用 title、根级 question、第一题 question 或兜底文案生成安全文本。

### WebSocket 入站

用户回答通过普通 user message 发送，同时附带 metadata：

```json
{
  "type": "message",
  "chat_id": "chat-id",
  "content": "Q: What are you learning? A: A spoken language",
  "interactive_prompt_answer": {
    "promptId": "prompt:abc",
    "answerType": "group",
    "answers": [
      {
        "questionId": "topic",
        "answerType": "option",
        "optionId": "language",
        "text": "A spoken language"
      }
    ]
  },
  "webui": true
}
```

## 后端行为

### Tool

`request_user_input` 支持两种输入：

- 单题：`question + options`
- 多题：`questions[]`

`questions[]` 用于最多 2 个互不依赖的问题。每题默认允许自由输入。

模型不得在 options 中生成“其他 / Something else / Custom”等兜底选项；后端 normalization 会防御性过滤这类选项。

后端限制：

- 单张卡 `questions[]` 最多 2 个问题。
- 同一 session/task 最多创建 2 轮交互式卡片。
- 第 2 轮必须是依赖上一轮交互回答的追问；否则 `request_user_input` 会拒绝创建卡片。
- 第 3 轮及之后如果仍需补充信息，`request_user_input` 会拒绝创建卡片，模型应改用普通文本提问。

### Session 状态

后端在 session metadata 中保存当前 pending prompt：

- key: `interactive_prompt_pending`
- value: normalized interactive prompt

如果 session 已有 pending prompt，新的 `request_user_input` 会拒绝创建第二个 pending prompt。

### 回答消费

收到 user message 时，后端会：

1. 查找 session pending prompt。
2. 读取 `interactive_prompt_answer` metadata。
3. 校验 `promptId`、`optionId`、每题 `questionId`、自由输入权限和文本。
4. 更新 session 中对应 `_interactive_prompt` 的状态。
5. 清除 session metadata 中的 pending prompt。
6. 保存 user message 的 `interactive_prompt_answer` metadata。
7. 继续 agent 流程。

非法回答会被拒绝消费，pending prompt 保持不变。

### Transcript

WebUI transcript 持久化：

- assistant prompt event
- user Q/A answer event
- user event 中的 `interactive_prompt_answer`

回放时：

- transcript 中的 prompt 和 answer metadata 可还原 answered/skipped 状态。
- 对旧数据，`apply_session_interactive_prompt_states()` 会用 session history 中的 `_interactive_prompt` 状态覆盖 transcript replay 的旧 pending 状态。

## 前端行为

### ChatView

`ChatView` 负责把 prompt 从消息流中剥离：

```ts
const pendingPromptMessage = displayMessages.find(
  (message) => message.interactivePrompt?.status === "pending"
);

const timelineMessages = displayMessages.filter(
  (message) => !message.interactivePrompt
);
```

`pendingPromptMessage` 渲染到输入框上方。

`timelineMessages` 传给 `ThreadMessages`，因此消息流永远不显示交互卡片。

### InteractivePromptCard

`InteractivePromptCard` 是分页 wizard：

- `prompt.questions` 存在时按 questions 渲染。
- 旧式单题 prompt 会被包装成一个 question。
- 当前只显示一个 question。
- 每题选项和“其他”输入都在当前页内。
- `freeformByQuestion` 按 questionId 缓存自由输入草稿。
- 全部答完后生成 Q/A 文本和 `interactivePromptAnswer` payload。

### 提交后 UI

提交后前端会临时更新本地 stream message：

- `pending -> answered`
- `skip -> skipped`

这样卡片立即关闭。后端 replay 返回后，最终状态以后端为准。

## 错误处理

前端：

- 提交中显示 inline loading。
- 提交失败显示 inline error。
- 失败时保留卡片和草稿，允许重试。

后端：

- prompt 不存在、promptId 不匹配、optionId 非法、group answers 不完整、自由输入为空等都拒绝消费。
- 定时任务和非 WebUI channel 不允许使用 `request_user_input`。

## 验收标准

1. 当前会话有 pending prompt 时，输入框上方显示交互卡片。
2. 消息流不显示任何交互卡片。
3. 单题和多题共用同一个分页卡片组件。
4. 多题时一次只显示一个问题，支持上一题/下一题切换。
5. 每题都支持自由输入，切换后草稿不丢失。
6. 全部答完后自动生成一条 Q/A 用户消息。
7. 提交后卡片关闭，消息流只保留 Q/A。
8. 切换会话再切回，未回答 prompt 仍显示；已回答 prompt 不显示。
9. 重启应用后，pending/answered/skipped 状态正确恢复。
10. 旧 transcript 缺少 answer metadata 时，如果 session history 有 answered 状态，回放不再误弹已回答卡片。

## 当前非目标

- 多选题。
- 任意复杂表单。
- 条件分支问卷。
- 已提交答案编辑。
- 消息流内展示已回答卡片。
