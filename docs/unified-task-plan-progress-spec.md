# 统一任务计划与进度投影 Spec

> 状态：已实施（兼容期）
> 适用范围：`nanobot` gateway、专家团队运行时、WebSocket/REST、SQLite、Electron GUI
> 最后更新：2026-07-27

## 1. 文档定位

本 Spec 解决任务计划在不同任务和不同界面中行为不稳定的问题：

- 专家团队在聊天 Steps 中按真实活动推进，但右侧 Progress 停在最后一位专家；
- 专家成员全部完成后，没有立即进入“主笔交叉质证与汇总”；
- 主笔和审校状态依赖模型主动调用 `update_task_progress`，调用失败后 UI 永久停留；
- 同一个 Turn 同时存在团队快照、模型计划、工具步骤和 GUI 派生计划；
- 普通任务有时有计划、有时没有计划，行为取决于模型是否记得调用计划工具；
- 聊天中的计划和右侧 Progress 读取不同数据源，状态、标题和终态可能不一致；
- Turn 已结束时，计划可能突然跳步、残留 `running`，或把未执行阶段误标为完成。

本 Spec 是以下文档在“计划生成策略、计划所有权、专家团队固定计划、普通任务动态计划、
双 UI 一致性”方面的权威补充：

- `docs/turn-lifecycle-runtime-spec.md`
- `docs/conversation-workbench-spec.md`
- `docs/expert-team-spec.md`
- `docs/project-isolation-storage-spec.md`
- `docs/gui-backend-interface-spec.md`

若旧文档与本 Spec 冲突：

1. Turn 是否运行、何时终态，以 `turn-lifecycle-runtime-spec.md` 为准；
2. Plan 是否必须存在、由谁创建、如何推进、两个 UI 如何投影，以本 Spec 为准；
3. Artifact、Project 和 Session 隔离继续以 `project-isolation-storage-spec.md` 为准；
4. GUI 不得重新获得执行权威。

### 1.1 实施状态

首版实现已完成：

- `AgentRunner` 已接入 Runtime Plan Barrier：单次低风险读取可无计划，复杂工具或第二次读取
  必须先发布动态计划；
- 专家团队启动时创建 runtime-owned WorkflowPlan，模型调用 `update_task_progress` 不再覆盖；
- 所有必要成员终态后由后台进入主笔阶段，报告交付工具成功后进入审校阶段；
- `turn_progress`、`turn_steps` 已扩展 Plan 元数据，并新增 `expert_team_runs`；
- Turn 成功、失败、停止和 gateway 重启会统一终态化 Plan，并递增终态 revision；
- gateway 已广播 `turn_plan_created/updated/terminalized`，Runtime Snapshot 和
  `turn_completed` 也携带 Plan；
- GUI 已增加 `TurnPlanStore`，聊天计划和右侧 Progress 使用同一 revisioned Plan；
  Store 同时维护每个会话的 current turn cursor，revision 只在同一 `turn_id` 内比较；
- 旧 `task_progress` 与 `team_*` 事件暂时保留为兼容投影，不再作为右侧二次 overlay 的来源。

后续兼容清理只包括删除旧客户端事件及 transcript fallback，不影响本 Spec 的状态所有权。

## 2. 核心结论

系统必须从“多个 UI 分别猜计划”改成“一个 Turn 只有一个权威 Plan Resource”：

```text
User Message
    ↓
PlanPolicyDecision
    ├─ simple          → no plan
    ├─ standard        → runtime-enforced dynamic plan
    └─ expert_team     → runtime-owned fixed plan
                           ↓
                    Turn Plan Resource
                      ├─ SQLite projection
                      ├─ Runtime Snapshot
                      ├─ WebSocket events
                      ├─ Chat plan card
                      └─ Right Progress
```

必须遵循以下原则：

1. 一个 Turn 最多一个当前 Plan。
2. 聊天计划和右侧 Progress 必须读取同一个 Plan Resource。
3. 工具活动 Timeline 不是 Plan，不得反向合成业务计划。
4. 简单任务可以没有计划。
5. 普通复杂任务必须有动态计划。
6. 专家团队任务必须有运行时生成的固定计划。
7. 专家团队阶段推进由后台协调器控制，不依赖模型自觉更新。
8. 模型忘记创建普通复杂任务计划时，runtime 必须阻止复杂工具批次直接执行并要求补计划。
9. Plan 不决定 Turn 是否运行；ActiveTurn 仍是实时运行唯一事实。
10. Turn 终态必须通过统一 barrier 收口 Plan，不允许残留 `running`。

## 3. 产品行为

### 3.1 三类计划策略

| 任务类型 | 是否显示计划 | 计划类型 | 计划所有者 |
| --- | --- | --- | --- |
| 简单任务 | 可以不显示 | `none` | 无 |
| 普通复杂任务 | 必须显示 | `dynamic` | Agent 提议，runtime 校验与持久化 |
| 专家团队任务 | 必须显示 | `workflow` | ExpertTeamRunCoordinator |

计划策略对用户是稳定的产品行为，不应因为模型、provider 或上下文长度变化而随机改变。

### 3.2 简单任务

满足以下条件之一，且没有命中复杂任务强制条件时，可以无计划：

- 问候、确认、感谢；
- 简短解释、定义、翻译或改写；
- 基于已有上下文直接回答；
- 不调用工具的单轮问答；
- 最多一次低风险、只读、低延迟查询，查询结果可直接回答；
- 一次不会生成产物、不会修改状态的简单读取。

示例：

- “什么是自由现金流？”
- “把这句话翻译成英文。”
- “谢谢。”
- “今天上海几点日落？”且只需一次天气查询。

简单任务不得为了形式完整强制显示“分析问题、组织答案”之类空洞计划。

### 3.3 普通复杂任务

满足任一条件，默认必须创建动态计划：

