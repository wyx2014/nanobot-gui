# 统一 Run Trace 与会话单一事实源 Spec

> 状态：Core Implemented（Phase A-D 主路径已落地；Phase E 按会话懒迁移已落地；Phase F 待稳定发布后清理）
> 适用范围：`nanobot` gateway、Electron GUI、WebSocket/REST 协议、会话事件日志、`state.sqlite`、`logs.sqlite`
> 解决问题：架构核查结论中的第 1 点“缺少统一 Run Trace”和第 2 点“前后端存在多套状态表达”
> 最后更新：2026-08-03

## 0. 实施记录（2026-08-03）

本次已经完成第 1、2 点的可运行主链路，不再只是设计提案。

| 阶段 | 状态 | 已落地内容 |
| --- | --- | --- |
| Phase A 协议与身份 | 已完成 | Event schema v3；Turn `trace_id`；`project/session/turn/event/revision/runtime_epoch` 稳定身份；前后端类型 |
| Phase B Trace Collector | 已完成主链路 | `traces`、`agent_runs`、`trace_spans`、`trace_context_items`；Turn/Run/Context/LLM/Tool/Sub-Agent 插桩；查询 API；retention；abandoned recovery；旧 `logs.sqlite` 在线迁移 |
| Phase C Canonical Event | 已完成主链路 | `SessionEventService.commit()`；独立 canonical JSONL；journal-first + SQLite projection；WebUI transcript 降为可删除 cache/legacy import；Thread Resource REST API |
| Phase D GUI Read Model | 已完成主链路 | `ThreadResourceStore`；消息/Runtime/Plan/Artifact 同 Session 投影；revision/identity/gap 防护；断线和 terminal snapshot refresh；旧接口仅作 404 兼容回退 |
| Phase E 历史迁移 | 部分完成 | 首次访问单个会话时懒迁移 legacy transcript；旧 Artifact 首次访问索引；长会话按 canonical `event_seq` 分页；全量后台扫描、quarantine 管理和 shadow compare 尚未开启 |
| Phase F 兼容清理 | 未执行 | 按本 Spec 要求至少观察一个稳定发布周期后再删除兼容代码 |

2026-08-03 实机验收补丁：

- `update_task_progress` 以完整 `steps` 快照为权威：当唯一 running step 与一个
  合法但过期的 `current_step_id` 不一致时自动对齐；全终态快照自动清空
  `current_step_id`，未知 step id 仍拒绝。
- 最终回答通过 required runtime event 同步写入 canonical journal/SQLite，取得
  canonical receipt 后才进入 Turn terminal barrier；后续 WebSocket outbound 仅投递
  该已提交事件，不再产生第二条 message。

本轮关键实现位置：

```text
nanobot/runtime/trace_context.py
nanobot/observability/trace_collector.py
nanobot/observability/trace_store.py
nanobot/storage/session_events.py
nanobot/storage/journal.py
nanobot/storage/state.py
nanobot/runtime/turn_lifecycle.py
nanobot/agent/runner.py
nanobot/webui/transcript.py
nanobot/webui/ws_http.py

nanobot-gui/src/stores/threadResourceStore.ts
nanobot-gui/src/core/nanobot/threadResourceProjection.ts
nanobot-gui/src/core/nanobot-client.ts
nanobot-gui/src/core/nanobotClient.ts
nanobot-gui/src/components/chat/ChatView.tsx
nanobot-gui/src/components/panel/ConversationWorkbench.tsx
```

当前兼容边界：

1. canonical event 文件位于 `<workspace>/.nanobot/session-events/`；旧 WebUI transcript 只作为一次性迁移输入和可删除展示缓存。
2. GUI 首选 `/api/sessions/{session_key}/thread`；只有旧 gateway 返回 404 时才调用原 `webui-thread`、runtime 和 artifact 接口。
3. Plan 的 SQLite resource revision 可实时合并进 `ThreadResourceStore`，但兼容 `TurnPlanStore` 暂时保留给旧 gateway 和旧消息渲染。
4. 本轮没有执行 Phase F 的物理删除，也没有实现 Project 深度 RAG 或 Durable Sub-Agent。

## 1. 文档定位

本 Spec 在不推翻现有项目隔离、Turn 生命周期和 Artifact Registry 的前提下，完成两项架构收口：

1. 为每个用户 Turn 建立一条端到端 Trace，并把主 Agent、LLM、工具、子 Agent、检索、记忆和产物操作组织成可查询的 Span 树。
2. 将会话状态从“JSONL、WebUI transcript、SQLite、进程内 Map 和 GUI 分别推导”收口为“一个权威事件流、一个 SQLite Read Model、一个实时 Runtime Snapshot”。

本文是以下文档的补充规范：

- `docs/project-isolation-storage-spec.md`
- `docs/turn-lifecycle-runtime-spec.md`
- `docs/unified-task-plan-progress-spec.md`
- `docs/conversation-workbench-spec.md`
- `docs/gui-backend-interface-spec.md`

若旧文档在下列问题上与本文冲突，以本文为准：

- WebUI transcript 是否可以成为第二事实源。
- GUI 是否可以从消息、计时器或 Plan 推导运行状态。
- 同一 Turn 的 Trace、Run、Span 如何关联。
- WebSocket 断线重连、事件缺口和旧事件如何处理。

项目身份、文件边界、Artifact 关系和 ActiveTurn 终态语义继续以原 Spec 为准。

## 2. 核心结论

目标架构不是“所有内容只存 SQLite”，而是四层职责明确：

```text
可重放业务事实       Session Event Journal（JSONL）
当前可查询业务状态   state.sqlite Read Model
实时易腐运行状态     ThreadRuntimeRegistry / ActiveTurn
运行诊断与性能分析   logs.sqlite 中的 Trace / Span / Log
```

GUI 不再维护另一套事实，只保存后端资源的本地镜像：

```text
Gateway committed event / snapshot
                │
                ▼
       Renderer Thread Resource
       ├─ messages
       ├─ activeTurn / latestTurn
       ├─ plan
       ├─ tool activity
       └─ artifact revision
```

必须保留以下现有优势：

1. JSONL 先追加、SQLite 后投影，SQLite 可从 JSONL 重建。
2. `project_id`、`session_id`、`turn_id` 和 Artifact 关系受数据库约束。
3. ActiveTurn 是当前运行状态的唯一权威。
4. WebSocket 只承担增量通知，不承担持久事实。
5. 实际产物字节继续保存在项目文件系统或 managed artifact 目录。

