# 显式用户记忆与持久个人档案 Spec

> 状态：Proposed
> 目标版本：TPCowork 0.6.x
> 适用范围：`nanobot` gateway、Session Event Journal、`state.sqlite`、Dream、`USER.md`、上下文构建、记忆工具及 GUI 管理入口
> 解决问题：用户明确说“请记住……”后无法立即持久化，重启或切换会话后丢失
> 最后更新：2026-08-04

## 1. 文档目的

当前 TPCowork 已经具备全局 `USER.md`、Dream、项目记忆、历史归档和临时
`my` scratchpad，但缺少一条“用户明确要求记住后，立即、可靠、可撤销地写入长期个人
记忆”的正式链路。

本 Spec 解决以下问题：

1. 用户说“请你记住我叫王耀彬”，Agent 不应回答“只能记在当前上下文”。
2. 明确记忆请求不应等待上下文压缩或两小时一次的 Dream 才可能生效。
3. 不应通过开启 `tools.my.allow_set` 修复，因为 `my` 是进程内临时 scratchpad。
4. 用户身份和通用偏好应跨会话、跨项目生效，但项目资料仍必须严格隔离。
5. 记忆写入、修改和遗忘必须可追踪、可重放、可恢复，不能只改一个 Markdown 文件。
6. Dream 失败、关闭或延迟时，已经确认的用户事实仍应立即可用。

本期不实现 Project RAG 向量化深度能力，也不把所有聊天内容自动转成个人记忆。

## 2. 当前架构核查

### 2.1 当前四类“记忆”能力

| 机制 | 当前存储 | 触发方式 | 生命周期 | 适用内容 |
| --- | --- | --- | --- | --- |
| 全局个人档案 | `USER.md` | Dream 后台整理或人工编辑 | 跨会话、跨重启 | 用户身份、稳定偏好 |
| 全局长期记忆 | `memory/MEMORY.md`、`memory_summary.md` | 历史归档后由 Dream 整理 | 跨会话、跨重启 | 非项目型长期知识 |
| 项目记忆 | `project_memories`、项目 memory 文件 | 项目会话稳定后 Phase 1/2 | 仅当前项目 | 项目事实、决策、资料 |
| 临时 scratchpad | `my` tool 进程内 Map | Agent 调用 `my set` | 仅当前进程 | 当前任务的临时变量 |

这些能力分别有合理用途，但不能互相替代。

### 2.2 全局记忆链路

当前 `MemoryStore` 管理：

```text
<workspace>/USER.md
<workspace>/SOUL.md
<workspace>/memory/MEMORY.md
<workspace>/memory/memory_summary.md
<workspace>/memory/history.jsonl
<workspace>/memory/.cursor
<workspace>/memory/.dream_cursor
```

`ContextBuilder` 每轮把 `AGENTS.md`、`SOUL.md`、`USER.md` 注入上下文，并按
token 预算注入长期记忆摘要与近期 history。因此，只要 `USER.md` 已正确更新，用户名字
可以跨会话使用。

问题在于：普通 Agent 没有一个受控的、立即写入用户档案的运行时工具。

### 2.3 Dream 链路

Dream 当前是定时后台维护机制：

```text
旧消息因 token/idle 被归档
        │
        ▼
memory/history.jsonl
        │  每隔约 2 小时，且存在未处理 history
        ▼
Dream 独立 Agent
        │
        ├─ Edit USER.md
        ├─ Edit SOUL.md
        └─ Edit MEMORY.md
```

Dream 能整理 `USER.md`，但不适合作为显式记忆请求的提交事务：

- 短会话未触发压缩时，请求可能还没进入 `history.jsonl`。
- Dream 是周期任务，无法保证本轮结束前完成。
- Dream 失败或关闭时，事实不会立即生效。
- Dream 的输入是摘要/截断历史，不是结构化、幂等的记忆变更事件。

### 2.4 项目记忆链路

项目记忆采用两阶段流水线：

```text
Project Session stable revision
        │
        ▼
project_memory_stage1
        │
        ▼
Phase 2 consolidate
        │
        ├─ project_memories（SQLite）
        ├─ 项目 MEMORY.md / summary
        └─ provenance / usage / source revision
```

该链路具备项目身份校验、lease、重试、来源追踪和项目隔离，适合“这个项目采用
某种口径”等项目事实，不适合“我叫王耀彬”这类全局个人身份。