- 预计调用两个及以上业务工具；
- 预计存在两个及以上有意义的执行阶段；
- 需要搜索、读取、交叉核验多个来源；
- 需要生成或转换 PDF、DOCX、XLSX、HTML、图片等 Artifact；
- 需要创建、编辑、重构或验证文件；
- 需要调用子 Agent、后台任务、定时任务或长任务；
- 需要连接器、MCP、Skill 与本地工具协同；
- 用户要求研究、分析、比较、审计、排查、实现、修复或完整方案；
- 存在多个独立交付物；
- 预计耗时超过短查询阈值；
- 用户明确要求先给计划或持续汇报进度。

示例：

- “分析比亚迪 A 股并生成报告。”
- “把上面的报告转成 PDF。”
- “调查项目启动慢的原因。”
- “修改前后端并补测试。”
- “比较三个项目的架构差异。”

普通复杂任务计划应包含 2 至 4 个用户目标级步骤。步骤描述交付物或阶段结果，不得描述工具名：

```text
正确：
1. 明确故障范围与复现条件
2. 定位前后端状态不一致的根因
3. 修复并验证会话恢复流程

错误：
1. 搜索代码
2. 运行 rg
3. 调用工具
4. 执行测试命令
```

### 3.4 专家团队任务

专家团队使用固定工作流计划。计划由 gateway 根据团队定义生成，模型不得创建第二份平行计划。

资产投研团队首版固定展示：

```text
商业分析师 · 段永平视角
财务分析师 · 巴菲特视角
行业研究员 · 芒格视角
风险评估师 · 李录视角
主笔交叉质证与汇总
报告审校与交付
```

若团队定义了分阶段成员，则按团队 manifest 的阶段顺序排列；同一阶段成员可以并行。

固定不等于硬编码某只股票或某个角色。计划由团队定义中的成员和工作流阶段动态生成：

```json
{
  "plan": {
    "member_steps": "from_members",
    "stages": [
      {
        "id": "team-lead",
        "title": "主笔交叉质证与汇总",
        "kind": "synthesis"
      },
      {
        "id": "report-audit",
        "title": "报告审校与交付",
        "kind": "audit"
      }
    ]
  }
}
```

后续新增专家团队可以提供自己的固定阶段，不需要修改 GUI。

## 4. 当前缺陷的确定原因

### 4.1 两套进度来源

当前团队成员进度来自 gateway 的 `team_member_updated`；主笔和审校进度来自模型生成的
`update_task_progress`。右侧再把两套快照进行 overlay。

这会产生以下不变量冲突：

- gateway 知道成员已经完成，但不知道模型是否开始主笔阶段；
- 模型开始写报告，但可能忘记更新计划；
- 模型可能改变计划标题，触发 immutable signature 拒绝；
- GUI 只能选择某一份快照并猜测另一份快照如何覆盖。

### 4.2 最新真实事件证据

在 2026-07-27 的“江丰电子”专家团队 Turn 中：

1. 四位专家全部终态；
2. 持久化团队快照仍为：
   - `team-lead: pending`
   - `report-audit: pending`
3. 主 Agent 实际已经开始汇总和写报告；
4. 后续计划更新改变了 step title，被 runtime 以
   `task-plan ids, order, and titles are immutable within a turn` 拒绝；
5. 最终全终态更新又因 `current_step_id` 指向非 running 步骤被拒绝；
6. v2 只收到 `turn_completed`，没有可靠的阶段中间事件；
7. 右侧因此无法进入主笔阶段。

这证明当前缺陷不是渲染延迟，而是权威阶段事件缺失。

### 4.3 普通任务的随机性

普通任务是否出现计划，目前主要依靠 prompt 要求模型主动调用 `update_task_progress`。
prompt 是软约束，无法保证：

- 每个 provider 都稳定遵守；
- 长上下文中规则不被稀释；
- 重试或工具错误后仍保持相同 plan signature；
- 模型不会先调用业务工具；
- 模型不会把简单任务过度规划；
- 模型不会在复杂任务中完全跳过计划。

因此需要 runtime 级 PlanPolicy 和执行前校验。

## 5. 术语

- **Plan Policy**：本 Turn 是否需要计划以及计划类型的判定结果。
- **Plan Resource**：Turn 级权威计划资源。
- **Dynamic Plan**：普通复杂任务由 Agent 提议、runtime 管理的计划。
- **Workflow Plan**：由专家团队或其他固定工作流定义的计划。
- **Plan Owner**：有权修改计划结构或状态的 runtime 组件。
- **Plan Signature**：step id、顺序和 title 的稳定签名。
- **Plan Revision**：每次状态或公开 note 更新后的单调版本。
- **Business Tool**：会读取外部信息、执行命令、修改文件、调用 MCP/Skill 或创建产物的工具。
- **Trivial Read Tool**：一次低风险、低延迟、只读且可直接回答的查询工具。
- **Team Run Coordinator**：专家团队运行和阶段推进的唯一权威。
- **Plan Projection**：JSONL 事件投影到 SQLite 后的当前 Plan Snapshot。

## 6. 状态所有权

### 6.1 唯一事实来源

| 状态 | 唯一权威 |
| --- | --- |
| Thread 是否 active | `ThreadRuntimeRegistry` |
| Turn 是否 running | `ActiveTurn` |
| 普通任务 Plan | `TurnPlanService` |
| 专家团队 Plan | `ExpertTeamRunCoordinator` |
| 工具调用状态 | Agent runner / tool lifecycle |
| Artifact 状态 | Artifact service |
| GUI 展示 | Runtime Snapshot / Plan Snapshot 的只读投影 |

禁止以下行为：

- GUI 从 tool event 数量猜测 Plan；
- GUI 从消息文本识别“正在汇总”；
- 右侧 Progress 合并团队快照与模型计划；
- 聊天区和右侧各自选择不同的最新计划；
- 专家团队模型通过普通 `update_task_progress` 覆盖 workflow plan；
- Plan 的 `running` 决定 conversation 是否运行。