## 3. 当前问题

### 3.1 缺少一条端到端 Trace

当前系统已经分别记录：

- Turn 开始和终态。
- provider TTFT。
- Turn latency。
- provider usage。
- 工具开始、结束和失败。
- Artifact 状态和结构化诊断日志。

但这些记录没有统一的 `trace_id`、通用 `run_id`、`span_id` 和父子关系，因此一次任务出现问题时仍然需要人工拼接：

- 这一轮到底构建了哪些上下文。
- 第几次 LLM 调用最慢。
- 哪个工具或子 Agent 阻塞。
- tokens 增长来自历史、Skill、记忆、工具结果还是最终输出。
- 产物失败发生在创建、写入、校验还是注册阶段。
- 本轮使用了哪个 Prompt、模型配置、Skill 和工具版本。

### 3.2 会话状态存在多个推导者

当前兼容路径中可能同时出现：

- Agent Session JSONL。
- Session Event Journal JSONL。
- WebUI 展示 transcript JSONL。
- legacy WebUI JSON snapshot。
- `state.sqlite` 投影。
- `ThreadRuntimeRegistry` 进程内状态。
- WebSocket compatibility status。
- GUI `chatStore`、Turn Plan、Workbench progress 和旧执行 store。
- GUI 按消息内容和时间进行重复消息修复。

其中 JSONL + SQLite 双轨本身不是问题。问题在于 WebUI transcript、legacy snapshot 和 GUI 推导逻辑仍可能被当成独立事实源，导致：

- 同一最终回答显示两次。
- 已完成 Turn 仍显示 running。
- 切换会话时带入上一个会话的 Plan 或 Steps。
- WebSocket 重连后旧 revision 覆盖新状态。
- Streaming narration 先进入正文，再被移动到 ToolStep。
- 后端状态正确，但 GUI 仍依赖旧消息形状进行“自愈”。

## 4. 目标

### 4.1 Trace 目标

1. 每个用户 Turn 恰好创建一个 `trace_id`。
2. 每次 `AgentRunner` 调用创建一个 `run_id`；主 Agent 和每个子 Agent 都是独立 Run。
3. LLM、工具、检索、上下文构建、Artifact 和记忆操作均形成 Span。
4. 任意错误可以从 `project_id/session_id/turn_id` 查询到完整 Span 树。
5. Trace 记录确认后的 token usage、TTFT、latency、模型和配置版本。
6. Trace 不保存私有思维链，不明文保存密钥和敏感大段输入。
7. Trace 写入失败不阻止用户 Turn 完成，但必须留下降级诊断日志。

### 4.2 单一事实源目标

1. Session Event Journal 是持久业务事件的唯一追加写事实源。
2. `state.sqlite` 是项目、会话、Turn、消息、Plan、工具和 Artifact 的查询投影。
3. `ThreadRuntimeRegistry` 是当前进程 ActiveTurn 的唯一实时事实源。
4. WebUI transcript 只能是可重建的展示投影或迁移输入，不能独立决定会话状态。
5. GUI 不再根据消息内容、Plan 状态、本地计时器或 streaming 标志推导 running。
6. 所有 WebSocket 增量均携带稳定身份、事件序号和资源 revision。
7. 断线重连或发现事件缺口时，GUI 必须从 REST Resource Snapshot 恢复。
8. 同一 Turn 的最终回答只能提交和展示一次。

## 5. 非目标

1. 不重新引入 GUI 本地 Agent 执行器或本地 Tool Registry。
2. 不把 token 级 `delta` 全量写入 SQLite 或 Trace。
3. 不保存或展示模型私有 chain-of-thought。
4. 不把 `logs.sqlite` 变成会话恢复来源。
5. 不以 Trace 是否成功写入决定业务 Turn 是否成功。
6. 不在本阶段实现 Project 深度向量 RAG。
7. 不在本阶段实现 Durable Sub-Agent；本文只预留 Trace 和状态接口。
8. 不立即删除历史 JSONL 或 legacy snapshot；必须先完成迁移和 shadow compare。

## 6. 设计不变量

1. 所有业务事件必须包含 `project_id`、`session_id`、`event_id` 和 `event_seq`。
2. Turn 事件必须包含 `turn_id`；Run/Span 事件还必须包含 `trace_id` 和 `run_id`。
3. `event_seq` 在单个 Session 内严格递增。
4. `event_id` 全局唯一，SQLite projector 按 `event_id` 幂等。
5. 同一 Session 同一时刻最多存在一个 ActiveTurn。
6. 一个已开始 Turn 最终恰好有一个 terminal resource。
7. 一个 Turn 最多存在一条用户可见最终回答。
8. Plan 是 Turn 子资源，永远不能决定 Thread 是否 running。
9. WebSocket 事件只有在业务事件追加和 SQLite 投影成功后才可广播。
10. Trace Span 可以 best-effort 写入，但业务事件必须 journal-first。
11. GUI 只接受与当前 `project_id/session_id/turn_id` 匹配的资源更新。
12. 低 revision、旧 runtime epoch 和重复 event 必须被忽略。
13. 任何事件序号缺口必须触发 snapshot refresh，不能靠猜测补齐。
14. 私有 reasoning 不进入 Event Journal、Trace attributes、日志或 GUI。

## 7. 统一身份模型

| 标识 | 生命周期 | 说明 |
| --- | --- | --- |
| `project_id` | 项目长期稳定 | 强隔离边界 |
| `session_id` | 会话长期稳定 | SQLite 内部 Session 身份 |
| `session_key` | 兼容期稳定 | 旧协议路由键，逐步降为 adapter 参数 |
| `turn_id` | 一次用户 Turn | 从用户消息开始到明确终态 |
| `trace_id` | 一次端到端 Turn | 覆盖主 Agent、所有同轮子 Agent、工具和 Artifact |
| `run_id` | 一次 AgentRunner 调用 | 主 Agent或一个子 Agent的一次运行 |
| `span_id` | 一次操作 | context、LLM、tool、retrieval、artifact 等 |
| `parent_span_id` | Span 父子关系 | 构造完整 Trace 树 |
| `event_id` | 一条持久业务事件 | 幂等键 |
| `event_seq` | Session 内递增 | 重放和缺口检测 |
| `snapshot_revision` | Thread Resource 递增 | 防止旧快照覆盖新状态 |
| `plan_revision` | 单 Turn Plan 递增 | 防止旧 Plan 回退 |
| `runtime_epoch` | gateway 进程生命周期 | 重启后拒绝旧进程的 active 状态 |