即使明确记忆请求发生在 `nihao` 项目中，用户名字也应写入全局个人档案；项目研究资料
则只能进入 `nihao` 的项目记忆。

### 2.5 `my` 工具现状

`my` 工具目前默认：

```text
tools.my.enable = true
tools.my.allow_set = false
```

它的写入内容只保存在进程内，重启即丢失。当前技能描述中同时出现“记忆用户偏好”和
“仅内存、重启清空”的表述，容易诱导模型把长期记忆请求错误路由到 `my set`。

此外，计划策略会把未知写工具视为复杂业务工具，因此一次原子的“记住名字”也可能先
被要求创建计划，交互成本不合理。

### 2.6 SQLite 现状

`state.sqlite` 已有项目记忆表：

- `project_memories`
- `project_memory_stage1`
- `project_memory_jobs`
- `project_memory_sources`

但目前没有全局用户档案事实表。`USER.md` 是最终提示词输入之一，却同时承担了人类可读
文件和事实权威两个职责，缺少结构化版本、来源、幂等键和遗忘状态。

## 3. 当前缺陷的实际根因

“请你记住我叫王耀彬”这轮请求的实际执行路径为：

```text
用户明确要求记住名字
        │
        ▼
模型选择 my(action="set", key="user_name", value="王耀彬")
        │
        ├─ 第一次：被计划策略拒绝，返回 PLAN_REQUIRED
        └─ 第二次：tools.my.allow_set=false，写入失败
        │
        ▼
Agent 回答“长期记忆能力被禁用”
```

同期状态还显示：

- 当前 `USER.md` 中 `Name` 仍是未提供。
- 该轮请求尚未进入 Dream 的待处理 history。
- 即使开启 `my set`，重启后仍会丢失，因此不是正确修复。

根因不是“Dream 没开”，而是缺少显式长期用户事实的提交 API 和工具。

## 4. 目标与非目标

### 4.1 目标

1. 用户明确要求记住的低风险身份或偏好，在本轮内持久化并立即进入上下文。
2. 记忆在新会话、其他项目和应用重启后仍可用。
3. 所有写入先进入 Canonical Session Event Journal，再投影到 SQLite。
4. SQLite 是当前可查询状态权威；`USER.md` 是兼容且人类可读的物化投影。
5. 支持修改、覆盖、遗忘、来源追踪、幂等重放和数据库重建。
6. 全局个人事实与项目事实有清晰且 fail-closed 的分类边界。
7. 原子记忆操作不要求创建任务计划。
8. 不记录密码、API Key、验证码等秘密。

### 4.2 非目标

- 不实现 Project RAG 的向量检索。
- 不自动把每句话都写入个人档案。
- 不保存模型的私有思维链。
- 不允许普通 Agent 直接任意编辑 `USER.md`。
- 不把 `my` scratchpad 改造成持久数据库。
- 不把项目材料、项目产物或项目结论提升为全局个人事实。

## 5. 核心设计决策

### 5.1 单一事实源

显式用户记忆采用与统一会话架构一致的四层模型：

```text
可重放变更事实       Session Event Journal
当前有效个人档案     state.sqlite / user_profile_facts
人类可读兼容投影     USER.md
后台归纳与清理       Dream
```

优先级为：

```text
当前用户输入
  > SQLite 中 active 的显式个人事实
  > USER.md 物化投影
  > Dream 推断的长期摘要
  > 项目记忆或模型推断
```

SQLite 不代替 Journal。Journal 负责审计和重建，SQLite 负责运行时查询，`USER.md` 负责
可读性与旧模板兼容。

### 5.2 全局事实与项目事实边界

| 内容 | 归属 | 示例 |
| --- | --- | --- |
| 用户身份 | 全局个人档案 | 我叫王耀彬 |
| 通用交互偏好 | 全局个人档案 | 回答尽量使用中文 |
| 长期稳定习惯 | 全局个人档案 | 默认使用 24 小时制 |
| 某项目的决策 | 项目记忆 | nihao 项目统一使用聚源口径 |
| 某项目的文件与结论 | 项目记忆/产物 | 安集科技报告、审计结论 |
| 当前轮临时值 | `my` scratchpad | 本轮筛选阈值为 15% |