### 6.2 一个 Turn 一个 Plan

同一 Turn 最多存在一个 current Plan：

```text
turn.plan = None | DynamicPlan | WorkflowPlan
```

团队任务不得同时存在：

- 一份 runtime 团队计划；
- 一份模型的 data-package 计划；
- 一份 GUI overlay 计划。

团队内部的数据准备、成员执行、主笔、审校必须属于同一个 WorkflowPlan。

### 6.3 工具 Timeline 与 Plan 分离

聊天中的 Steps 可以同时包含：

- Plan 卡片；
- narration；
- tool start/end；
- file edit；
- subagent activity；
- Artifact 生成事件。

但 Plan 卡片的步骤状态只来自 Plan Resource。工具 Timeline 仅说明“做了什么”，不能改变
Plan 步骤状态。

## 7. PlanPolicyDecision

### 7.1 数据结构

```python
@dataclass(frozen=True)
class PlanPolicyDecision:
    mode: Literal["none", "dynamic", "workflow"]
    required: bool
    reason: str
    source: Literal[
        "simple_request",
        "request_classifier",
        "first_model_batch",
        "explicit_user_request",
        "expert_team_binding",
        "runtime_promotion",
    ]
    max_steps: int
```

### 7.2 判定时机

Plan Policy 分两阶段判定。

第一阶段：收到用户输入后、调用模型前：

- 绑定专家团队：直接 `workflow + required`；
- 用户明确要求计划：`dynamic + required`；
- 明确 Artifact、文件修改、研究、实现、排查、比较等复杂意图：`dynamic + required`；
- 明确简单问答：`none`；
- 无法可靠判断：`deferred`，进入第二阶段。

第二阶段：模型返回第一批 tool calls 后、执行任何业务工具前：

- 无 tool calls：保持 `none`；
- 只有一个 trivial read tool，且没有 Artifact/修改/子 Agent：允许 `none`；
- 出现多个业务工具、变更工具、Artifact 工具、子 Agent 或后台任务：提升为
  `dynamic + required`；
- 第一批已有合法 Plan：接受；
- 第一批没有 Plan：进入 Plan Enforcement，不执行业务工具。

### 7.3 计划强制矩阵

| 运行行为 | Plan |
| --- | --- |
| 无工具直接回答 | 可无 |
| 一次天气/时间/只读快速查询 | 可无 |
| 两个及以上外部查询 | 必须 |
| Web 搜索后读取多个来源 | 必须 |
| 任意文件写入或编辑 | 必须 |
| 任意 Artifact 生成/转换 | 必须 |
| MCP 与 Skill 组合 | 必须 |
| 子 Agent / 专家团队 | 必须 |
| 后台或长任务 | 必须 |
| 用户明确要求持续汇报 | 必须 |

### 7.4 Runtime Promotion

一个原本判为简单的任务，如果执行过程中出现第二个有意义的业务阶段，runtime 必须将其提升为
动态计划任务。

提升规则：

1. 暂停尚未执行的后续业务工具；
2. 向 Agent 注入结构化 `PLAN_REQUIRED`；
3. Agent 创建覆盖剩余工作的 2 至 4 步计划；
4. runtime 持久化 `turn_plan_created`；
5. 恢复后续工具执行。

已经完成的一次 trivial read 可以体现在计划第一步为 `completed`，但不得伪造未发生的工作。

## 8. 普通任务 Dynamic Plan

### 8.1 创建

动态计划由 Agent 提议，但必须先通过 `TurnPlanService.create()`：

```python
plan = await turn_plan_service.create(
    turn_id=turn.id,
    owner="agent",
    kind="dynamic",
    policy="required",
    steps=steps,
    note=note,
)
```

创建不依赖 GUI 在线。必须先 append journal，再更新 SQLite，再发布 WebSocket。

### 8.2 执行前 Plan Barrier

Agent runner 在执行第一批业务工具前增加 Plan Barrier：

```text
policy.required = false
    => 正常执行

policy.required = true 且 plan 已存在
    => 先提交 plan event，再执行工具

policy.required = true 且 plan 不存在
    => 不执行业务工具
    => 向模型返回 PLAN_REQUIRED
    => 最多自动纠正一次
```

Plan Barrier 属于执行前预检。被 `PLAN_REQUIRED` 拒绝的 business tool 从未真正启动：

- 仍需生成内部 tool result，供模型下一轮补计划和重试；
- 不发布用户可见的 tool start / error 事件；
- 不写入用户可见 Tool Timeline；
- 历史兼容层按同一 `call_id` 的 `[PLAN_REQUIRED]` 终态过滤早期错误发布的 start 事件。

`update_task_progress` 与同一批业务工具同时返回时，runtime 必须把 Plan 更新当作 barrier，
不能并行执行后续工具后再补计划。

### 8.3 更新

普通动态计划更新规则：

- 每次发送完整 step list；
- step id、顺序和 title 默认不可变；
- 非终态快照恰好一个 `running`；
- 全终态快照没有 `running`；
- 只允许状态前进，不允许 `completed -> running`；
- `note` 是公开说明，不得包含 reasoning；
- revision 必须单调递增；
- stale revision 幂等忽略。

### 8.4 合法改版

现实任务可能因用户追加要求或发现新阻塞而改变范围。不能让模型通过悄悄改 title 绕过签名约束。

新增显式操作：

```python
turn_plan_service.rebase(
    turn_id=turn.id,
    expected_revision=revision,
    reason="user_scope_changed" | "runtime_discovery" | "recovery",
    steps=new_steps,
)
```

Rebase 必须：