关系如下：

```text
Project
  └─ Session
      └─ Turn = Trace
          ├─ Main Agent Run
          │   ├─ context.build span
          │   ├─ llm.call span
          │   ├─ tool.call span
          │   └─ artifact.write span
          └─ Child Agent Run
              ├─ llm.call span
              └─ tool.call span
```

默认情况下可令 `trace_id = "trc_" + turn UUID`，但不得直接假设 `trace_id == turn_id`，以便后续支持：

- 一个系统任务没有用户 Turn。
- cron run 产生独立 Trace。
- 一个父 Turn 关联多个 Agent Run。

## 8. 目标架构

```text
Electron / Mobile Client
           │
           ▼
Gateway REST + WebSocket
           │
           ▼
ThreadRuntimeRegistry ───────────────► Runtime Snapshot
           │
           ▼
Turn Orchestrator
           │
           ├─► ContextBuilder ───────► Context Manifest
           ├─► AgentRunner
           │     ├─► Provider
           │     ├─► Tool Registry
           │     └─► SubagentManager
           └─► Artifact Registry
           │
           ├──────── business facts ─► Session Event Journal JSONL
           │                                      │
           │                                      ▼
           │                                state.sqlite Projector
           │                                      │
           │                                      ▼
           │                               Thread Read Model API
           │
           └──────── diagnostics ────────► Trace Collector
                                                  │
                                                  ▼
                                       logs.sqlite / optional OTel
```

## 9. 方案一：统一 Run Trace

### 9.1 Trace 与会话事件的边界

必须区分两种数据：

| 数据 | 示例 | 存储 | 是否可用于会话恢复 |
| --- | --- | --- | --- |
| 业务事实 | 用户消息、最终回答、工具终态、Plan、Artifact ready、Turn terminal | Session Event Journal + `state.sqlite` | 是 |
| 运行诊断 | LLM TTFT、每次调用 tokens、Span 耗时、重试、配置版本 | `logs.sqlite` Trace 表 | 否 |

同一个动作可以同时产生两类记录。例如工具成功：

1. `tool_call_completed` 写入 Session Event Journal，供会话恢复和 UI 展示。
2. `tool.call` Span 在 `logs.sqlite` 结束，记录耗时、参数摘要、结果大小和错误码。

Trace 丢失不能改变工具成功这一业务事实。

### 9.2 Trace 生命周期

```text
turn accepted
  └─ create trace
      └─ create main run
          ├─ context.build
          ├─ llm.call iteration=0
          ├─ tool.call
          ├─ child run(s)
          ├─ llm.call iteration=1
          └─ final.commit
turn terminal
  └─ close open spans as completed/error/cancelled/abandoned
      └─ close run
          └─ close trace
```

终态映射：

| Turn 状态 | Trace 状态 | 未关闭 Span |
| --- | --- | --- |
| `completed` | `completed` | 以 `completed` 或明确的降级状态收口 |
| `failed` | `failed` | 以 `error` 收口并记录 error code |
| `cancelled` | `cancelled` | 以 `cancelled` 收口 |
| gateway crash 后恢复 | `abandoned` | 启动恢复时按旧 `runtime_epoch` 收口 |

### 9.3 Trace 数据库存储

Trace 属于运行诊断数据，写入现有独立 `logs.sqlite`，不写入核心 `state.sqlite`。

建议 schema：

```sql
CREATE TABLE traces (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT,
  session_id            TEXT,
  turn_id               TEXT,
  runtime_epoch         TEXT NOT NULL,
  status                TEXT NOT NULL,
  started_at            INTEGER NOT NULL,
  ended_at              INTEGER,
  duration_ms           INTEGER,
  root_run_id           TEXT,
  provider              TEXT,
  model                 TEXT,
  model_preset          TEXT,
  prompt_version        TEXT,
  toolset_version       TEXT,
  skillset_version      TEXT,
  input_tokens          INTEGER,
  output_tokens         INTEGER,
  cached_input_tokens   INTEGER,
  total_tokens          INTEGER,
  error_code            TEXT,
  error_json            TEXT,
  created_at            INTEGER NOT NULL
);

CREATE INDEX traces_turn_time
ON traces(turn_id, started_at DESC);

CREATE INDEX traces_session_time
ON traces(session_id, started_at DESC);

CREATE TABLE agent_runs (
  id                    TEXT PRIMARY KEY,
  trace_id              TEXT NOT NULL,
  parent_run_id         TEXT,
  parent_span_id        TEXT,
  agent_kind            TEXT NOT NULL,
  agent_label           TEXT,
  project_id            TEXT,
  session_id            TEXT,
  turn_id               TEXT,
  status                TEXT NOT NULL,
  provider              TEXT,
  model                 TEXT,
  started_at            INTEGER NOT NULL,
  ended_at              INTEGER,
  duration_ms           INTEGER,
  input_tokens          INTEGER,
  output_tokens         INTEGER,
  cached_input_tokens   INTEGER,
  total_tokens          INTEGER,
  stop_reason           TEXT,
  error_json            TEXT,
  FOREIGN KEY(trace_id) REFERENCES traces(id) ON DELETE CASCADE
);

CREATE INDEX agent_runs_trace
ON agent_runs(trace_id, started_at);

CREATE TABLE trace_spans (
  id                    TEXT PRIMARY KEY,
  trace_id              TEXT NOT NULL,
  run_id                TEXT NOT NULL,
  parent_span_id        TEXT,
  sequence_no           INTEGER NOT NULL,
  kind                  TEXT NOT NULL,
  name                  TEXT NOT NULL,
  status                TEXT NOT NULL,
  started_at            INTEGER NOT NULL,
  ended_at              INTEGER,
  duration_ms           INTEGER,
  input_tokens          INTEGER,
  output_tokens         INTEGER,
  cached_input_tokens   INTEGER,
  total_tokens          INTEGER,
  ttft_ms               INTEGER,
  retry_count           INTEGER,
  error_code            TEXT,
  attributes_json       TEXT NOT NULL DEFAULT '{}',
  error_json            TEXT,
  FOREIGN KEY(trace_id) REFERENCES traces(id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX trace_spans_run_sequence
ON trace_spans(run_id, sequence_no);

CREATE INDEX trace_spans_trace_parent
ON trace_spans(trace_id, parent_span_id, sequence_no);

CREATE TABLE trace_context_items (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id              TEXT NOT NULL,
  run_id                TEXT NOT NULL,
  item_kind             TEXT NOT NULL,
  source_id             TEXT,
  source_locator        TEXT,
  content_hash          TEXT,
  token_estimate        INTEGER,
  selected_reason       TEXT,
  rank                  REAL,
  metadata_json         TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(trace_id) REFERENCES traces(id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
);

CREATE INDEX trace_context_trace
ON trace_context_items(trace_id, run_id, item_kind);
```