分类无法确定时不得擅自写入全局档案。模型应询问用户，或仅保留在当前会话。

全局个人档案可以在所有项目中读取，但项目记忆查询始终必须携带 `project_id`。引入全局
个人档案不改变任何项目文件、产物、会话和检索隔离规则。

## 6. 数据模型

在 `state.sqlite` 增加 `user_profile_facts`：

```sql
CREATE TABLE user_profile_facts (
    fact_id             TEXT PRIMARY KEY,
    profile_id          TEXT NOT NULL DEFAULT 'default',
    fact_key            TEXT NOT NULL,
    value_json          TEXT NOT NULL,
    value_type          TEXT NOT NULL DEFAULT 'string',
    category            TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'active',
    sensitivity         TEXT NOT NULL DEFAULT 'normal',
    confidence          REAL NOT NULL DEFAULT 1.0,
    source_session_id   TEXT,
    source_turn_id      TEXT,
    source_event_id     TEXT NOT NULL,
    revision            INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    UNIQUE(profile_id, fact_key)
);

CREATE INDEX idx_user_profile_facts_active
ON user_profile_facts(profile_id, status, category, updated_at);
```

字段约束：

- `fact_key` 使用稳定命名，例如 `identity.name`、`preference.language`、
  `preference.time_format`。
- `value_json` 支持字符串、布尔值和短列表，不允许存储任意大段文档。
- `category` 第一版只允许 `identity`、`preference`、`habit`、
  `communication_style`。
- `status` 只允许 `active`、`forgotten`、`superseded`、`pending_review`。
- 明确用户陈述的 `confidence=1.0`；模型推断不得直接进入 active 表。
- `source_event_id` 用于幂等投影。
- 不在数据库另存一份完整聊天文本；来源内容通过 session/turn/event 关联查询。

增加投影状态表：

```sql
CREATE TABLE user_profile_projection_state (
    profile_id          TEXT PRIMARY KEY,
    projected_revision  INTEGER NOT NULL DEFAULT 0,
    projected_at        TEXT,
    last_error          TEXT
);
```

该表只表示 `USER.md` 物化进度，不影响事实是否已经生效。

## 7. Canonical Event

增加两类 required runtime event：

```text
user_profile_fact_upserted
user_profile_fact_forgotten
```

`user_profile_fact_upserted` payload：

```json
{
  "fact_id": "upf_...",
  "profile_id": "default",
  "fact_key": "identity.name",
  "value": "王耀彬",
  "value_type": "string",
  "category": "identity",
  "revision": 1,
  "source": "explicit_user_request"
}
```

提交顺序必须为：

```text
validate request
  -> append canonical event
  -> fsync/commit journal
  -> SQLite idempotent projection
  -> refresh in-process profile snapshot
  -> return tool success
```

禁止先写 SQLite 再补 Journal。SQLite 投影失败时本轮不得宣称“已经记住”；系统应重放
已提交事件完成投影，并向 Agent 返回可恢复错误。

事件必须带现有统一身份字段：

- `project_id`
- `session_id`
- `turn_id`
- `event_id`
- `event_seq`
- `revision`
- `runtime_epoch`

这里的 `project_id` 只表示记忆请求发生位置，不把该事实变成项目事实。

## 8. Agent 工具

### 8.1 新增 `user_memory` 工具

建议增加一个受控工具，而不是复用 `my`：

```text
user_memory(action="remember", key="identity.name", value="王耀彬")
user_memory(action="forget", key="identity.name")
user_memory(action="list")
```

第一版参数：

```ts
type UserMemoryAction = "remember" | "forget" | "list"

interface UserMemoryInput {
  action: UserMemoryAction
  key?: string
  value?: string | boolean | string[]
  category?: "identity" | "preference" | "habit" | "communication_style"
}
```

工具通过 `RequestContext` 取得 session、turn、project、trace 身份，并调用统一
`SessionEventService`；工具本身不得直接写文件或绕过 Journal 修改 SQLite。

### 8.2 调用规则

必须调用：

- “请记住我叫王耀彬。”
- “以后默认用中文回答，记住这个偏好。”
- “忘掉我之前告诉你的名字。”

不得自动调用：

- 一次性任务参数。
- 从项目报告中推测出的用户身份。
- 模型自行推断的政治、宗教、健康、财务等敏感属性。
- 密码、验证码、Cookie、Token、API Key、私钥。