- 生成 `turn_plan_rebased` 事件；
- 保留旧 revision 在 JSONL；
- SQLite 只保存最新投影；
- 已完成步骤尽可能沿用相同 id；
- 被移除的未完成步骤标为 `skipped`；
- GUI 仍只显示一份当前计划；
- 普通模型不得通过 `update_task_progress` 隐式 rebase。

### 8.5 工具错误

计划更新失败不得让 Agent 陷入重复调用：

- runtime 返回机器可识别错误码，而不是仅返回自然语言；
- 同一错误连续两次时停止继续重试计划工具；
- 如果错误是 stale revision，自动刷新当前 Plan Snapshot；
- 如果错误是 signature mismatch，提示使用 `rebase` 或恢复原签名；
- 如果 Turn 已终态，直接忽略迟到更新。

建议结果：

```json
{
  "ok": false,
  "error_code": "PLAN_SIGNATURE_MISMATCH",
  "current_revision": 3,
  "expected_signature": [
    ["scope", "明确问题范围"],
    ["diagnose", "定位根因"],
    ["verify", "验证修复结果"]
  ]
}
```

## 9. 专家团队 Workflow Plan

### 9.1 Plan 创建

专家团队 Turn 开始时，由 `ExpertTeamRunCoordinator` 在派发成员前创建 WorkflowPlan。

计划结构来自团队 manifest：

```python
plan = coordinator.create_plan(
    turn_id=turn.id,
    run_id=team_run.id,
    members=team.members,
    stages=team.plan.stages,
)
```

Plan owner 为：

```text
expert_team:<team_run_id>
```

专家团队上下文中：

- `update_task_progress` 不负责创建或修改 WorkflowPlan；
- 可以不向主 Agent 暴露该工具；
- 如果兼容期仍暴露，调用返回稳定 no-op：
  `PLAN_RUNTIME_MANAGED`，不得制造 tool error 重试循环。

### 9.2 通用状态机

```text
created
  ↓
member phase 1 running
  ↓
member phase 2 running（如果有）
  ↓
all required member phases terminal
  ↓
synthesis running
  ↓
synthesis completed
  ↓
audit running
  ↓
audit completed
  ↓
delivered
```

失败和取消分支：

```text
member failed
  ├─ 可降级 → member completed-with-warning → 继续
  └─ 不可降级 → workflow failed

synthesis failed
  → audit skipped
  → workflow failed

audit failed
  → deliver blocked 或 completed-with-warning（由团队策略决定）

turn cancelled
  → 所有 running/pending 阶段 interrupted
```

### 9.3 成员阶段推进

不能通过“风险评估师完成”这一特定角色触发主笔。通用条件是：

```text
当前 member phase 的所有成员均为 terminal
    且仍有下一个 member phase
        => 下一 member phase running

所有 member phase 均 terminal
    => synthesis running
```

成员 terminal 包括：

- `completed`
- `failed`，但团队策略允许 Team Lead 降级补齐
- `cancelled`，且整个 Turn 未被用户取消、团队策略允许降级

不可降级失败不进入 synthesis。

### 9.4 主笔开始

主笔开始事件必须在成员结果 bundle 注入主 Agent 之前或同一原子操作中产生：

```text
all members terminal
    → append team_stage_changed(synthesis, running)
    → update Plan revision
    → persist SQLite
    → publish WebSocket
    → inject member result bundle into parent Agent
```

因此只要成员完成，用户应立即看到“主笔交叉质证与汇总”变为 `running`，不需要等待模型下一次
调用计划工具。

### 9.5 审校开始

审校阶段必须由团队协调器的明确 hook 触发，而不是从工具名称或正文猜测。

首版允许以下任一权威 hook：

1. 团队 workflow controller 明确调用 `begin_audit()`；
2. draft report Artifact 完成并进入团队配置要求的 audit pipeline；
3. synthesis 子运行返回结构化 `draft_ready`。

触发顺序：

```text
synthesis completed
    → team_stage_changed(synthesis, completed)
    → team_stage_changed(audit, running)
    → 执行 audit
```

如果当前团队暂时仍由主 Agent 在同一 Run 中完成汇总，必须增加内部
`team_stage_checkpoint`，该 checkpoint 由 runtime 拦截，不作为普通模型计划。

### 9.6 报告交付

团队 WorkflowPlan 完成必须同时满足：

- synthesis 已终态；
- audit 已终态；
- 团队要求的主要 Artifact 已注册；
- final answer 已提交或 ready to commit；
- Turn 尚未失败或取消。

禁止 `team_run_completed` 直接把所有 pending 阶段一律改成 completed。

如果 Turn 成功但某个可选阶段没有执行：

- 阶段标为 `skipped`；
- 公开 note 说明降级原因；
- 不伪造成已完成审校。

## 10. Plan 状态机

### 10.1 Plan Status

```text
absent
created
running
completed
failed
interrupted
```

### 10.2 Step Status

```text
pending
running
completed
error
skipped
interrupted
```

### 10.3 合法状态转换

```text
pending → running
pending → skipped
pending → interrupted

running → completed
running → error
running → skipped
running → interrupted

error → running        仅显式 retry revision
```

禁止：

- `completed → running`
- `skipped → running`
- 同一 revision 出现多个普通串行 running 步骤；
- WorkflowPlan 并行 member phase 被普通“只能一个 running”规则拒绝。

### 10.4 并行语义

现有 `task_progress` 强制非终态恰好一个 running，无法表达专家成员并行。

新 Plan Resource 增加：

```json
{
  "execution": "serial | parallel | staged",
  "active_step_ids": [
    "business-analyst",
    "financial-analyst",
    "industry-researcher",
    "risk-assessor"
  ]
}
```

规则：

- `dynamic + serial`：最多一个 running；
- `workflow + staged`：当前 stage 内可以多个 running；
- `active_step_ids` 必须与 running step 集合一致；
- GUI 不再使用单一 `current_step_id` 表达并行团队。