现有 `logs` 表增加可空关联字段：

```sql
ALTER TABLE logs ADD COLUMN trace_id TEXT;
ALTER TABLE logs ADD COLUMN run_id TEXT;
ALTER TABLE logs ADD COLUMN span_id TEXT;
```

数据库必须继续启用：

- WAL。
- `synchronous=NORMAL`。
- busy timeout。
- `foreign_keys=ON`。
- 增量 vacuum。
- 有界 retention。

Token 聚合规则必须固定：Run usage 等于该 Run 下所有 confirmed LLM Span usage 之和；Trace usage 等于所有 Run usage 之和。不得再把 live estimate、上下文窗口快照或父 Run 汇总值重复相加。

### 9.4 Span 类型

首期标准类型：

| `kind` | `name` 示例 | 关键属性 |
| --- | --- | --- |
| `turn` | `turn.execute` | channel、conversation type、runtime epoch |
| `context` | `context.build` | token estimate、history count、manifest hash |
| `retrieval` | `memory.retrieve` | gate decision、query hash、hit ids、hit count |
| `retrieval` | `project_documents.retrieve` | project id、chunk ids、rank |
| `llm` | `llm.call` | provider、model、iteration、TTFT、usage、finish reason |
| `tool` | `tool.call` | tool name、call id、argument summary、result size |
| `agent` | `subagent.run` | child run id、label、join policy |
| `artifact` | `artifact.write` | artifact id、mime、size、validation status |
| `memory` | `memory.phase1` / `memory.phase2` | job id、source count、output count |
| `finalize` | `final.commit` | answer message id、guard result |

不为每个流式 token 创建 Span。Streaming 只在内存中更新 TTFT 和输出字节计数，最终合并到对应 LLM Span。

### 9.5 Context Manifest

每个 Agent Run 必须记录一份 Context Manifest，回答“模型这次到底看到了什么”。

Manifest 只记录身份、hash、长度和选择原因，默认不复制完整敏感正文。

必须覆盖：

- Bootstrap：`AGENTS.md`、`SOUL.md`、`USER.md` 的路径、内容 hash、字符数和 token estimate。
- Tool contract 和输出 contract 的版本。
- 当前会话历史 message id 范围和 token estimate。
- Session summary 的 hash 和 token estimate。
- 注入的 project memory id、来源 session id 和选择原因。
- 注入的 project document chunk id、relative path、rank 和 token estimate。
- Active Skill 名称、来源、版本/hash 和触发原因。
- Expert Team 配置版本。
- MCP preset 名称和配置版本，不记录 secret。
- 最终 prompt 总 token estimate、截断和压缩决策。

示例：

```json
{
  "item_kind": "project_memory",
  "source_id": "mem_123",
  "source_locator": "project:prj_x/session:ses_y",
  "content_hash": "sha256:...",
  "token_estimate": 384,
  "selected_reason": "keyword_match",
  "rank": 0.82,
  "metadata": {
    "stale_warning": true
  }
}
```

### 9.6 插桩位置

#### `nanobot/runtime/turn_lifecycle.py`

- `start_turn()` 创建 `trace_id` 和根 Trace。
- Trace 身份进入 `ActiveTurn`，通过 Runtime Context 向下传递。
- `finish_turn()` 在 terminal commit 后结束 Trace。
- gateway 恢复时把旧 runtime epoch 的未完成 Trace 标记为 `abandoned`。

#### `nanobot/agent/context.py`

- `build_messages()` 创建 `context.build` Span。
- 输出 Context Manifest，不记录私有正文。
- 记录每一类上下文的 token estimate 和截断原因。

#### `nanobot/agent/runner.py`

- 每次 `AgentRunner.run()` 创建一个 `agent_runs` 记录。
- 每次 provider 调用创建 `llm.call` Span。
- 已有 `provider_timing_callback` 扩展为通用 Trace callback。
- 已有 confirmed usage 写入 LLM Span；live estimate 只用于 UI，不作为最终账本。

#### Tool Registry

- 在统一 `execute` wrapper 处创建 `tool.call` Span，避免每个工具自行实现。
- 参数只保存 schema-aware 摘要和 hash。
- 大结果只保存字符数、mime、offload/artifact id 和截断状态。

#### `nanobot/agent/subagent.py`

- 子 Agent 继承父 `trace_id`。
- 每次子 Agent 执行创建新 `run_id`。
- `parent_run_id` 和 `parent_span_id` 指向 spawn Span。
- 子 Agent 通知和 Team progress 继续属于业务事件，不由 Trace 替代。

#### Artifact Registry

- staging、write、validate、ready/failed 形成一个或多个 Artifact Span。
- Span 只关联 `artifact_id`，文件内容仍在文件系统。

### 9.7 Trace Writer

新增进程内 `TraceCollector`：

```text
begin_trace()
begin_run()
begin_span()
end_span()
end_run()
end_trace()
flush()
```

约束：

1. 使用 `ContextVar` 传递当前 `trace_id/run_id/span_id`，不使用全局可变 current trace。
2. DB 写入通过单 writer queue 串行化，避免每个 streaming callback 打开 SQLite 连接。
3. Span 开始和结束允许批量提交，但 terminal 时执行有上限的 flush。
4. flush 超时只写一条 `TRACE_FLUSH_TIMEOUT` 日志，不阻止 Turn terminal。
5. queue 必须有上限；满载时优先保留 Trace/Run/Span terminal，丢弃低优先级 debug event。

### 9.8 Trace API

```text
GET /api/traces?project_id=&session_id=&turn_id=&status=&limit=
GET /api/traces/{trace_id}
GET /api/traces/{trace_id}/spans
GET /api/traces/{trace_id}/context
POST /api/traces/{trace_id}/export
```

权限要求：

- 仅本机已认证客户端可访问。
- session 页面查询时同时校验 project/session 关系。
- 导出默认再次脱敏。
- 不返回 API key、authorization header、cookie、完整敏感工具参数和私有 reasoning。

