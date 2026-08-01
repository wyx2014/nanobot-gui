# Hope Agent ToolStep 同构实现规范

状态：已实现，待完整工程与视觉验收  
适用范围：桌面聊天主会话中的模型思考、公开行动说明、工具调用、计划和处理中状态  
唯一交互参考：`/Users/wyx/project/nanobot-pc/hope-agent`

## 1. 改造结论

TPACowork 原有 ToolStep 展示方式全部废弃，不再保留：

- “进行中 N steps / 已完成 N steps”整块摘要。
- 整个 ToolStep 统一展开或收起。
- 每个 running 行各自显示旋转图标、波纹或呼吸动画。
- ToolStep 自己的固定高度和内部滚动容器。
- 彩色节点、语义图标和状态文案堆叠形成的步骤面板。

新实现直接采用 Hope Agent 当前默认消息渲染模型：

```text
ThinkingBlock
→ ToolCallBlock / ToolCallGroup
→ ThinkingBlock
→ ToolCallBlock / ToolCallGroup
→ assistant text
```

连续完成的处理单元只有在后续 assistant 正文开始后，才折叠成一个
`ProcessedBlockGroup`。单个完成工具保持可见，不人为包装成“已处理”。

## 2. Hope Agent 真实依据

本规范以以下文件为准，不再根据截图或原有 TPACowork UI 推测：

| Hope Agent 文件 | 复刻内容 |
| --- | --- |
| `message/MessageContent.tsx` | 有序 block 遍历、连续工具分组、完成前缀折叠时机 |
| `message/ThinkingBlock.tsx` | 思考标题、脑图标、展开状态、耗时、正文左边线 |
| `message/ToolCallBlock.tsx` | 单工具紧凑行、参数摘要、耗时、结果与原始调用展开 |
| `message/ToolCallGroup.tsx` | 连续工具折叠成一行，展开显示成员 |
| `message/ProcessedBlockGroup.tsx` | “已处理”摘要和完成处理块的二次展开 |
| `message/MessageTimeline.tsx` | 单列时间线；只有最后一个活跃 item 有动态 marker |

Hope Agent 同时支持 bubble 与 timeline 模式；其默认偏好为 timeline。本次复刻
采用默认 timeline 模式，而不是将 TPACowork 旧 ToolStep 套进 Hope 风格外观。

## 3. 数据边界

Agent 执行权威仍属于 nanobot gateway：

- 实时数据来自 WebSocket 事件。
- 历史数据来自 gateway 的 SQLite 会话投影。
- GUI 只生成展示 block，不执行工具、不推断虚假工具结果。
- `call_id` 是工具 start/end/error 原地更新的稳定身份。

与 Hope Agent 一致，TPACowork 展示 gateway 已经交付给客户端的
`reasoning_delta → message.thinking` 内容；它只能出现在可折叠 ThinkingBlock
中，不能混入 assistant 最终回答正文。gateway 明确标记为 `narration` 的公开
行动说明继续保留为独立的 ThinkingBlock。没有 thinking 内容时才只显示泛化
“正在思考 / 已思考”状态。

## 4. 内容顺序

`activityTimeline.ts` 按一个 turn 内的真实消息顺序扫描：

1. 连续 activity 消息形成一个 activity run。
2. assistant 正文结束前一个 activity run。
3. 正文之后的新工具保持在该正文之后，禁止统一移动到 turn 顶部。
4. 内联 reasoning + 正文拆成 activity 与正文两个顺序单元。
5. 实时投影与历史重载使用同一套算法。

activity run 内由 `taskNarrativeTimeline.ts` 保持：

- 每个公开 narration 独立。
- 每轮 provider thinking 产生一个 thinking block，流式内容原地增长。
- 工具以 `call_id` 原地更新，不产生 start/end 两行。
- 同 `batch_id` 工具保留成员关系。
- 工具开始、结束时间用于单行和工具组耗时。

## 5. Hope 同构渲染规则

### 5.1 ThinkingBlock

- Header：Chevron、`BrainCircuit`、“正在思考 / 已思考”、耗时。
- 活跃时默认展开，完成后默认收起。
- thinking 和公开 narration 放在左侧紫色半透明竖线内，并使用 Markdown 渲染。
- 正文最大高度 320px，内容增长时跟随到底部。
- 没有 thinking/narration 正文时只显示泛化 header。
- 活跃时标题 shimmer、脑图标轻微 pulse 和省略点。

### 5.2 ToolCallBlock