## 11. Turn 终态收口

### 11.1 成功

普通动态计划：

- 当前 running 有完成证据：`completed`；
- 未执行 pending：`skipped`；
- Plan status：`completed`；
- 不得把所有 pending 自动标 completed。

专家团队计划：

- 以 TeamRunCoordinator 的真实阶段终态为准；
- delivered 后 Plan status 才是 `completed`；
- 未执行的可选阶段为 `skipped`；
- 缺少必要审校或交付时不得伪造 completed。

### 11.2 失败

- 当前 running：`error`；
- 后续 pending：`skipped`；
- Plan status：`failed`；
- 保存 error code 和公开错误摘要。

### 11.3 用户停止

- 所有 running：`interrupted`；
- 所有 pending：`interrupted`；
- 已完成步骤保持 completed；
- Plan status：`interrupted`。

### 11.4 Gateway 重启

- 旧 runtime epoch 的 running/pending 进入 `interrupted`；
- 原因为 `gatewayRestarted`；
- GUI 重连读取 Snapshot 后不得继续动画。

### 11.5 统一终态入口

`turn_completed`、旧 `_turn_end`、异常、取消和 shutdown 必须调用同一个：

```python
await turn_plan_service.terminalize(
    turn_id=turn.id,
    turn_status=turn.status,
    finish_reason=turn.finish_reason,
)
```

专家团队 terminalize 前先调用：

```python
await expert_team_coordinator.finalize_run(...)
```

不得只在 legacy `_turn_end` 路径发送 `team_run_completed`。

## 12. 领域模型

### 12.1 Plan Resource

```typescript
interface TurnPlanResource {
  id: string;
  project_id: string;
  session_id: string;
  turn_id: string;
  kind: 'dynamic' | 'workflow';
  owner: 'agent' | `expert_team:${string}` | 'runtime';
  policy: 'optional' | 'required';
  execution: 'serial' | 'parallel' | 'staged';
  status: 'created' | 'running' | 'completed' | 'failed' | 'interrupted';
  revision: number;
  signature_version: number;
  active_step_ids: string[];
  note?: string;
  steps: TurnPlanStepResource[];
  created_at: number;
  updated_at: number;
  terminalized_at?: number;
  terminalization_reason?: string;
}
```

### 12.2 Step Resource

```typescript
interface TurnPlanStepResource {
  id: string;
  key: string;
  ordinal: number;
  title: string;
  detail?: string;
  kind?: 'goal' | 'member' | 'synthesis' | 'audit' | 'delivery';
  stage_key?: string;
  status: 'pending' | 'running' | 'completed' | 'error' | 'skipped' | 'interrupted';
  warning?: string;
  started_at?: number;
  ended_at?: number;
  updated_at: number;
}
```

### 12.3 Runtime Snapshot

Thread Runtime Snapshot 增加：

```json
{
  "active_turn": {
    "id": "turn_123",
    "status": "inProgress",
    "plan": {
      "id": "plan_123",
      "kind": "workflow",
      "revision": 8,
      "status": "running",
      "active_step_ids": ["team-lead"],
      "steps": []
    }
  }
}
```

Turn 已终态时，`latest_turn.plan` 返回最终 Plan Snapshot。

## 13. 事件协议

### 13.1 标准事件

```text
turn_plan_created
turn_plan_updated
turn_plan_rebased
turn_plan_terminalized
```

专家团队额外提供领域事件：

```text
team_run_started
team_member_updated
team_stage_changed
team_run_terminalized
```

`team_*` 事件先更新 coordinator，再由 coordinator 生成 `turn_plan_updated`。GUI 的计划 UI
只订阅 `turn_plan_*`；团队详情 UI 可以额外订阅 `team_*`。

### 13.2 Event Envelope

```json
{
  "schema_version": 3,
  "event": "turn_plan_updated",
  "event_id": "plan:plan_123:revision:8",
  "event_seq": 108,
  "runtime_epoch": "epoch-id",
  "project_id": "prj_...",
  "session_id": "ses_...",
  "turn_id": "turn_...",
  "plan": {
    "id": "plan_123",
    "revision": 8
  }
}
```

要求：

- 同一 Plan revision 的 event id 稳定；
- revision 只能递增；
- GUI 忽略旧 revision；
- revision gap 触发 Snapshot refresh；
- project/session/turn 必须全链路一致；
- terminal event journal-first，SQLite projection 后再广播。

### 13.3 兼容事件

兼容期继续发送：

- `message` + `agent_ui.kind = task_progress`
- `team_run_started`
- `team_member_updated`
- `team_run_completed`

但兼容 payload 必须由 Plan Resource 投影生成，不得成为第二事实源。

兼容期结束后：

- `agent_ui.task_progress` 只用于旧客户端；
- 新 GUI 不再从 messages 搜索“最新 task_progress”；
- `conversationWorkbenchStore` 不再 overlay team/model snapshots。

## 14. REST API

### 14.1 当前 Turn Plan

```http
GET /api/sessions/{session_key}/turns/{turn_id}/plan
```

响应：

```json
{
  "plan": {},
  "snapshot_revision": 42
}
```

### 14.2 Runtime Snapshot

现有 Session/Thread Runtime Snapshot 直接包含 active/latest Turn 的 Plan，不要求 GUI 再发额外请求。

### 14.3 历史 Plan

```http
GET /api/sessions/{session_key}/turns?include_plan=true
```

用于切换会话和历史恢复。必须校验 ProjectContext。

## 15. SQLite

### 15.1 turn_progress

在现有表基础上增加：