### 9.9 Trace 保留策略

默认建议：

- 完整成功 Trace：保留 30 天。
- failed/cancelled/abandoned Trace：保留 90 天。
- 至少保留最近 1,000 条 Trace，不因时间清理全部诊断依据。
- 用户主动导出的 Trace 不受自动清理影响。
- 清理后执行 incremental vacuum，不在应用启动关键路径执行 full vacuum。

## 10. 方案二：会话单一事实源与 GUI Read Model

### 10.1 权威层级

| 状态 | 唯一权威 | 其他层职责 |
| --- | --- | --- |
| 会话历史业务事实 | Session Event Journal | SQLite/GUI 都是投影 |
| 项目、Session、Turn、消息、Plan、工具、Artifact 查询 | `state.sqlite` | REST 返回 Resource Snapshot |
| 当前是否正在运行 | `ThreadRuntimeRegistry.ActiveTurn` | SQLite 只保存历史终态 |
| 流式临时文本 | gateway 进程内 stream buffer | stream 完成后提交业务事件 |
| 运行诊断 | `logs.sqlite` Trace/Log | 不参与业务恢复 |
| 文件内容 | 项目目录/managed artifacts | SQLite 只保存身份和关系 |

### 10.2 Canonical Session Event Envelope

所有新业务事件使用同一个 envelope：

```json
{
  "schema_version": 3,
  "event_id": "evt_x",
  "event_seq": 42,
  "event": "tool_call_completed",
  "recorded_at": 1785720000000,
  "project_id": "prj_x",
  "session_id": "ses_x",
  "session_key": "websocket:...",
  "turn_id": "turn_x",
  "trace_id": "trc_x",
  "runtime_epoch": "epoch_x",
  "visibility": "public",
  "payload": {}
}
```

字段规则：

- `event_id`：全局唯一。
- `event_seq`：由 gateway 在 Session 内分配，客户端不能指定。
- `project_id/session_id`：从已绑定 Session 读取，不能接受客户端覆盖。
- `turn_id`：Turn 范围事件必填。
- `trace_id`：Agent 执行产生的事件必填；纯 Session 管理事件可空。
- `runtime_epoch`：运行态相关事件必填。
- `visibility`：`public`、`internal`；不允许 `private_reasoning` 类型落盘。
- `payload`：按 event schema 校验，不接受任意未约束 UI blob 成为事实源。

### 10.3 首期 Canonical Event 类型

#### Session

- `session_created`
- `session_metadata_updated`
- `session_archived`
- `session_restored`

#### Turn

- `turn_started`
- `turn_completed`
- `turn_failed`
- `turn_cancelled`

#### Message / Stream Commit

- `user_message_committed`
- `assistant_narration_committed`
- `assistant_final_committed`
- `reasoning_summary_committed`

`reasoning_summary_committed` 只能保存面向用户的简短思考摘要或状态说明，禁止保存 provider 私有 reasoning。

#### Tool

- `tool_call_started`
- `tool_call_completed`
- `tool_call_failed`
- `tool_call_cancelled`

#### Plan

- `turn_plan_replaced`
- `turn_plan_step_updated`
- `turn_plan_terminalized`

#### Agent

- `subagent_spawned`
- `subagent_status_changed`
- `subagent_completed`

#### Artifact

- `artifact_staging`
- `artifact_ready`
- `artifact_failed`
- `artifact_missing`

#### Interactive

- `approval_requested`
- `approval_resolved`
- `user_input_requested`
- `user_input_resolved`

### 10.4 事件提交顺序

所有持久业务事件遵循：

```text
1. 验证 ProjectContext / Session / Turn
2. 分配 event_seq
3. append JSONL + flush
4. SQLite projector 短事务投影
5. commit
6. 构建 canonical resource/event payload
7. WebSocket broadcast
```

禁止以下顺序：

```text
WebSocket 先发 → JSONL 后写
GUI 乐观终态 → gateway 最终再猜
WebUI transcript 先写 → core session 后补
```

若步骤 3 成功、步骤 4 失败：

- 业务事件已经持久化。
- 不广播该事件。
- 写 `EVENT_PROJECTION_FAILED`。
- projector 恢复后从 JSONL 幂等重放。

### 10.5 Streaming 的处理

流式 `delta` 是易腐 UI 信号，不是持久业务事实：

1. `delta/reasoning_delta/narration_delta` 可以实时通过 WebSocket 发送。
2. 每个 stream event 必须带 `turn_id`、`segment_id` 和单 segment 内的 `delta_seq`。
3. GUI 只把 delta 写入与当前 Turn 匹配的临时 stream buffer。
4. `assistant_narration_committed` 或 `assistant_final_committed` 成功后，用 committed resource 替换临时 buffer。
5. 断线期间丢失 delta 不影响恢复；重连读取 committed messages。
6. Turn terminal 时清除所有未提交 stream buffer，不把残缺文本猜成最终回答。

### 10.6 SQLite Read Model

继续使用现有 `state.sqlite` 表：

- `projects`
- `sessions`
- `turns`
- `messages`
- `tool_calls`
- `turn_progress`
- `turn_steps`
- `expert_team_runs`
- `artifacts`
- `artifact_links`
- `agent_edges`
- `projected_events`
- `projector_state`

补充或确认字段：

```sql
ALTER TABLE messages ADD COLUMN event_id TEXT;
ALTER TABLE messages ADD COLUMN segment_id TEXT;
ALTER TABLE messages ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

ALTER TABLE turns ADD COLUMN trace_id TEXT;
ALTER TABLE turns ADD COLUMN runtime_epoch TEXT;

CREATE UNIQUE INDEX messages_origin_event_unique
ON messages(event_id)
WHERE event_id IS NOT NULL;
```

若现有字段已通过 metadata 保存，迁移后必须提升为稳定列，避免正常查询依赖 JSON 扫描。

### 10.7 Thread Resource Snapshot

新增或规范统一响应：

```text
GET /api/sessions/{session_id}/thread
GET /api/sessions/{session_id}/thread?after_event_seq=42
GET /api/sessions/{session_id}/runtime
GET /api/turns/{turn_id}/plan
```

完整 Thread Resource：