明确要求记忆但内容属于秘密时，工具应拒绝并解释安全原因，不能把秘密退回 `my` 或
`USER.md`。

### 8.3 计划策略

`user_memory remember/forget` 是单一、原子、低风险的用户授权修改，应加入
`_ATOMIC_MUTATION_TOOLS`，不触发 `PLAN_REQUIRED`。

它仍然要经过：

- 参数校验
- 敏感信息拦截
- canonical event commit
- SQLite 投影确认
- trace 记录

批量修改多个无关档案字段或执行导入时仍可要求计划或用户确认。

### 8.4 Skill 与系统提示词修正

需要同步修正现有描述：

1. `my` skill 明确为“当前进程/当前任务 scratchpad”，删除“长期记忆用户偏好”的描述。
2. `my` tool description 不再把“remember a preference”列为 set 示例。
3. `memory` skill 增加显式路由：用户明确要求跨会话记住时使用 `user_memory`。
4. `AGENTS.md`/系统提示词说明：普通 Agent 不直接编辑 `USER.md`。
5. Dream 继续维护 Markdown 投影和归纳内容，但不承担显式写入的提交职责。

## 9. 上下文注入

`ContextBuilder` 增加 `get_user_profile_context(profile_id)`：

```text
## Confirmed user profile
- Name: 王耀彬
- Preferred language: Chinese
```

要求：

- 只读取 `status=active` 的事实。
- 使用稳定字段顺序，避免 prompt cache 无意义抖动。
- 第一版最多 100 条、总计不超过约 2,000 tokens。
- 超限时优先 identity、communication_style，再按最近使用/更新时间选择。
- 不把 source id、内部 revision 等元数据暴露给模型。
- 同一轮 remember 成功后刷新快照，下一次模型迭代即可读取，不等待新会话。
- 新会话和应用重启直接从 SQLite 恢复。

`USER.md` 与 SQLite 暂时同时注入时，模板必须标明 SQLite confirmed facts 优先，避免旧
`USER.md` 中 `Name: (not provided)` 覆盖已确认名字。

## 10. Dream 与 USER.md 的新职责

### 10.1 `USER.md` 降为物化投影

目标状态下：

- SQLite `user_profile_facts` 是当前有效个人事实权威。
- `USER.md` 是人类可读、Git 可追踪、兼容旧 prompt 的物化视图。
- Dream 读取 active facts，并把它们合并到 `USER.md` 的受管区域。
- Dream 失败不会撤销或隐藏 SQLite 中已确认的事实。

建议受管区格式：

```markdown
<!-- BEGIN TPCOWORK MANAGED USER PROFILE -->
## Confirmed profile

- Name: 王耀彬
- Preferred language: 中文
<!-- END TPCOWORK MANAGED USER PROFILE -->
```

受管区域之外的用户手写内容予以保留。

### 10.2 物化时机

触发条件：

1. `user_profile_fact_upserted/forgotten` 后异步调度轻量 materialize job。
2. Dream 周期运行时兜底检查 projection revision。
3. 启动恢复发现 revision 落后时重试。

不要求每次工具调用同步等待文件和 Git 提交完成。工具成功的必要条件是 Journal 与
SQLite 已提交；`USER.md` 可短暂延迟，但必须可观测和可重试。

### 10.3 Dream 推断内容

Dream 可以把反复出现的非敏感偏好生成为 `pending_review` 候选，但不得静默提升为
active confirmed fact。第一版可以完全不启用自动候选，先只支持明确用户请求。

## 11. API 与 GUI

Gateway 增加：

```text
GET    /api/profile/memories
POST   /api/profile/memories
DELETE /api/profile/memories/{fact_key}
POST   /api/profile/memories/materialize
```

响应至少包含：

- `fact_id`
- `fact_key`
- `value`
- `category`
- `status`
- `revision`
- `source_session_id`
- `source_turn_id`
- `updated_at`
- `projection_status`

Phase A-C 的运行时修复不依赖新增 GUI。后续可在“系统设置/个人记忆”增加轻量列表，支持：

- 查看已确认事实
- 修改或遗忘某一事实
- 查看来源会话
- 手动重试 `USER.md` 物化