```sql
ALTER TABLE turn_progress ADD COLUMN plan_id TEXT;
ALTER TABLE turn_progress ADD COLUMN kind TEXT
  CHECK (kind IN ('dynamic', 'workflow'));
ALTER TABLE turn_progress ADD COLUMN owner TEXT;
ALTER TABLE turn_progress ADD COLUMN policy TEXT
  CHECK (policy IN ('optional', 'required'));
ALTER TABLE turn_progress ADD COLUMN execution TEXT
  CHECK (execution IN ('serial', 'parallel', 'staged'));
ALTER TABLE turn_progress ADD COLUMN active_step_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE turn_progress ADD COLUMN signature_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE turn_progress ADD COLUMN terminalized_at INTEGER;
ALTER TABLE turn_progress ADD COLUMN terminalization_reason TEXT;
```

### 15.2 turn_steps

增加：

```sql
ALTER TABLE turn_steps ADD COLUMN step_kind TEXT;
ALTER TABLE turn_steps ADD COLUMN stage_key TEXT;
ALTER TABLE turn_steps ADD COLUMN warning TEXT;
```

状态集合扩展为：

```text
pending
running
completed
failed
skipped
interrupted
cancelled
```

API 对 GUI 将 `failed` 映射为 `error`，或统一升级协议枚举，不能在不同组件中各自转换。

### 15.3 Expert Team Run

建议新增：

```sql
CREATE TABLE expert_team_runs (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL,
  session_id            TEXT NOT NULL,
  turn_id               TEXT NOT NULL,
  team_id               TEXT NOT NULL,
  plan_id               TEXT NOT NULL,
  status                TEXT NOT NULL,
  current_stage_key     TEXT,
  warning_count         INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  terminalized_at       INTEGER,
  terminalization_reason TEXT,
  UNIQUE(turn_id, team_id),
  FOREIGN KEY(session_id, project_id)
    REFERENCES sessions(id, project_id),
  FOREIGN KEY(turn_id, project_id)
    REFERENCES turns(id, project_id)
);
```

成员运行继续保存父子 Turn/Task 关系，不在 GUI 本地持久化。

### 15.4 Projector

SQLite projector 必须：

- 幂等应用 event id；
- 拒绝 revision 回退；
- 校验 Plan owner；
- 校验 DynamicPlan 串行 running 数量；
- 校验 WorkflowPlan 当前 stage 的并行 running 集合；
- terminal revision 后拒绝普通更新；
- 不再跳过团队 Plan，而是把 workflow plan 投影为 canonical turn plan；
- 保证 project/session/turn 外键一致。

## 16. GUI 架构

### 16.1 单一 Store

新增或重构为：

```typescript
interface TurnPlanState {
  planByTurnId: Record<string, TurnPlanResource>;
  applyPlanSnapshot(plan: TurnPlanResource): void;
  clearSession(sessionId: string): void;
}
```

`chatStore` 保存 active/latest Turn 引用；`TurnPlanStore` 保存 Plan 镜像。

删除以下逻辑：

- 从 messages 中寻找最新 `agentUI.task_progress`；
- `conversationWorkbenchStore` 的 team snapshot 优先选择；
- model plan 对 Team Lead/audit 的 overlay；
- 聊天 Timeline 自己构建另一份 expert projection；
- terminal 时在两个组件分别修改计划状态。

### 16.2 聊天区

聊天中的计划卡：

- 通过 message/turn item 中的 `plan_id` 定位 Plan；
- 使用共享 `PlanViewModel`；
- 可以显示首次计划和当前状态；
- 历史 revision 不重复渲染成多个业务计划；
- 若产品需要展示“计划已更新”，显示 revision note，而不是复制整张计划。

### 16.3 右侧 Progress

右侧：

- 使用同一个 `PlanViewModel`；
- 显示当前 revision；
- 不读取 tool events；
- 不读取 reasoning 或 assistant 文本；
- 不对团队成员和主笔状态做额外推断；
- active Turn 无计划且 policy 仍在判定时显示“正在制定任务计划”；
- policy=`none` 时显示紧凑空状态，不显示错误。

### 16.4 共享组件

建议：

```text
src/components/progress/PlanSteps.tsx
src/components/progress/PlanStepIcon.tsx
src/core/nanobot/planViewModel.ts
src/stores/turnPlanStore.ts
```

聊天和右侧只允许布局不同，状态颜色、文案、终态和步骤顺序必须一致。

### 16.5 会话切换与恢复

切换会话：

1. 读取 Session Snapshot；
2. 读取 active/latest Turn；
3. 应用 Plan Snapshot；
4. 渲染聊天和右侧；

同一会话开始新 Turn 时：

1. `turn_started` 先把 current turn cursor 切换到新 `turn_id`，立即移除上一 Turn 的右侧计划；
2. active Turn 尚无 Plan 时不得回退到 `latest_turn.plan`；
3. 新 Turn 的 revision 可以从 1 重新开始；
4. 旧 Turn 迟到的 Plan 事件不得覆盖 current Turn；
5. 旧 Turn 计划只保留在聊天历史中。
6. WebSocket 增量只更新更高 revision。

禁止复用上一个会话的 Plan。

## 17. 普通任务无计划的展示

Plan policy 尚未决策且 Turn active：

```text
正在制定任务计划
```

Plan policy 明确为 `none`：

- 右侧 Progress 使用紧凑空状态；
- 聊天不插入计划卡；
- 工具 Timeline 仍可显示一次 trivial read；
- Turn 正常结束。

Plan policy 为 required 但超过纠正次数仍无 Plan：

- 不继续执行复杂业务工具；
- Turn 失败码：`PLAN_REQUIRED_NOT_CREATED`；
- GUI 显示“未能建立任务计划”，而不是永久“正在制定”。

## 18. 安全与隔离

- Plan 必须带 `project_id/session_id/turn_id`；
- 所有 Plan API 校验 Session 属于当前 Project；
- 专家成员不得写入另一个 Project 的 Plan；
- GUI 不接受缺少 project/session identity 的跨会话 Plan event；
- Plan title/note 不得包含 API key、Authorization、cookie 或私有 reasoning；
- 工具参数和绝对敏感路径不得复制进 Plan detail；
- 历史 Project 切换后不展示其他 Project 的 Plan。