```json
{
  "project_id": "prj_x",
  "session_id": "ses_x",
  "session_key": "websocket:...",
  "last_event_seq": 52,
  "snapshot_revision": 18,
  "runtime_epoch": "epoch_x",
  "thread_status": {
    "type": "idle"
  },
  "active_turn": null,
  "latest_turn": {
    "id": "turn_x",
    "status": "completed",
    "trace_id": "trc_x",
    "started_at": 1785720000000,
    "completed_at": 1785720031000,
    "duration_ms": 31000,
    "usage": {
      "prompt_tokens": 12000,
      "completion_tokens": 1800,
      "total_tokens": 13800
    }
  },
  "messages": [],
  "plan": null,
  "artifact_revision": 7
}
```

增量响应必须包含：

- `from_event_seq`
- `to_event_seq`
- events/resource patches
- `snapshot_revision`
- `has_more`

### 10.8 WebSocket 协议

统一 envelope：

```json
{
  "type": "thread.event",
  "project_id": "prj_x",
  "session_id": "ses_x",
  "turn_id": "turn_x",
  "event_id": "evt_x",
  "event_seq": 43,
  "snapshot_revision": 12,
  "runtime_epoch": "epoch_x",
  "event": "tool_call_completed",
  "resource": {}
}
```

临时 stream envelope：

```json
{
  "type": "thread.stream",
  "project_id": "prj_x",
  "session_id": "ses_x",
  "turn_id": "turn_x",
  "segment_id": "seg_x",
  "delta_seq": 8,
  "stream_kind": "answer",
  "delta": "..."
}
```

Runtime snapshot envelope：

```json
{
  "type": "thread.snapshot",
  "project_id": "prj_x",
  "session_id": "ses_x",
  "snapshot_revision": 13,
  "runtime_epoch": "epoch_x",
  "resource": {}
}
```

废弃但迁移期兼容：

- `_goal_status`
- 独立 wall time Map 通知
- message metadata 中无 revision 的完整 Plan snapshot
- GUI 依赖 `_turn_end` 清 running
- 没有 project/session/turn 身份的泛型 progress message

### 10.9 Gateway 单一写入者

Gateway 内部必须形成一条统一写入路径：

```text
Turn/Tool/Plan/Artifact domain action
              │
              ▼
SessionEventService.commit(event)
              ├─ journal.append()
              ├─ projector.apply()
              └─ websocket.publish()
```

以下模块不得再直接各写一份展示事实：

- WebUI coordinator。
- Agent hook。
- Tool progress callback。
- Expert Team progress adapter。
- Artifact notifier。

它们只能构造 typed domain event，然后调用统一的 `SessionEventService`。

### 10.10 WebUI transcript 的处理

目标状态：

1. 新会话不再把 WebUI transcript JSONL 当作独立持久事实。
2. WebUI 展示内容从 `state.sqlite` Read Model 返回。
3. 若仍保留 transcript 文件，只允许作为可删除、可重建 cache。
4. legacy `.json` snapshot 只允许迁移读取，禁止新写入。
5. 删除会话、归档、恢复以 Session/SQLite 状态为准，不以文件是否存在为准。

迁移期读取优先级：

```text
Canonical Event Journal + state.sqlite
  > 可重建 WebUI transcript cache
  > legacy WebUI JSON
```

不得反向用低优先级数据覆盖高优先级终态。

### 10.11 GUI Read Model

Renderer 建议收口为一个按 Session 分区的 `ThreadResourceStore`：

```ts
interface ThreadResourceState {
  threadsBySessionId: Record<string, {
    projectId: string;
    sessionId: string;
    lastEventSeq: number;
    snapshotRevision: number;
    runtimeEpoch: string;
    threadStatus: ThreadStatus;
    activeTurn: TurnResource | null;
    latestTurn: TurnResource | null;
    messages: MessageResource[];
    plan: TurnPlanResource | null;
    artifactRevision: number;
    streamBuffers: Record<string, StreamBuffer>;
  }>;
}
```

职责调整：

- `chatStore` 保留会话导航、输入框和轻量 UI 偏好。
- `ThreadResourceStore` 保存 gateway Thread Resource 镜像。
- `TurnPlanStore` 在迁移期只接收 canonical Plan Resource；取消从消息 hydration。
- `ConversationWorkbenchStore` 直接读取 canonical Plan，不再从 `agentUI` 消息选择最新 snapshot。
- `taskExecutionStore/taskProgressStore` 若无独立产品用途，在 shadow compare 后删除。
- Artifact panel 只使用 `project_id + session_id + artifact_revision`。

明确禁止：

- 按消息文本和五分钟时间窗口去重。
- 通过 `isStreaming` 判断 Thread running。
- 通过 Plan 中是否有 running step 判断 Turn running。
- 切换会话时复用全局 current plan/current usage。
- 用上一个会话的消息修复当前会话。

### 10.12 GUI 应用事件规则

收到事件时按以下顺序验证：

1. `project_id` 是否与 Session 绑定一致。
2. `session_id` 是否存在。
3. `runtime_epoch` 是否比当前缓存更新或相同。
4. `snapshot_revision` 是否大于当前 revision。
5. `event_seq` 是否等于 `last_event_seq + 1`。
6. Turn 事件的 `turn_id` 是否属于当前 Session。

处理结果：

| 情况 | 动作 |
| --- | --- |
| 重复 `event_id/event_seq` | 幂等忽略 |
| 旧 revision | 忽略 |
| event sequence gap | 暂停增量应用并拉取 snapshot |
| 旧 runtime epoch 的 active | 忽略并拉取 snapshot |
| 非当前会话事件 | 更新对应 Session store，不修改当前视图 |
| 身份冲突 | 拒绝应用并记录客户端诊断 |

### 10.13 重连算法

```text
1. bootstrap gateway auth
2. 读取当前 Session 本地 last_event_seq
3. GET thread?after_event_seq=N
4. 若 gateway 可以连续补齐：顺序应用
5. 若返回 snapshot_required：替换为完整 Thread Resource
6. 订阅 WebSocket
7. 仅接受大于 snapshot revision 的事件
8. 如果 active_turn 为空，强制清除本地 running/stream/timer
```

切换会话时：

- 不复制源会话 Runtime、Plan、Steps、usage 或 stream buffer。
- 目标会话未加载时显示明确 loading skeleton。
- snapshot 完成后默认滚动到底部。
- 右侧 Progress 和 Artifacts 从同一个目标 `session_id` 读取。

### 10.14 Plan、Steps 与最终回答

必须保持三类资源分离：

- Plan：用户目标级计划，显示在右侧 Progress。
- Tool/Agent activity：实际执行轨迹，显示在会话 ToolStep。
- Final answer：模型最终交付正文。