GUI 只能调用 gateway API，不得把个人记忆另存到 Zustand/localStorage 作为第二事实源。

## 12. 迁移与兼容

### 12.1 数据库迁移

- `STATE_SCHEMA_VERSION` 增加一个版本。
- 使用现有幂等 migration/ensure schema 风格创建新表和索引。
- 老版本 gateway 读取新 Journal event 时应安全忽略未知类型，不破坏会话读取。

### 12.2 现有 USER.md 导入

首次升级时：

1. 读取现有 `USER.md`。
2. 只导入能由稳定字段明确解析的低风险事实。
3. 无法结构化解析的内容继续保留在 Markdown，不擅自转成 active fact。
4. 导入成功前不覆盖旧文件。
5. 记录 migration watermark，避免每次启动重复导入。

### 12.3 历史会话回填

第一版不全盘扫描历史会话推断个人信息。可选的后续修复工具只能检索带明确意图词
“请记住/记住我/remember”的用户原文，并在写入前让用户确认。

### 12.4 `my` 兼容

- 保持 `tools.my.allow_set=false` 默认值。
- 不迁移 `my` 进程内内容，因为它没有可靠来源和持久语义。
- 旧模型仍调用 `my set` 时，错误信息应明确提示改用 `user_memory`，而不是泛化为
  “长期记忆被禁用”。

## 13. 故障语义

| 故障 | 行为 |
| --- | --- |
| Journal 写入失败 | 工具失败，不写 SQLite，不宣称记住 |
| Journal 成功、SQLite 失败 | 工具返回可恢复错误；后台按 event 重放投影 |
| SQLite 成功、USER.md 失败 | 记忆立即生效；记录 projection error 并异步重试 |
| Dream 关闭 | 显式事实仍立即生效；仅 Markdown 归纳可能延迟 |
| SQLite 不可用 | fail closed，不退回直接编辑 USER.md 或 `my` |
| 重复 event | 依靠 `source_event_id`/revision 幂等，不重复累加 |
| 同 key 新值 | revision 加一，旧值被覆盖；Journal 保留完整审计 |
| 用户要求遗忘 | 提交 forgotten event，立即从上下文移除，再更新 USER.md |

## 14. 安全与隐私

1. 默认只接受低风险、用户明确授权的个人事实。
2. 对秘密类内容执行拒绝，不记录原始秘密到业务日志。
3. 结构化日志仅输出 `fact_id`、`fact_key`、revision、status，不输出敏感 value。
4. 删除/遗忘后，运行时上下文和 SQLite active read model 立即不再返回该值。
5. Journal 为审计与恢复记录；若产品需要不可恢复删除，必须另行设计加密密钥擦除或
   compaction，不在本期用“删除 SQLite 行”假装彻底擦除。
6. 项目导出默认不携带全局个人档案。
7. 全局个人档案不得被项目工具写入项目目录或项目 Artifact。

## 15. 可观测性

Trace 增加：

```text
memory.user_profile.remember
memory.user_profile.forget
memory.user_profile.project
memory.user_profile.replay
```

指标建议：

- `user_memory_write_total{status}`
- `user_memory_forget_total{status}`
- `user_memory_projection_lag_revision`
- `user_memory_projection_failure_total`
- `user_memory_replay_total`
- `user_memory_sensitive_reject_total`

诊断日志必须能够回答：

- 哪个 session/turn 发起了修改。
- canonical event 是否提交。
- SQLite 投影到哪个 revision。
- `USER.md` 是否已经物化。
- 为什么一次操作被拒绝。

## 16. 分阶段实施

### Phase A：数据与事件主链路

1. 增加 `user_profile_facts` 和 projection state 表。
2. 增加 upsert/forget canonical event schema。
3. 在 `SessionEventService` 增加 journal-first 提交和 SQLite 幂等投影。
4. 增加 replay/rebuild 支持及单元测试。

### Phase B：Agent 工具与路由

1. 实现 `user_memory` 工具。
2. 原子 remember/forget 加入 plan 免除清单。
3. 修正 `my`、`memory` skill 和系统提示词。
4. 增加秘密检测、分类校验和明确错误语义。

### Phase C：上下文与 Dream 投影

1. `ContextBuilder` 注入 active confirmed facts。
2. 成功写入后刷新当前进程快照。
3. Dream/materializer 更新 `USER.md` 受管区域。
4. 加入 projection revision、失败重试和启动恢复。