## 19. 可观测性

### 19.1 结构化日志

```text
plan_policy_decided
plan_required_missing
plan_created
plan_updated
plan_rebased
plan_update_rejected
team_stage_changed
plan_terminalized
plan_snapshot_recovered
```

字段至少包括：

```text
project_id
session_id
turn_id
plan_id
plan_kind
plan_owner
revision
policy_reason
stage_key
error_code
runtime_epoch
```

### 19.2 指标

- `plan_required_turn_total`
- `plan_created_before_business_tool_ratio`
- `plan_required_missing_total`
- `plan_update_rejected_total{reason}`
- `expert_team_stage_duration_ms{stage}`
- `plan_terminalization_latency_ms`
- `plan_snapshot_revision_gap_total`
- `turn_completed_with_running_plan_total`
- `gui_plan_source_fallback_total`

目标：

- required 复杂任务在业务工具前创建计划的比例为 100%；
- completed Turn 残留 running Plan 为 0；
- 专家成员结束到 synthesis running 的 P95 小于 300ms；
- 聊天和右侧 Plan revision 不一致为 0。

## 20. 错误码

```text
PLAN_REQUIRED
PLAN_REQUIRED_NOT_CREATED
PLAN_ALREADY_EXISTS
PLAN_RUNTIME_MANAGED
PLAN_SIGNATURE_MISMATCH
PLAN_REVISION_STALE
PLAN_INVALID_TRANSITION
PLAN_MULTIPLE_RUNNING_STEPS
PLAN_ACTIVE_STAGE_MISMATCH
PLAN_ALREADY_TERMINAL
TEAM_STAGE_INVALID_TRANSITION
TEAM_REQUIRED_MEMBER_FAILED
TEAM_AUDIT_REQUIRED
```

错误必须是结构化数据。自然语言仅作为用户可读补充。

## 21. 兼容与迁移

### Phase A：Plan Resource 与 Snapshot

- 扩展 SQLite schema；
- 引入 `TurnPlanService`；
- 将现有 `update_task_progress` 写入 Plan Resource；
- Runtime Snapshot 返回 Plan；
- 新增 `turn_plan_*` 事件；
- 保持旧 `agent_ui.task_progress` 投影。

### Phase B：GUI 单一投影

- 新增 `turnPlanStore`；
- 聊天与右侧切换到共享 Plan ViewModel；
- 删除 `conversationWorkbenchStore` 的 team/model overlay；
- 删除 `taskNarrativeTimeline` 的独立 expert stage projection；
- 保留旧 transcript fallback 并增加 telemetry。

### Phase C：普通任务 PlanPolicy

- 实现两阶段 classifier；
- 加入 Plan Barrier；
- 允许简单任务无计划；
- required 缺失时自动纠正一次；
- 增加显式 rebase；
- 移除依赖 prompt 的随机行为。

### Phase D：专家团队 Coordinator

- 团队 manifest 增加 plan stages；
- 团队 Turn 开始时创建 WorkflowPlan；
- 成员阶段完成后自动进入 synthesis；
- synthesis 完成后自动进入 audit；
- `turn_completed` 与 legacy `_turn_end` 共用团队终态收口；
- 专家团队不再调用普通计划工具。

### Phase E：兼容清理

- 新 GUI 不再读取 message-derived Plan；
- 旧 task_progress 只作为 wire compatibility；
- 移除重复 team-run plan card；
- 移除前端终态猜测；
- 清理旧的 `current_step_id` 并行团队假设。

## 22. 预计代码改动

### 22.1 nanobot

建议新增：

```text
nanobot/runtime/plan_policy.py
nanobot/runtime/turn_plan.py
nanobot/runtime/expert_team_run.py
nanobot/bus/plan_events.py
```

建议修改：

```text
nanobot/agent/loop.py
nanobot/agent/runner.py
nanobot/agent/subagent.py
nanobot/agent/tools/task_progress.py
nanobot/channels/websocket.py
nanobot/session/webui_turns.py
nanobot/storage/state.py
nanobot/webui/transcript.py
nanobot/webui/expert_teams.py
nanobot/webui/gateway_services.py
```

### 22.2 nanobot-gui

建议新增：

```text
src/stores/turnPlanStore.ts
src/core/nanobot/planViewModel.ts
src/components/progress/PlanSteps.tsx
src/components/progress/PlanStepIcon.tsx
```

建议修改：

```text
src/core/types.ts
src/core/nanobotClient.ts
src/hooks/useNanobotStream.ts
src/components/chat/TaskNarrativeTimeline.tsx
src/components/panel/ConversationWorkbench.tsx
src/stores/conversationWorkbenchStore.ts
src/stores/chatStore.ts
```

## 23. 测试方案

### 23.1 PlanPolicy 单元测试

必须覆盖：

1. 问候无计划；
2. 直接解释无计划；
3. 一次 trivial read 无计划；
4. 两次外部查询强制计划；
5. 文件写入强制计划；
6. PDF 转换强制计划；
7. 子 Agent 强制计划；
8. 专家团队直接 workflow plan；
9. 简单任务中途升级为复杂任务；
10. required 缺失后自动纠正；
11. 自动纠正失败后明确终止。

### 23.2 Dynamic Plan 测试

1. 第一批 Plan 在业务工具之前提交；
2. id/title/order 稳定；
3. stale revision 被忽略；
4. signature mismatch 返回结构化错误；
5. 合法 rebase 保留已完成步骤；
6. repeated plan error 不无限重试；
7. 成功 Turn 不残留 running；
8. failed/interrupted 状态正确。

### 23.3 Expert Team 测试