终态规则：

1. `assistant_final_committed` 先通过 single-final guard。
2. Turn terminal barrier 将未终止 Plan step 收口为 `skipped/interrupted/failed`，不得伪装 completed。
3. ToolStep 只显示属于该 Turn 的 activity。
4. 最终回答之后不得再追加同一 Turn 的普通 assistant 正文。
5. 迟到子 Agent结果按 join policy 进入 next Turn 或内部 mailbox，不能修改 terminal Turn。

## 11. 一致性与失败处理

### 11.1 JSONL 成功、SQLite 失败

- 不广播。
- Event 保留在 JSONL。
- projector state 写错误。
- 后台恢复或下次访问时重放。

### 11.2 SQLite 成功、WebSocket 失败

- 业务已成功。
- 客户端重连后通过 Read Model 恢复。
- 不重复写业务事件。

### 11.3 Trace 写入失败

- Turn 继续执行。
- 结构化日志记录 `TRACE_WRITE_FAILED`。
- Trace 标记 `partial` 或在恢复时补建最小 root record。
- 不允许因此重复调用 LLM 或工具。

### 11.4 Gateway 崩溃

启动恢复：

1. 读取旧 `runtime_epoch` 的未终止 Turn。
2. 按现有 Turn recovery 规则收口为 failed/interrupted。
3. 将对应 Trace/Run/Span 标记 `abandoned`。
4. 从 Event Journal 恢复 SQLite projector offset。
5. 不把旧 WebUI transcript 中的 running 状态恢复为 active。

### 11.5 重复事件

- JSONL 中若出现重复 `event_id`，projector 只应用一次。
- 同一 `assistant_final_committed` 重复投影不能生成两条最终回答。
- 同一 Artifact ready event 不能生成重复 link。

## 12. 迁移方案

### Phase A：协议与身份先行

1. 定义 Event schema v3、Trace schema v1 和 TypeScript 类型。
2. ActiveTurn 增加 `trace_id`。
3. Runtime Context 增加 `trace_id/run_id`。
4. 新 WebSocket envelope 携带 project/session/turn/event/revision。
5. 建立协议 fixture 和向后兼容测试。

完成标准：

- 新旧客户端可同时连接。
- 每个新 Turn 都有稳定 trace id。
- 不改变当前 UI 展示。

### Phase B：Trace Collector 落地

1. 在 `logs.sqlite` 增加 Trace 表和迁移。
2. 插桩 Turn、Context、LLM、Tool、Sub-Agent、Artifact。
3. 增加 Trace query/export API。
4. 增加 retention 和启动 abandoned recovery。

完成标准：

- 任意新 Turn 可以查询完整 Trace 树。
- confirmed token usage 与 Turn usage 一致。
- Trace 故障不影响 Turn。

### Phase C：Canonical Event Service

1. 建立 `SessionEventService.commit()`。
2. Turn/Tool/Plan/Artifact 改为 typed event 提交。
3. WebSocket 只广播已投影事件。
4. WebUI transcript 改为 projector/cache，不再独立写事实。
5. REST Thread Resource 从 SQLite 返回。

完成标准：

- 新会话可仅凭 canonical JSONL + SQLite 完整恢复。
- 删除 WebUI transcript cache 后会话仍能正常展示。

### Phase D：GUI Read Model 切换

1. 增加 `ThreadResourceStore`。
2. 消息、runtime、Plan 和 artifact revision 统一按 Session 应用。
3. 支持 event gap snapshot recovery。
4. 停止消息内容去重和 legacy Plan hydration 主路径。
5. 对新旧路径进行 shadow compare，差异写诊断日志。

完成标准：

- 快速切换会话不串运行态、Plan、Steps、usage 或 Artifact。
- WebSocket 断开重连后状态与 REST snapshot 一致。

### Phase E：历史迁移

1. 扫描 legacy Session/WebUI transcript。
2. 按稳定 Session 身份生成或补齐 canonical events。
3. 记录 migration watermark 和来源文件 hash。
4. 无法确认归属的数据进入 Legacy Quarantine，不猜测项目。
5. 迁移后执行 projector rebuild 和 shadow compare。

完成标准：

- 旧会话可读。
- 不产生重复最终回答。
- 不产生跨项目关联。

### Phase F：兼容清理

至少经过一个稳定发布周期后删除：

- legacy WebUI JSON 新写路径。
- WebUI transcript 独立事实写入路径。
- `_WEBSOCKET_TURN_WALL_STARTED_AT`。
- GUI message-derived Plan 主路径。
- GUI 按文本/时间去重正常路径。
- 无身份、无 revision 的 progress compatibility event。
- 无生产引用的旧 task execution/progress store。

保留：

- 一次性 legacy import adapter。
- JSONL rebuild 工具。
- 数据导出和损坏恢复工具。

## 13. 建议代码改动位置

### 13.1 nanobot

```text
nanobot/runtime/trace_context.py               新增 TraceContext / ContextVar
nanobot/observability/trace_collector.py       新增 TraceCollector
nanobot/observability/trace_store.py           新增 logs.sqlite Trace schema/API
nanobot/storage/session_events.py              新增/收口 SessionEventService
nanobot/storage/journal.py                     升级 Event schema v3
nanobot/storage/state.py                       补充 trace/event/message 字段与 projector
nanobot/runtime/turn_lifecycle.py              创建/终止 Trace
nanobot/agent/context.py                       输出 Context Manifest
nanobot/agent/runner.py                        LLM/Tool Run 插桩
nanobot/agent/subagent.py                      继承 trace/run parent
nanobot/webui/session_turns.py                 改为 Resource adapter，删除事实双写
nanobot/webui/transcript.py                    降为迁移/cache 层
nanobot/webui/ws_http.py                       Thread/Trace REST API
```

### 13.2 nanobot-gui

```text
src/core/types.ts                              Event/Trace/Thread Resource 类型
src/core/api.ts                                Thread Snapshot / Trace API
src/core/nanobotClient.ts                      应用 canonical event，删除内容去重主路径
src/hooks/useNanobotStream.ts                  stream buffer 与 committed event 分离
src/stores/threadResourceStore.ts              新增按 Session 分区的 Read Model
src/stores/chatStore.ts                        降为导航/输入/UI 偏好
src/stores/turnPlanStore.ts                    取消 legacy message hydration 主路径
src/stores/conversationWorkbenchStore.ts       直接消费 canonical Plan
src/components/chat/*                          从 Thread Resource 渲染
src/components/panel/*                         Progress/Artifact 按 session resource 渲染
```