- 一行结构：Chevron、工具图标、动作名、参数摘要、耗时。
- 工具结果与完整原始调用默认不显示。
- 点击工具行展开结果；hover 后出现原始调用按钮。
- 运行时只有当前工具标题 shimmer 和图标角标 pulse。
- 完成工具完全静止。
- 错误使用红色文字，但不增加额外循环动画。

### 5.3 ToolCallGroup

- 相邻两个及以上工具先合并为一个工具组。
- 并行工具或连续工具默认只显示一行摘要。
- 展开后成员使用 11px 紧凑行和左侧细边线。
- 多个工具运行时，外层只保留一个活动 timeline marker。
- 组耗时按最早开始到最晚完成的 wall-clock 计算，不能把并行耗时累加。

### 5.4 ProcessedBlockGroup

- 只有连续两个及以上完成 process unit 才折叠。
- 折叠必须等待后续 assistant 正文出现。
- 工具刚完成而模型还在下一轮处理时保持原状，避免完成瞬间闪成“已处理”。
- 单个完成工具不折叠。
- Header 与 Hope 一致：Chevron、CheckCircle、“已处理”、耗时、失败数。
- 展开后按原顺序显示原始 thinking/tool/group。

### 5.5 MessageTimeline

- 使用 `1rem + content` 两列布局。
- 节点直径、间距、连线起点与 Hope Agent 保持一致。
- thinking 为 violet，tool/processed 为 teal，running 为 blue，failed 为 red。
- 任何时刻最多一个 timeline item 为 active。
- active item 有两层 ping 和一个 pulse dot；其他 item 无循环动画。
- 工具完成、等待下一轮模型输出时，只增加一个三点 loading tail。

## 6. TPACowork 文件映射

| 文件 | 责任 |
| --- | --- |
| `src/core/nanobot/activityTimeline.ts` | activity 与 assistant 正文的真实顺序 |
| `src/core/nanobot/taskNarrativeTimeline.ts` | 稳定 block、工具身份和时间信息 |
| `src/components/chat/TaskNarrativeTimeline.tsx` | Hope Thinking/Tool/Group/Processed/Timeline 同构实现 |
| `src/components/chat/ThreadMessages.tsx` | 将 activity run 与正文按顺序插入聊天 |
| `src/styles/index.css` | Hope shimmer、暗色和 reduced-motion |

不新增 GUI 本地 Agent、工具执行器、scheduler 或本地会话事实来源。

## 7. 验收标准

### 7.1 结构

- DOM 中不存在旧 `data-toolstep-summary`。
- 不显示“进行中 N steps”外层摘要。
- 不存在 ToolStep 固定高度内部滚动区。
- thinking、tool、tool group、processed group 的层级与 Hope 一致。

### 7.2 顺序与折叠

- `思考1 → 工具1 → 思考2 → 工具2` DOM 顺序完全一致。
- 单工具完成且出现回答后，仍显示单工具行。
- 两个及以上 process unit 在回答出现后折叠为一个“已处理”。
- 回答出现前禁止提前折叠。
- 相邻两个工具只显示一个工具组。

### 7.3 动效

- 任意时刻最多一个 `[data-hope-timeline-item][data-active=true]`。
- 活跃 timeline item 只有两层 ripple。
- 完成行没有 shimmer、pulse、ping 或 spinner。
- 并行工具默认折叠，不能同时展示多行加载动画。
- `prefers-reduced-motion` 下关闭 ripple 与 shimmer。

### 7.4 内容与安全

- thinking/narration 活跃时原文可见，完成后默认收起且可重新展开。
- thinking 原文只进入可折叠过程区，不进入最终回答正文。
- 工具参数只显示 Hope 风格的一行摘要。
- 完整输入和结果必须通过各自控制显式展开。
- 产物路径不重新塞进 ToolStep；产物由会话右侧产物栏负责。

### 7.5 工程门禁

- ToolStep、activity timeline 和 narrative projection 定向测试通过。
- 全量 Vitest 通过。
- TypeScript `tsc -b` 通过。
- `npm run build` 通过。
- 可连接应用浏览器时，对运行工具组、thinking 展开、processed 折叠进行截图核对。

## 8. 与 Hope Agent 允许存在的差异

仅允许以下由架构边界造成的差异：

1. TPACowork 使用 nanobot gateway/SQLite 消息投影，不复制 Hope 的 Rust schema。
2. 只展示 gateway 已交付给 renderer 的 thinking，不尝试获取 provider 未返回的隐藏推理。
3. 工具名称和参数来自 nanobot 的 `display` 元数据，文案可能与 Hope 内置工具表不同。
4. 使用 TPACowork 现有主题 token，但组件尺寸、层级、状态和动效规则保持一致。

除以上四点，不保留原 ToolStep 的交互方式。