1. 团队开始即创建固定计划；
2. 四位成员并行 running 合法；
3. 任意成员先完成不提前进入主笔；
4. 所有成员终态后 300ms 内主笔 running；
5. 成员失败但允许降级时继续主笔；
6. 不可降级失败时团队失败；
7. 主笔完成后审校 running；
8. 审校完成且 Artifact ready 后 delivered；
9. `turn_completed` 必须 terminalize team run；
10. legacy `_turn_end` 不制造第二个终态；
11. gateway 重启收口团队运行；
12. 专家团队普通计划工具不覆盖 WorkflowPlan。

### 23.4 SQLite 与恢复测试

1. journal replay 恢复相同 Plan；
2. revision gap 后 Snapshot 一致；
3. project/session/turn 外键隔离；
4. 团队 Plan 不再被 projector 跳过；
5. terminal Plan 拒绝迟到更新；
6. 当前 runtime epoch 外的 running 被 interrupted；
7. 同一 Turn 不出现两个 Plan。

### 23.5 GUI 测试

1. 聊天和右侧展示相同 plan id/revision；
2. 普通复杂任务两边同时出现计划；
3. 简单任务两边都没有计划；
4. 专家成员完成后两边同时进入主笔；
5. 主笔完成后两边同时进入审校；
6. 切换会话不串计划；
7. 重连后由 Snapshot 修正本地状态；
8. terminal 后不残留动画；
9. pending 未执行步骤显示 skipped，不显示 completed；
10. tool activity 不进入右侧 Progress；
11. 旧 transcript fallback 正常；
12. Artifact、reasoning、narration 和互动提问不回归。

### 23.6 真实回归任务

必须用真实任务验证：

- 简单解释；
- 一次天气查询；
- 普通联网研究；
- PDF 转换；
- 前后端 Bug 修复；
- 资产投研团队完整报告；
- 一个成员失败并降级的投研；
- 用户中途停止专家团队；
- gateway 在主笔阶段重启；
- 会话切换后重新打开。

## 24. 验收标准

1. 简单无工具问答不显示形式化计划。
2. 单次 trivial read 可以无计划并正常结束。
3. 普通复杂任务在第一个业务工具执行前必须存在 Plan。
4. 普通复杂任务默认 2 至 4 个用户目标级步骤。
5. 专家团队在 Turn 开始时立即存在固定 WorkflowPlan。
6. 聊天计划和右侧 Progress 的 `plan_id/revision/steps/status` 完全一致。
7. 所有专家成员终态后 300ms 内进入主笔阶段。
8. 主笔阶段不依赖模型调用 `update_task_progress`。
9. 审校阶段不从工具名或文本启发式推断。
10. `turn_completed` 与旧 `_turn_end` 都经过同一个 Plan/Team terminal barrier。
11. 成功、失败、取消、重启后均不残留 running。
12. 未执行步骤不得伪装成 completed。
13. 普通任务不受专家团队 coordinator 影响。
14. 新增专家团队无需修改 GUI 即可展示其固定计划。
15. Project A 的 Plan 不会出现在 Project B。
16. 刷新、重连、切换会话后 Plan 与执行前一致。
17. 计划工具错误不会进入无限重试。
18. GUI 不再合并多个独立计划快照。
19. SQLite 中每个 Turn 最多一个 current Plan。
20. 相关 Python、Vitest 和 production build 全部通过。

## 25. 明确不采用的方案

### 25.1 只加强 prompt

不采用。prompt 是软约束，无法保证所有 provider 和长上下文稳定遵守。

### 25.2 GUI 根据工具调用自动生成业务计划

不采用。工具名不能可靠表达用户目标，容易把“搜索、读取、写文件”误当成计划。

### 25.3 右侧继续 overlay 团队快照和模型计划

不采用。两个来源没有统一 revision、owner 和状态机，必然继续分叉。

### 25.4 Turn 结束时把所有步骤改成 completed

不采用。未执行的步骤必须是 skipped/interrupted/error，不能伪造完成。

### 25.5 所有任务强制计划

不采用。简单问答和单次 trivial read 不需要计划，避免 UI 噪音和额外延迟。

### 25.6 为专家团队硬编码“风险评估师完成后进入主笔”

不采用。通用触发条件是所有必要 member phase 终态，角色名称和成员数量来自团队定义。

## 26. 实施顺序建议

建议严格按以下顺序实施：

1. 先建立 Plan Resource、事件和 SQLite 投影；
2. 再让聊天和右侧读取同一个 Plan Store；
3. 然后实现专家团队 Coordinator，消除当前直接缺陷；
4. 再实现普通任务 PlanPolicy 和 Plan Barrier；
5. 最后删除旧 overlay、消息扫描和 legacy 猜测。

不能先在 GUI 增加“成员完成后把 Team Lead 设为 running”的局部补丁。该补丁虽然能暂时改善
显示，但仍然没有后台权威、无法恢复、无法处理失败和分阶段团队，并会继续扩大多事实源问题。

## 27. 最终架构摘要

```text
请求分类
    ├─ simple
    │    └─ no plan
    │
    ├─ ordinary complex
    │    └─ Agent proposal
    │         ↓
    │       TurnPlanService
    │         ↓
    │       DynamicPlan
    │
    └─ expert team
         └─ ExpertTeamRunCoordinator
              ↓
            WorkflowPlan

DynamicPlan / WorkflowPlan
          ↓
append-only JSONL
          ↓
SQLite current projection
          ↓
Runtime Snapshot + revisioned WS event
          ↓
shared TurnPlanStore
      ├─ Chat Plan Card
      └─ Right Progress
```

最终用户体验应当稳定为：

- 简单任务：没有多余计划；
- 普通复杂任务：一定有清晰、动态推进的计划；
- 专家团队任务：一定有固定、连续推进的团队计划；
- 聊天和右侧永远展示同一份计划；
- 任务成功、失败、取消或重启后都有真实终态。