## 14. 测试矩阵

### 14.1 Trace 单元测试

- Turn 创建一条 Trace 和主 Run。
- 两次 LLM 调用形成两个 Span，sequence 稳定。
- 并行工具 Span 共享父 Run，但拥有不同 span id。
- 子 Agent 继承 trace id、使用独立 run id。
- confirmed usage 正确累加，live estimate 不写入最终账本。
- cached input tokens 单独记录。
- TTFT 只记录第一次有效 provider stream event。
- Trace 中不包含 API key、authorization、cookie 和私有 reasoning。
- Trace writer 失败不影响 Agent result。
- gateway 重启收口 abandoned Trace。

### 14.2 Event/Projector 测试

- JSONL append 后 SQLite projector 成功。
- projector 失败后重放成功。
- 重复 event id 不重复写消息、工具或 Artifact link。
- event sequence gap fail closed。
- Session project id 不可覆盖。
- terminal Turn 不接受迟到 final answer。
- 同一 Turn 只生成一条 final message。
- Plan revision 不回退。

### 14.3 WebSocket/REST 集成测试

- WebSocket 先断开再恢复，可由 snapshot 补齐。
- REST snapshot 与连续应用 event 的结果一致。
- 旧 runtime epoch active 不会恢复为 running。
- 切换 A/B 会话时 runtime、Plan、Steps、usage、Artifact 不串。
- 非当前会话事件只更新对应 Session resource。
- stream delta 丢失后 committed answer 仍完整。

### 14.4 GUI 测试

- 不调用文本内容去重也不会显示重复回答。
- 不读取 legacy Plan message 也能展示右侧 Progress。
- completed Turn 必然清除 thinking strip、stop button 和 running icon。
- loading Session 时不短暂渲染上一个会话内容。
- 当前 Session event gap 显示刷新态，snapshot 后恢复。
- ToolStep 与最终回答使用同一个 turn id，不互相移动内容。

### 14.5 迁移测试

- legacy JSONL/WebUI transcript 迁移后消息顺序一致。
- 重复 legacy assistant slice 合并为一个 canonical final。
- 无 project 归属的数据进入 quarantine。
- 删除可重建 WebUI cache 后，历史展示不变。
- `state.sqlite` 删除后可从 canonical events 重建。

## 15. 性能预算

首期目标：

- Event Journal append + SQLite projection：p95 小于 15 ms，不包含真实磁盘异常。
- Trace begin/end 入队：p95 小于 1 ms。
- Trace terminal flush：默认上限 200 ms。
- Thread snapshot 首屏查询：最近 100 条 item p95 小于 100 ms。
- 会话列表不得扫描完整 transcript。
- GUI 应用单条 canonical event：p95 小于 5 ms。
- 不持久化 token delta，避免 Trace/SQLite 随输出 token 数线性爆炸。

## 16. 安全与隐私

1. Trace 默认保存 metadata，不保存完整 Prompt 和工具结果。
2. Context Manifest 保存 hash、id、token 数和选择原因。
3. 如启用诊断内容采样，必须显式开关、长度上限和再次脱敏。
4. 私有 chain-of-thought 永不保存。
5. 工具参数按 schema 标记 secret/path/content；secret 字段统一替换为 `[REDACTED]`。
6. 项目 Trace 查询必须校验 project/session 关系。
7. Trace 导出 manifest 标记应用版本、schema version 和脱敏策略。
8. Trace retention 清理不能删除业务 Session Event Journal。

## 17. 验收标准

满足以下条件才可认为第 1、2 点解决：

### 17.1 统一 Trace

- 100% 新用户 Turn 有 trace id。
- 主 Agent 和子 Agent 都能在同一 Trace 树中定位。
- 每次 LLM 调用能看到 provider、model、TTFT、latency、confirmed usage 和 finish reason。
- 每次工具调用能看到开始、终态、耗时和错误码。
- 能回答本轮上下文由哪些 memory/document/skill/history 组成。
- Trace 不含私有 reasoning 和 secret。
- Trace 故障不会导致用户任务重复执行或失败。

### 17.2 单一事实源

- 新会话删除 WebUI transcript cache 后仍可完整恢复。
- GUI 不再通过消息内容去重解决正常路径重复回答。
- GUI 不再从消息 metadata 推导 canonical Plan。
- GUI 不再用本地 wall timer 或 streaming 状态决定 Thread running。
- 任意会话切换、重连和 gateway 重启后，GUI 状态与 REST Thread Resource 一致。
- JSONL 可重建 `state.sqlite` 的 Session/Turn/Message/Tool/Plan/Artifact 核心投影。
- 同一 Turn 的最终回答最多一条。
- A 项目事件永远不能更新 B 项目会话状态。

## 18. 明确不采用的方案

### 18.1 不采用“只存 SQLite”

原因：

- 失去 append-only 原始事实和简单灾难恢复路径。
- SQLite 损坏后难以重建。
- 与现有 Codex 风格双轨持久化方向冲突。

### 18.2 不采用“WebSocket 就是事实源”

原因：

- WebSocket 可以断线、重复、乱序和丢事件。
- 移动端、桌面端和重连客户端需要一致 snapshot。

### 18.3 不采用“GUI 自己修复”

原因：

- GUI 不知道真实 Turn 生命周期。
- 文本去重、时间窗口和消息角色推导只能掩盖后端重复事实。
- 多客户端会产生不同修复结果。

### 18.4 不采用“Trace 替代业务事件”

原因：

- Trace 有保留周期，可能被清理。
- Trace 是 best-effort 诊断数据。
- 会话、Artifact 和项目关系必须有更强的一致性保证。

## 19. 实施顺序结论

推荐严格按以下顺序推进：

```text
身份与协议
  → Trace Collector
  → Canonical Event Service
  → SQLite Thread Read Model
  → GUI ThreadResourceStore
  → shadow compare / backfill
  → 删除兼容写入和 GUI 推导
```

不要先大规模删除旧代码。只有当新旧路径在真实历史会话、重连、专家团队和 Artifact 场景下 shadow compare 一致后，才进入 Phase F 清理。

最终结果应该是：

```text
一个 Turn 状态权威
一个持久业务事件源
一个 SQLite 业务 Read Model
一个端到端 Trace
一个按 Session 分区的 GUI 镜像
```