### Phase D：迁移与管理 UI

1. 安全导入现有结构化 `USER.md` 字段。
2. 增加 profile memories REST API。
3. 可选增加“个人记忆”管理界面。
4. 观察一个稳定发布周期后清理冲突的旧提示词和兼容路由。

## 17. 验收标准

### 17.1 主路径

1. 用户说“请你记住我叫王耀彬”。
2. Agent 调用 `user_memory remember`，不创建计划。
3. 本轮明确回复已经记住；失败时不得回复成功。
4. SQLite 可查到 `identity.name=王耀彬` 及来源 session/turn/event。
5. 新建普通会话后询问“我叫什么”，正确回答王耀彬。
6. 切换到任意项目会话后仍能回答名字，但项目资料保持隔离。
7. 重启应用后仍然正确。
8. `USER.md` 最终物化为正确名字，不再显示 `Name: (not provided)`。

### 17.2 修改与遗忘

1. “以后叫我小王”使同一 key revision 加一，不产生两个冲突 active 值。
2. “忘掉我的名字”后，本轮后续和新会话均不再注入名字。
3. `USER.md` 受管区域随后同步移除该事实。
4. 重复投递同一个 event 不改变 revision，不产生重复行。

### 17.3 故障与安全

1. Dream disabled 时，显式记忆仍可跨会话和重启使用。
2. `USER.md` 写入失败时，SQLite 事实仍可用，并有可重试 projection 状态。
3. SQLite 投影可从 Journal 重建且结果一致。
4. “记住我的 API Key”被拒绝，日志不输出 key value。
5. 长期记忆请求不再调用 `my set`。
6. 一次原子记忆操作不产生 `PLAN_REQUIRED`。

### 17.4 项目隔离

1. 项目 A 的研究结论不会进入 `user_profile_facts`。
2. 项目 A 的项目记忆在项目 B 不可检索。
3. 用户通用偏好可跨项目读取，但不赋予跨项目文件访问权限。
4. 项目导出不包含全局个人档案，除非用户明确选择。

## 18. 预计代码落点

Backend：

```text
nanobot/storage/state.py
nanobot/storage/session_events.py
nanobot/runtime/plan_policy.py
nanobot/agent/context.py
nanobot/agent/tools/                  # 新增 user_memory tool
nanobot/agent/memory.py               # USER.md materializer / Dream 对接
nanobot/skills/my/SKILL.md
nanobot/skills/memory/SKILL.md
nanobot/templates/AGENTS.md
nanobot/webui/ws_http.py              # profile memories API
```

GUI（Phase D 可选）：

```text
src/core/types.ts
src/core/api.ts
src/components/settings/             # 个人记忆管理
```

测试：

```text
tests/storage/test_user_profile_facts.py
tests/storage/test_user_profile_event_replay.py
tests/agent/test_user_memory_tool.py
tests/agent/test_user_profile_context.py
tests/agent/test_user_profile_materializer.py
tests/runtime/test_user_memory_plan_policy.py
tests/webui/test_profile_memory_api.py
```

## 19. 与现有 Spec 的一致性

本 Spec 遵循：

- `unified-run-trace-and-state-read-model-spec.md`：Journal 先写、SQLite 为 read model、
  WebSocket 只负责增量投递。
- `project-isolation-storage-spec.md`：项目文件、会话、产物和项目记忆继续按
  `project_id` 强隔离；SQLite 不替代路径权限。
- `turn-lifecycle-runtime-spec.md`：记忆 required event 必须在 Turn terminal barrier 前取得
  commit receipt，避免回复成功但事实未提交。

若旧文档或旧技能把 `my` 描述为长期偏好存储，以本 Spec 为准。

## 20. 最终结论

当前问题不能通过“打开 `my set`”或“让 Dream 更频繁运行”解决。正确做法是增加一个
显式、结构化、journal-first 的用户档案事实通路：

```text
明确用户授权
  -> user_memory tool
  -> canonical event
  -> SQLite active profile
  -> 当前上下文立即生效
  -> Dream 异步物化 USER.md
```

这样既保留 Dream 的长期归纳优势，又让“请记住我叫王耀彬”成为可靠、即时、可恢复、
可遗忘的产品能力，并且不会破坏现有项目隔离。
