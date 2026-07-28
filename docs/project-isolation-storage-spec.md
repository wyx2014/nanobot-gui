# 项目隔离、会话持久化与产物索引 Spec

> 状态：Implemented（深度 Project RAG 明确排除；仅保留发布运维清理项）
> 目标版本：TpaRuyi 0.6.x 起分阶段实施
> 适用范围：Electron GUI、nanobot gateway、会话历史、项目、产物、记忆、检索、定时任务、诊断日志
> 核心方案：`project_id` 强隔离 + SQLite 当前状态 + 会话 JSONL 事件日志 + 文件系统产物

> 实时 ActiveTurn、终态事件、Runtime Snapshot 和 Plan 收口以
> [turn-lifecycle-runtime-spec.md](turn-lifecycle-runtime-spec.md) 为权威规范；SQLite 中的
> `running/active_turn_id` 只能作为历史投影或同 runtime epoch 的查询线索。

## 1. 文档目的

本文给出 TpaRuyi 项目、会话、消息、工具调用、产物、记忆和诊断日志的完整持久化与隔离方案，重点解决：

1. A 项目的 Agent 错误读取 B 项目的文件、会话、资料、记忆或产物。
2. 当前“项目”主要靠目录路径和 GUI 最近路径推导，缺少稳定身份。
3. 当前产物部分依赖扫描 workspace 和文件修改时间猜测归属，容易串会话。
4. PDF 已生成，但 GUI 仍显示“转化中”或“无法加载会话产物”。
5. 会话、项目和产物关系分散在 JSONL、文件系统及 GUI 本地状态中，查询和修复困难。
6. 运行时日志不够稳定，难以定位鉴权过期、产物索引失败、路径越界和投影异常。
7. 应用升级、数据库损坏或中途崩溃后，需要能够从持久事件恢复。

本方案不把 SQLite 当作文件权限的替代品。SQLite 负责身份、关系、约束和查询；文件系统隔离仍由 canonical path 校验、symlink 防逃逸和工具沙箱共同保证。

## 2. 与现有 Spec 的关系

本文是目标架构 Spec。实施完成后，下列旧设计由本文相应章节取代：

- `project-sidebar-spec.md` 中“第一版不新增独立项目表、项目从路径和 recentPaths 派生”的数据模型。
- `conversation-workbench-spec.md` 中“Artifacts API 扫描会话 workspace，按 session 创建时间筛选文件”的事实来源。
- `gui-backend-interface-spec.md` 中基于相对路径读取产物的接口，迁移为基于 `artifact_id` 的接口。

以下现有设计继续有效：

- 项目侧栏、会话列表、Progress、Steps、Artifacts 右栏的 UI 交互。
- GUI 不承担 Agent 执行和持久化权威。
- nanobot gateway 是 Agent loop、工具调用、会话、记忆和定时任务的 source of truth。
- PDF 使用固定 pipeline、明确阶段、超时、校验和降级产物。
- gateway 通过显式 base URL 的 REST 和 WebSocket 与 GUI 通信。

在迁移期内，旧接口可以保留兼容，但不得继续作为新会话的数据权威。

## 3. 结论摘要

目标架构采用三类持久化介质：

| 介质 | 保存内容 | 定位 |
| --- | --- | --- |
| `state.sqlite` | 项目、会话、轮次、消息投影、工具调用、产物登记、依赖关系、项目记忆、检索元数据、定时任务 | 运行时查询与关系约束权威 |
| `events/<session_id>.jsonl` | 会话输入、模型输出片段、安全 narration、工具事件、产物事件、turn 终态 | 追加写事件日志、历史重放与数据库重建来源 |
| 文件系统 | PDF、DOCX、XLSX、图片、附件、代码和其他实际文件字节 | 大文件内容权威 |

另使用独立的 `logs.sqlite` 保存结构化运行日志，避免高频日志写入影响核心状态库。

关键决策：

1. 每个新会话必须有非空、稳定的 `project_id`。
2. “普通对话”也属于系统内置的 Inbox 项目，不再使用 `NULL project_id`。
3. 历史无法确认归属的会话进入 Legacy Quarantine 项目，不能自动继承当前项目权限。
4. 会话首次创建后 `project_id` 不可原地修改；“移动会话”必须显式克隆或迁移。
5. 产物必须通过 `artifact_id` 注册，并通过关系表与 session、turn、tool call 关联。
6. 目录扫描只允许用于一次性历史迁移和人工修复，不参与新会话的正常列表查询。
7. 所有项目数据查询必须携带 `ProjectContext`，所有缓存键必须包含 `project_id`。
8. SQLite 不可用时，项目相关执行 fail closed，不得退回全局目录扫描。
9. 原始私有思维链不作为产品数据保存或展示；仅保存用户可见 narration、结构化计划、工具 trace 和最终回答。
10. 本期实现 Codex 式两阶段项目记忆、渐进式读取、使用度反馈、引用溯源和后台任务生命周期；不实现 Project RAG 的向量化深度能力。

## 4. Codex / Ruyi 思路对比

对 `/Users/wyx/ai/ruyi` 中 Codex 相关实现的本地代码分析表明，其存储大体采用：

- rollout JSONL 保存可重放的完整会话事件。
- SQLite 保存线程元数据和可查询投影。
- 独立 SQLite 保存 tracing logs、goals、memory 等高频或独立生命周期数据。
- 启动时支持 backfill、watermark、lease、兼容迁移。
- SQLite 使用 WAL、`synchronous=NORMAL`、busy timeout、连接池和增量 vacuum。
- 数据库损坏时保留损坏文件并从 rollout JSONL 重建状态索引。

需要准确区分 Codex 中的两种“trace”：

1. 用户消息、模型消息、工具调用、上下文变化等会话 trace 主要保存在 rollout JSONL。
2. 程序运行 tracing log 可以保存在独立日志 SQLite 中，并通过 thread id 关联。

本方案借鉴其双轨持久化和恢复思路，但不直接照搬：

| 能力 | Codex / Ruyi 可借鉴部分 | TpaRuyi 调整 |
| --- | --- | --- |
| 会话事件 | JSONL 追加写、可重放 | 每条事件强制带 `project_id`、`session_id` 和序号 |
| SQLite | 线程元数据索引、迁移、backfill | 扩展为项目、会话、产物、记忆的强关系模型 |
| 项目识别 | 主要可按 `cwd` 查询或过滤 | 使用稳定 `project_id`，路径不再是安全身份 |
| 产物 | 未作为核心显式关系建模 | 增加 artifact registry 和 session/turn/tool 显式依赖 |
| 记忆 | 可存在跨 cwd 的全局聚合 | 项目事实禁止进入全局记忆，只允许白名单用户偏好全局化 |
| 记忆生成 | rollout 先逐会话提取，再由独立 Agent 全局归并 | 保留两阶段设计，但提取、筛选、归并和读取全部以单个 `project_id` 为硬边界 |
| 记忆读取 | 摘要常驻上下文，按关键词渐进打开详细记忆 | 保留 progressive disclosure，并增加来源引用和使用度回写 |
| RAG | 主要依赖 Agent 主动文件/关键词搜索，不是标准向量 RAG | 本期只保留项目内基础文本分块和关键词检索，不实现 embedding、向量召回和 reranker |
| 日志 | 独立 `logs.sqlite` | 增加 project/session/turn/tool/artifact 关联字段和脱敏 |
| 损坏恢复 | SQLite 可由 rollout 重建 | 保留，但项目隔离信息必须写入 JSONL 首事件 |

因此，正确结论不是“把全部 trace 都塞进 SQLite”，而是：

```text
JSONL 保存可重放会话事实
        +
SQLite 保存当前可查询状态、显式关系和约束
        +
文件系统保存实际产物
```

## 5. 目标与非目标

### 5.1 目标

1. 项目之间默认无文件、会话、产物、记忆和检索数据的隐式共享。
2. 任意产物都可以回答“属于哪个项目、哪个会话、哪一轮、哪个工具调用”。
3. GUI 切换会话时只查询该会话显式关联的产物。
4. PDF 文件一旦校验并注册为 ready，GUI 立即可打开，不依赖整轮 Agent 是否已结束。
5. 会话历史可从 JSONL 重放，SQLite 可修复或重建。
6. SQLite schema 能通过数据库约束阻止跨项目错误关联。
7. 日志能定位一次产物请求的鉴权、查询、路径校验、文件读取和预览失败原因。
8. 兼容已有会话并提供可控、可回滚的迁移路径。

### 5.2 非目标

1. 不在 GUI 中直接打开或写入 SQLite。
2. 不把 PDF/DOCX 等文件 BLOB 存入 SQLite。
3. 不提供多用户云协作、成员权限和远程同步。
4. 不允许普通 Agent 自由查询全局数据库绕过项目范围。
5. 不保存或展示模型的原始私有思维链。
6. 不在本次方案中重新设计完整版本控制系统。
7. 不因引入 SQLite 而取消现有 workspace path guard、命令审批或沙箱。
8. 不在本期实现 Project RAG 深度能力，包括 embedding 生成、向量数据库/ANN、语义召回、关键词与向量混合召回、语义重排、OCR/版面理解和 PDF/Office 全量语义摄取。
9. 不把两阶段项目记忆误称为向量 RAG；记忆归纳由模型完成，在线定位仍采用项目内关键词搜索和显式来源指针。

## 6. 核心术语

- **Project**：安全和知识隔离域，具有稳定 `project_id`，可绑定一个本地目录。
- **Inbox Project**：系统内置的普通对话域，拥有独立受管工作目录，不允许自动访问真实项目目录。
- **Legacy Quarantine Project**：历史归属不确定会话的隔离域，默认禁止文件工具，等待用户确认。
- **Session**：一次可持续恢复的会话线程，创建后固定属于一个项目。
- **Turn**：一次用户输入到 Agent 终态之间的执行单元。
- **Message**：用户、助手、系统或工具的可显示/可投影消息。
- **Event Journal**：按 session 追加写的 JSONL 原始事件。
- **Artifact**：被 gateway 显式登记的文件产物或输入附件快照。
- **Artifact Link**：artifact 与 session、turn、tool call 的明确关系。
- **ProjectContext**：运行时不可省略的项目边界对象。
- **Projection**：由 JSONL 事件计算得到的 SQLite 当前状态。
- **Operational Log**：程序运行日志，不等同于会话 transcript。
- **Stage 1 Memory**：从单个已结束 session rollout 中提取的项目内原始记忆和会话摘要。
- **Consolidated Project Memory**：将同一项目的多个 Stage 1 Memory 去重、校验和归并后形成的高信号长期记忆。
- **Progressive Disclosure**：先给模型注入有硬上限的项目记忆摘要，再按需搜索索引并打开少量详细来源。

## 7. 设计不变量

以下规则必须由代码、数据库约束和测试共同保证：

1. `sessions.project_id` 对新数据永远非空。
2. session 的 `project_id` 在创建后不可通过普通 update 修改。
3. turn、message、tool call、artifact link、project memory 都必须能追溯到同一 `project_id`。
4. 任何跨表关联同时校验实体 id 和 `project_id`，不能只依赖应用层约定。
5. gateway 不接受客户端用 `project_id` 覆盖 session 已有归属。
6. 子 Agent、定时任务和后台重试继承父任务的 `ProjectContext`。
7. 项目目录 canonical realpath 之外的路径默认拒绝。
8. symlink 最终目标不在允许根目录内时拒绝。
9. 产物列表以 artifact registry 为准，不以目录扫描结果为准。
10. artifact 内容读取必须重新执行项目关系和路径边界检查。
11. 项目记忆、基础文本索引和检索缓存查询必须包含 `project_id`；未来若引入 embedding，也必须使用同一硬隔离规则。
12. 数据库不可用或项目归属不确定时，不得扩大读取范围。
13. JSONL 的第一条 session 事件必须包含项目身份，确保 SQLite 可重建。
14. WebSocket 事件必须携带足够的 project/session/turn 身份供 GUI 去重和校验。

## 8. 总体架构

```text
┌──────────────────────────────────────────────────────────┐
│ Electron / React GUI                                     │
│ project sidebar · chat · steps · progress · artifacts    │
└──────────────────────────┬───────────────────────────────┘
                           │ REST + WebSocket
                           ▼
┌──────────────────────────────────────────────────────────┐
│ nanobot gateway                                          │
│                                                          │
│  SessionService ── ProjectContext ── Agent / Tools        │
│       │                   │                 │              │
│       │                   ├─ Memory / RAG   ├─ PathGuard   │
│       │                   ├─ Cron/Subagent  └─ Artifacts   │
│       │                   │                                │
│       ├─ EventJournal ───────────────► session JSONL       │
│       ├─ StateRepository ────────────► state.sqlite        │
│       └─ StructuredLogger ───────────► logs.sqlite         │
└──────────────────────────────────────────────────────────┘
                           │
                           ▼
                 project files / managed artifacts
```

职责边界：

- GUI 只通过 gateway API 读取项目、会话和产物关系。
- gateway 负责身份解析、事务、事件追加、投影、权限和路径安全。
- Agent 和工具不能直接拼 SQL；只能使用带 `ProjectContext` 的 repository/service。
- Electron 主进程不直接修改 gateway SQLite。

## 9. 持久化目录布局

建议由 gateway 在应用 userData 下管理版本化数据目录，示例：

```text
<userData>/nanobot/
  state/
    state.sqlite
    state.sqlite-wal
    state.sqlite-shm
    logs.sqlite
    logs.sqlite-wal
    logs.sqlite-shm
    backups/
  events/
    2026/
      07/
        <session_id>.jsonl
  managed-artifacts/
    <project_id>/
      <artifact_id>/
        content.pdf
  project-memories/
    <project_id>/
      memory_summary.md
      MEMORY.md
      raw_memories.md
      rollout_summaries/
        <session_slug>.md
      skills/
  inbox-workspace/
  quarantine/
```

要求：

- 实际根目录由 gateway 配置返回，GUI 不硬编码。
- `managed-artifacts` 以 `project_id` 分区。
- `project-memories` 也必须以稳定 `project_id` 分区；Agent 不得通过一个全局目录搜索所有项目记忆。
- `memory_summary.md`、`MEMORY.md` 和 `rollout_summaries/` 是 SQLite 记忆记录的可读投影，不是跨项目共享知识库。
- 普通项目文件可以仍保存在用户项目目录，但注册时记录项目内相对路径和内容摘要。
- 外部附件必须复制或导入项目受管目录后再供 Agent 使用，不能长期保存任意外部绝对路径权限。
- backup、event 和 artifact 路径不得暴露为浏览器可直接访问的静态目录。

## 10. SQLite 运行参数

`state.sqlite` 和 `logs.sqlite` 初始化时使用：

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA auto_vacuum = INCREMENTAL;
```

建议：

- Python gateway 使用小连接池，最大连接数默认 5。
- 写操作保持短事务；文件渲染、hash 计算和网络请求不得放在 SQLite 写事务内。
- migrations 必须有单调版本号并在 gateway 启动早期执行。
- 每次升级前做轻量 checkpoint；重大迁移前创建一致性备份。
- 定期执行 incremental vacuum，不在用户交互路径执行 full vacuum。
- `logs.sqlite` 独立，避免高频日志写入阻塞核心状态。
- 项目强关系表第一阶段保持在同一个 `state.sqlite`，避免跨 SQLite 无法使用 foreign key。

## 11. 数据模型

### 11.1 projects

```sql
CREATE TABLE projects (
  id                  TEXT PRIMARY KEY,
  kind                TEXT NOT NULL
                      CHECK (kind IN ('workspace', 'inbox', 'legacy_quarantine')),
  name                TEXT NOT NULL,
  root_path           TEXT,
  canonical_root_path TEXT,
  filesystem_identity TEXT,
  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'missing', 'detached', 'archived')),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  last_opened_at      INTEGER,
  settings_json       TEXT NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX projects_canonical_root_unique
ON projects(canonical_root_path)
WHERE canonical_root_path IS NOT NULL AND status != 'archived';
```

说明：

- `id` 使用 UUID/ULID，路径不是主键。
- `canonical_root_path` 用于本机去重和路径校验，但不承担跨设备稳定身份。
- `filesystem_identity` 可保存 volume/file id，辅助识别目录改名或移动。
- 项目重命名只改 `name`，不自动重命名目录。
- 项目目录丢失时标记 `missing`，不静默切换到同名目录。

### 11.2 sessions

```sql
CREATE TABLE sessions (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  session_key         TEXT NOT NULL UNIQUE,
  title               TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'completed', 'failed', 'cancelled', 'archived')),
  event_log_path      TEXT NOT NULL,
  next_event_seq      INTEGER NOT NULL DEFAULT 1,
  active_turn_id      TEXT,
  model_provider      TEXT,
  model_name          TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  completed_at        INTEGER,
  metadata_json       TEXT NOT NULL DEFAULT '{}',
  UNIQUE (id, project_id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX sessions_project_updated
ON sessions(project_id, updated_at DESC);

CREATE TRIGGER sessions_project_immutable
BEFORE UPDATE OF project_id ON sessions
WHEN NEW.project_id != OLD.project_id
BEGIN
  SELECT RAISE(ABORT, 'session project_id is immutable');
END;
```

规则：

- GUI 的 conversation id 与 gateway 的 session id 应逐步统一。
- 兼容期保留 `session_key = "websocket:<conversation_id>"` 映射。
- `project_id` 由 gateway 创建 session 时确定。
- 对已有 session 发送消息时，gateway 根据 session 查询项目，不信任客户端重新传入的项目。
- 普通对话绑定 Inbox Project。

### 11.3 turns

```sql
CREATE TABLE turns (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  session_id          TEXT NOT NULL,
  turn_index          INTEGER NOT NULL,
  status              TEXT NOT NULL
                      CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  user_message_id     TEXT,
  started_at          INTEGER NOT NULL,
  ended_at            INTEGER,
  error_code          TEXT,
  error_message       TEXT,
  usage_json          TEXT,
  UNIQUE (id, project_id),
  UNIQUE (session_id, turn_index),
  FOREIGN KEY (session_id, project_id)
    REFERENCES sessions(id, project_id)
);

CREATE INDEX turns_session_index
ON turns(session_id, turn_index);
```

turn 必须有明确终态。即使 Agent 超时、停止或 PDF pipeline 失败，也要落为 `failed` 或 `cancelled` 并发送 `turn_end`。

### 11.4 messages

```sql
CREATE TABLE messages (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  session_id          TEXT NOT NULL,
  turn_id             TEXT,
  sequence_no         INTEGER NOT NULL,
  role                TEXT NOT NULL
                      CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  message_kind        TEXT NOT NULL DEFAULT 'answer',
  content_json        TEXT NOT NULL,
  is_final            INTEGER NOT NULL DEFAULT 1,
  created_at          INTEGER NOT NULL,
  UNIQUE (session_id, sequence_no),
  FOREIGN KEY (session_id, project_id)
    REFERENCES sessions(id, project_id),
  FOREIGN KEY (turn_id, project_id)
    REFERENCES turns(id, project_id)
);
```

说明：

- SQLite 保存适合列表、搜索和恢复 UI 的消息投影。
- token 级流式 delta 只需要进入 JSONL；完成后合并为消息投影，避免数据库写放大。
- narration 使用独立 `message_kind = 'narration'`，不会混入最终回答。
- 原始私有 reasoning 不落入普通消息表。

### 11.5 tool_calls

```sql
CREATE TABLE tool_calls (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  session_id          TEXT NOT NULL,
  turn_id             TEXT NOT NULL,
  parent_tool_call_id TEXT,
  tool_name           TEXT NOT NULL,
  status              TEXT NOT NULL
                      CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  input_json          TEXT,
  output_summary_json TEXT,
  started_at          INTEGER,
  ended_at            INTEGER,
  error_code          TEXT,
  error_message       TEXT,
  UNIQUE (id, project_id),
  FOREIGN KEY (session_id, project_id)
    REFERENCES sessions(id, project_id),
  FOREIGN KEY (turn_id, project_id)
    REFERENCES turns(id, project_id),
  FOREIGN KEY (parent_tool_call_id, project_id)
    REFERENCES tool_calls(id, project_id)
);
```

工具输入和输出必须脱敏。API key、Authorization header、cookie 和大段二进制不得写入。

### 11.6 Steps 与 Progress

OpenWorker 风格的 Steps、计划和右侧 Progress 也需要可恢复，不能只存在 GUI 内存中。JSONL 保存每次 `plan_updated`、narration 和工具状态变化；SQLite 保存当前投影：

```sql
CREATE TABLE turn_progress (
  turn_id             TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  session_id          TEXT NOT NULL,
  revision            INTEGER NOT NULL DEFAULT 0,
  current_step_key    TEXT,
  note                TEXT,
  status              TEXT NOT NULL
                      CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  updated_at          INTEGER NOT NULL,
  UNIQUE (turn_id, project_id),
  FOREIGN KEY (turn_id, project_id)
    REFERENCES turns(id, project_id),
  FOREIGN KEY (session_id, project_id)
    REFERENCES sessions(id, project_id)
);

CREATE TABLE turn_steps (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  session_id          TEXT NOT NULL,
  turn_id             TEXT NOT NULL,
  step_key            TEXT NOT NULL,
  ordinal             INTEGER NOT NULL,
  title               TEXT NOT NULL,
  status              TEXT NOT NULL
                      CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  detail               TEXT,
  started_at          INTEGER,
  ended_at            INTEGER,
  updated_at          INTEGER NOT NULL,
  UNIQUE (turn_id, step_key),
  FOREIGN KEY (turn_id, project_id)
    REFERENCES turns(id, project_id),
  FOREIGN KEY (session_id, project_id)
    REFERENCES sessions(id, project_id)
);
```

规则：

- `plan_updated` 每次增加 revision，旧 revision 保留在 JSONL，不需要在 SQLite 保留完整副本。
- GUI 恢复会话时，从 `turn_progress + turn_steps + narration messages + tool_calls` 重建 Steps。
- narration 是面向用户的执行说明，例如“接下来读取更详细的市场数据”，不是私有 reasoning。
- turn 结束时不得留下 `running` step；根据终态收口为 completed、failed 或 cancelled。
- GUI 的 `taskExecutionStore` 只是该投影的实时镜像，不是持久化事实来源。

### 11.7 artifacts

```sql
CREATE TABLE artifacts (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  status              TEXT NOT NULL
                      CHECK (status IN ('staging', 'ready', 'failed', 'missing', 'quarantined')),
  storage_kind        TEXT NOT NULL
                      CHECK (storage_kind IN ('project_file', 'managed_copy')),
  relative_path       TEXT NOT NULL,
  display_name        TEXT NOT NULL,
  artifact_kind       TEXT NOT NULL,
  mime_type           TEXT,
  byte_size           INTEGER,
  sha256              TEXT,
  created_by_session_id   TEXT,
  created_by_turn_id      TEXT,
  created_by_tool_call_id TEXT,
  supersedes_artifact_id  TEXT,
  validation_json     TEXT NOT NULL DEFAULT '{}',
  created_at          INTEGER NOT NULL,
  ready_at            INTEGER,
  updated_at          INTEGER NOT NULL,
  UNIQUE (id, project_id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (created_by_session_id, project_id)
    REFERENCES sessions(id, project_id),
  FOREIGN KEY (created_by_turn_id, project_id)
    REFERENCES turns(id, project_id),
  FOREIGN KEY (created_by_tool_call_id, project_id)
    REFERENCES tool_calls(id, project_id),
  FOREIGN KEY (supersedes_artifact_id, project_id)
    REFERENCES artifacts(id, project_id)
);

CREATE INDEX artifacts_project_created
ON artifacts(project_id, created_at DESC);
```

设计选择：

- `relative_path` 永远相对于项目根或该项目 managed artifact 根。
- artifact 不以路径作为身份；同一路径被重写时可以创建新 artifact，并用 `supersedes_artifact_id` 建立版本链。
- `ready` 表示文件已原子写入并通过最低校验，可以立即预览。
- `missing` 表示登记仍在但实际文件已被用户移走。
- `quarantined` 表示迁移时无法安全确认项目边界。

### 11.8 artifact_links

```sql
CREATE TABLE artifact_links (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  artifact_id         TEXT NOT NULL,
  session_id          TEXT NOT NULL,
  turn_id             TEXT,
  tool_call_id        TEXT,
  relation_type       TEXT NOT NULL
                      CHECK (relation_type IN (
                        'generated', 'modified', 'attached',
                        'referenced', 'intermediate', 'final'
                      )),
  origin_event_id     TEXT,
  created_at          INTEGER NOT NULL,
  UNIQUE (artifact_id, session_id, turn_id, relation_type),
  FOREIGN KEY (artifact_id, project_id)
    REFERENCES artifacts(id, project_id),
  FOREIGN KEY (session_id, project_id)
    REFERENCES sessions(id, project_id),
  FOREIGN KEY (turn_id, project_id)
    REFERENCES turns(id, project_id),
  FOREIGN KEY (tool_call_id, project_id)
    REFERENCES tool_calls(id, project_id)
);

CREATE INDEX artifact_links_session
ON artifact_links(project_id, session_id, created_at DESC);

CREATE UNIQUE INDEX artifact_links_origin_event_unique
ON artifact_links(origin_event_id)
WHERE origin_event_id IS NOT NULL;
```

这张表是回答“哪个会话拥有哪个产物”的唯一正常路径：

```sql
SELECT a.*
FROM artifact_links l
JOIN artifacts a
  ON a.id = l.artifact_id
 AND a.project_id = l.project_id
WHERE l.project_id = :project_id
  AND l.session_id = :session_id
  AND a.status IN ('ready', 'missing')
ORDER BY l.created_at DESC;
```

不得再通过“文件修改时间晚于 session 创建时间”推断归属。

### 11.9 agent_edges

专家团队和子 Agent 必须保留父子关系：

```sql
CREATE TABLE agent_edges (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  parent_session_id   TEXT NOT NULL,
  parent_turn_id      TEXT NOT NULL,
  child_session_id    TEXT NOT NULL,
  spawn_tool_call_id  TEXT,
  created_at          INTEGER NOT NULL,
  FOREIGN KEY (parent_session_id, project_id)
    REFERENCES sessions(id, project_id),
  FOREIGN KEY (parent_turn_id, project_id)
    REFERENCES turns(id, project_id),
  FOREIGN KEY (child_session_id, project_id)
    REFERENCES sessions(id, project_id),
  FOREIGN KEY (spawn_tool_call_id, project_id)
    REFERENCES tool_calls(id, project_id)
);
```

child session 必须和 parent session 处于同一 project。需要跨项目时必须由用户发起新的显式任务，不能由模型自行切换。

### 11.10 项目记忆与检索

#### 11.10.1 本期能力边界

本期将“项目记忆”和“Project RAG”拆开：

- 项目记忆负责从历史会话中提取高信号事实、用户在该项目中的稳定偏好、工作流、失败经验和验证方法。
- 基础 Project RAG 只负责已经登记的项目文本产物的分块、关键词匹配和来源展示。
- 不实现 embedding、向量数据库、语义召回、混合召回、语义 reranker、OCR 或复杂文档版面解析。
- `project_chunks.embedding_ref` 是未来兼容保留字段，本期保持 `NULL`，运行时不得因为该字段存在而声称支持向量检索。

基础文本检索继续满足以下最低要求：

- 只能查询当前 `ProjectContext.project_id`。
- 返回 `document_id`、relative path、chunk ordinal 和文本片段，支持来源展示。
- 结果数量和注入 token 数必须有硬上限。
- 没有关键词命中时返回空，不允许扩大为全局搜索。
- PDF、DOCX 等只有在已有确定性文本提取结果时才允许进入基础索引；本期不新增深度摄取 pipeline。

#### 11.10.2 SQLite 模型

```text
project_memory_stage1(
  id, project_id, source_session_id, source_rollout_revision,
  raw_memory, rollout_summary, rollout_slug,
  generated_at, usage_count, last_used_at,
  selected_for_consolidation, selected_source_revision
)

project_memory_jobs(
  id, project_id, phase, job_key, status,
  lease_owner, lease_expires_at, retry_count, retry_at,
  input_watermark, completed_watermark, error_json,
  created_at, updated_at, completed_at
)

project_memories(
  id, project_id, kind, title, content, confidence,
  status, created_at, updated_at
)

project_memory_sources(
  memory_id, project_id, stage1_id, source_session_id,
  source_turn_id, source_event_id, evidence_locator
)

project_documents(
  id, project_id, source_artifact_id, relative_path,
  content_hash, indexing_status, created_at, updated_at
)

project_chunks(
  id, project_id, document_id, ordinal, text, embedding_ref
)

global_preferences(
  key, value_json, source, updated_at
)
```

约束：

- `project_memory_stage1` 对 `project_id + source_session_id + source_rollout_revision` 唯一，重复启动不会重复提取同一版本。
- `project_memory_jobs` 对 `project_id + phase + job_key` 唯一，支持 lease、重试退避和崩溃接管。
- `project_memory_sources` 的所有外键都带 `project_id`，禁止把 B 项目来源挂到 A 项目记忆。
- `project_memories.kind` 至少支持 `project_preference`、`workflow`、`repo_fact`、`failure_shield`、`decision_rule` 和 `reference`.
- 删除或归档来源 session 时默认保留记忆来源指针；若源文件不可读，标记 provenance missing，不静默伪造来源。
- `global_preferences` 只允许白名单类型，例如语言、称呼、输出格式偏好和无敏感性的 UI 偏好。
- 项目事实、公司研究、代码知识和业务资料只能写入当前项目，禁止提升为全局偏好。

#### 11.10.3 Phase 1：单会话记忆提取

当 root session 已完成且空闲达到阈值后，后台任务可以为该 session 生成 Stage 1 Memory：

1. 从 `state.sqlite` 领取带 lease 的候选任务，候选必须属于单个 project。
2. 从 session JSONL 读取用户消息、最终助手消息、工具结果摘要、验证证据和产物引用。
3. 过滤流式 delta、重复 narration、密钥、token、cookie、超大工具原文和无复用价值的临时事实。
4. 调用模型生成结构化 `raw_memory`、`rollout_summary` 和可选 `rollout_slug`。
5. 没有高信号内容时允许 `succeeded_no_output`，不得为了填充记忆而编造总结。
6. 对输出再次执行 secret redaction、长度限制和 project/session 身份校验。
7. 将成功结果写入 `project_memory_stage1`；失败任务记录错误、退避时间和剩余重试次数。

Phase 1 必须满足：

- 只处理非 ephemeral 的 root session，不重复处理 subagent session；子 Agent 的有效结论由父 session rollout 统一沉淀。
- 每次启动扫描、领取数量和并发数均有硬上限。
- 模型请求在 SQLite 事务外执行。
- rollout 内容视为不可信数据，不允许其中的文本改变记忆写入规则。
- 生成结果必须带来源 session 和 rollout revision，能够判断是否过期。

#### 11.10.4 Phase 2：单项目归并

Phase 2 只归并一个 `project_id` 下的 Stage 1 Memory：

1. 领取该项目唯一的 consolidation lease。
2. 在有界集合中按 `usage_count`、`last_used_at`、`generated_at` 和 source revision 选择输入。
3. 把选择结果投影到该项目目录下的 `raw_memories.md` 和 `rollout_summaries/`。
4. 计算与上次成功基线的增量变化，避免每次重写全部记忆。
5. 启动无网络、无跨项目权限、禁止递归 delegation 的内部 consolidation agent。
6. 更新 `MEMORY.md`、`memory_summary.md`、可复用项目 skills 及 `project_memories/project_memory_sources`。
7. 只有文件投影和 SQLite 记录均成功后推进 completed watermark；失败保留上次成功版本并记录可重试状态。

归并规则：

- `memory_summary.md` 是高密度导航摘要，不是完整会话摘要；必须有严格 token 上限。
- `MEMORY.md` 保存按主题组织的项目手册和详细来源指针。
- `rollout_summaries/` 保存少量必要证据和可复用结论，不复制完整 transcript。
- 新证据与旧记忆冲突时保留冲突和来源，不直接覆盖成无来源的“最终事实”。
- 删除、失效或不再入选的来源必须触发遗忘/降级处理，防止陈旧结论永久残留。
- consolidation agent 只能读写当前 `<project_id>` 的 memory root。

#### 11.10.5 在线读取：渐进式披露

每轮构建上下文时采用固定读取路径：

1. 根据 session 重建并验证 `ProjectContext`。
2. 注入当前项目有硬上限的 `memory_summary.md`；禁止注入其他项目摘要。
3. Agent 判断历史项目知识是否相关；明显自包含的简单请求可以跳过详细记忆搜索。
4. 从当前项目 `MEMORY.md` 提取少量关键词并执行项目内文本搜索。
5. 只有索引明确指向时，才打开最多 1～2 个相关 memory block、rollout summary 或项目 skill。
6. 若需要当前事实，继续读取当前项目文件或调用工具验证；历史记忆必须允许被新证据纠正。
7. 最终回答若实质使用了长期记忆，应返回可解析的来源元数据，至少包含 memory id、source session id 和 evidence locator。
8. 成功使用的记忆异步增加 `usage_count` 并更新 `last_used_at`；不得在模型请求关键路径等待该统计写入。

读取预算：

- 摘要、搜索结果、详细记忆和基础 Project RAG 片段分别设置独立 token 上限。
- 一次普通 memory pass 建议不超过 4～6 个读取/搜索步骤。
- 无命中时立即停止，不扫描所有 rollout summary。
- 缓存键至少包含 `project_id + memory_version + normalized_query`。

#### 11.10.6 安全与全局偏好

- 项目事实、文件摘要、公司研究、代码知识和业务资料只能进入 `project_memories`。
- 不允许把“青岛啤酒项目结论”等内容合并进跨项目全局记忆。
- 全局偏好提升必须经过白名单分类；不确定内容留在项目内。
- 用户显式要求忘记项目记忆时，删除/失效 SQLite 记录、文件投影和检索缓存，并保留不含原文的审计事件。
- 项目 archive 后记忆只读；project relocate 保留 project id，因此记忆身份不变。
- SQLite 不可用、项目归属不一致或 memory root 越界时，记忆读取和写入 fail closed。

### 11.11 定时任务

所有会调用 Agent、访问文件或检索资料的用户定时任务必须绑定项目：

```text
schedules(
  id, project_id, name, cron, prompt, status,
  created_session_id, last_run_session_id, ...
)
```

运行时从 schedule 记录创建 `ProjectContext`。项目被移除、丢失或归档时，任务暂停并提示用户，不回退到默认 workspace。

系统内部清理、vacuum 等任务使用独立 internal job 模型，不假装属于用户项目。

### 11.12 projector_state

```sql
CREATE TABLE projector_state (
  session_id          TEXT PRIMARY KEY,
  event_log_path      TEXT NOT NULL,
  last_event_seq      INTEGER NOT NULL DEFAULT 0,
  last_event_id       TEXT,
  last_projected_at   INTEGER,
  lease_owner         TEXT,
  lease_expires_at    INTEGER,
  error_json          TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

用于增量投影、启动 backfill、崩溃恢复和并发 lease。

## 12. JSONL 会话事件协议

### 12.1 事件 envelope

每行一个 JSON 对象：

```json
{
  "schema_version": 1,
  "event_id": "evt_01K...",
  "sequence_no": 42,
  "timestamp": "2026-07-26T10:20:30.123Z",
  "project_id": "prj_01K...",
  "session_id": "ses_01K...",
  "turn_id": "turn_01K...",
  "type": "artifact_ready",
  "payload": {}
}
```

要求：

- `event_id` 全局唯一。
- `sequence_no` 在单 session 内严格递增。
- 同一 session 只能通过一个串行 append writer 写入。
- 事件至少 flush 到操作系统；关键边界事件建议 `fsync`。
- projector 以 `event_id` 幂等处理，重复回放不产生重复行。
- 事件中的 `project_id` 必须与 session 创建事件一致，否则视为损坏或越界。

### 12.2 主要事件类型

```text
session_created
session_metadata_updated
turn_started
user_message_committed
assistant_stream_delta
narration_committed
message_committed
plan_updated
tool_call_started
tool_call_completed
tool_call_failed
file_write_started
artifact_ready
artifact_failed
subagent_spawned
turn_completed
turn_failed
turn_cancelled
session_archived
memory_stage1_started
memory_stage1_completed
memory_stage1_failed
memory_consolidation_completed
```

`assistant_stream_delta` 可用于恢复流式过程，但 SQLite 只投影合并后的消息。

记忆事件只保存任务身份、输入 revision、状态和错误摘要，不把生成后的大段 memory 正文重复写入每个 session JSONL；正文由项目记忆 SQLite 和项目 memory root 管理。

### 12.3 不保存的内容

- Provider 的原始私有 chain-of-thought。
- API key、access token、Authorization header、cookie。
- 未脱敏的环境变量全集。
- 超大工具原始返回；应保存摘要和受管文件引用。

用户看到的“Let me fetch more detailed market data...”属于安全 narration，可以作为 `narration_committed` 保存并在 Steps 中重放。

## 13. ProjectContext

gateway 内部所有项目相关执行使用不可省略的上下文对象：

```python
@dataclass(frozen=True)
class ProjectContext:
    project_id: str
    session_id: str
    root_path: Path
    canonical_root_path: Path
    scope_kind: Literal["workspace", "inbox", "legacy_quarantine"]
    permissions: ProjectPermissions
```

创建流程：

1. 客户端创建会话时只提交所选 project id。
2. gateway 从 SQLite 读取 project，解析并验证目录。
3. gateway 创建 session，并把同一 project id 写入 JSONL 首事件和 SQLite。
4. 后续消息只提交 session id。
5. gateway 从 session 重新构建 ProjectContext。
6. 如果客户端同时提交了不同 project id，返回 `409 SESSION_PROJECT_MISMATCH`。

下列组件都必须显式接收 ProjectContext：

- Agent runner
- filesystem tools
- shell/computer use
- skill workspace
- MCP 调用的路径参数校验
- memory read/write
- RAG indexing/query
- subagent spawn
- cron execution
- artifact registry
- preview/download
- cache

不得通过全局 `current_workspace`、最近打开项目或 GUI 当前选中项隐式决定执行范围。

## 14. 文件系统隔离

SQLite 只能证明“关系正确”，不能证明真实路径安全。每次文件访问必须：

1. 从 SQLite 读取 project root。
2. 对 root 和目标路径做 canonical/realpath。
3. 拒绝绝对路径、空字节、`..` 逃逸和协议路径。
4. 检查最终 realpath 位于允许 root 内。
5. 对 symlink 的最终目标重复检查。
6. 写文件使用同目录临时文件 + atomic rename。
7. 读取 artifact 时再次检查，不能只信任创建时结果。
8. shell cwd 固定为项目 root 或其子目录。
9. 用户临时批准外部路径时，权限必须记录具体路径、项目、会话和有效期，不能变成全局永久目录。

Inbox Project 只能访问其受管 `inbox-workspace`。Legacy Quarantine 默认禁用文件读写，直到用户明确归属。

## 15. Artifact 生命周期

### 15.1 状态机

```text
staging
   ├─ 文件原子写入 + 校验成功 ─► ready
   └─ 渲染/校验失败 ───────────► failed

ready
   ├─ 文件被移走 ───────────────► missing
   └─ 同路径重写 ───────────────► 新 artifact（supersedes 旧 artifact）
```

GUI 行为：

- `staging`：显示“正在生成”。
- `ready`：立即显示并允许预览，不等待 `turn_end`。
- `failed`：停止 loading，显示具体错误和可用中间产物。
- `missing`：显示“文件已移动或删除”，提供重新定位/刷新。
- 网络或鉴权错误不得伪装成“没有产物”。

### 15.2 正常注册流程

以 PDF 为例：

1. 创建 artifact id，SQLite 状态为 `staging`，关联当前 project/session/turn/tool。
2. PDF pipeline 写临时文件。
3. 校验文件存在、大小、页数和可读取性。
4. atomic rename 到目标路径。
5. 追加并 fsync `artifact_ready` JSONL 事件。
6. SQLite 短事务投影 artifact 为 `ready`，写入 hash、size、mime 和 artifact link。
7. 事务提交后发送 WebSocket `artifact_created`。
8. GUI 使用 artifact id 刷新或直接插入列表。

如果在步骤 5 后、步骤 6 前崩溃，启动 projector 会从 JSONL 补齐 SQLite。
如果在步骤 4 后、步骤 5 前崩溃，文件属于 orphan，reconciler 将其隔离并记录日志，不自动挂到其他会话。

### 15.3 PDF “已生成但一直加载”的修复原则

产物就绪和 Agent turn 完成必须解耦：

- PDF 文件校验完成后立刻把 artifact 置为 `ready`。
- `artifact_created` 必须在 artifact transaction 提交后发送。
- GUI 的转换 loading 只观察 artifact/job 状态，不观察 assistant 是否还在 streaming。
- pipeline 无论成功、失败或超时都必须完成 tool call 和 turn 状态收口。
- 页面刷新后，GUI 从 SQLite API 重新得到 `ready`，不能只依赖丢失的 WebSocket 增量事件。
- 如果 Markdown 成功而 PDF 失败，Markdown 作为 `intermediate` ready artifact，PDF 标记 failed。

### 15.4 产物归属判定

新数据只接受以下显式证据：

1. 工具执行上下文中的 project/session/turn/tool call。
2. `artifact_ready` 事件。
3. 用户附件导入事件。
4. 经过校验的 file edit 事件。

不得使用以下启发式作为正常归属依据：

- 当前 GUI active conversation。
- 当前最近打开项目。
- workspace 中“最近修改”的全部文件。
- 文件 mtime 大于 session created_at。
- 文件名中包含会话标题。

目录扫描仅允许：

- 一次性历史迁移。
- 用户主动点击“修复产物索引”。
- 数据库重建后的 orphan reconciliation。

扫描得到的关系必须标记 `origin = legacy_scan` 和置信度，不能自动跨项目关联。

## 16. REST API 目标设计

所有请求显式使用 gateway base URL，并使用统一鉴权 client。

### 16.1 Projects

```http
GET    /api/projects
POST   /api/projects
GET    /api/projects/{project_id}
PATCH  /api/projects/{project_id}
DELETE /api/projects/{project_id}
GET    /api/projects/{project_id}/sessions
```

创建项目：

```json
{
  "name": "nanobot-gui",
  "root_path": "/Users/wyx/project/nanobot-pc/nanobot-gui"
}
```

gateway 负责 canonicalize、去重和目录身份检查。

删除项目默认只从应用注册表归档，不删除磁盘目录。仍有会话或定时任务时返回依赖摘要，要求用户显式处理。

### 16.2 Sessions

```http
GET    /api/sessions?project_id={project_id}
POST   /api/sessions
GET    /api/sessions/{session_id}
GET    /api/sessions/{session_id}/thread
DELETE /api/sessions/{session_id}
POST   /api/sessions/{session_id}/clone
```

创建：

```json
{
  "project_id": "prj_01K...",
  "title": ""
}
```

克隆到其他项目必须是显式操作：

```json
{
  "target_project_id": "prj_01M...",
  "include_messages": true,
  "include_managed_artifacts": false
}
```

克隆后的 session 是新身份，源 session 不变。项目文件不会静默复制。

### 16.3 Artifacts

```http
GET /api/projects/{project_id}/sessions/{session_id}/artifacts
GET /api/artifacts/{artifact_id}
GET /api/artifacts/{artifact_id}/content
GET /api/artifacts/{artifact_id}/content?download=1
POST /api/artifacts/{artifact_id}/reconcile
```

列表返回：

```json
{
  "project_id": "prj_01K...",
  "session_id": "ses_01K...",
  "artifacts": [
    {
      "id": "art_01K...",
      "status": "ready",
      "name": "小红书上市分析.pdf",
      "kind": "pdf",
      "mime_type": "application/pdf",
      "size": 245120,
      "sha256": "...",
      "relation": "final",
      "turn_id": "turn_01K...",
      "tool_call_id": "tool_01K...",
      "created_at": 1785032430123,
      "ready_at": 1785032441123
    }
  ]
}
```

内容接口只接收 `artifact_id`，不让 GUI 提交可篡改 path。gateway 内部：

1. 读取 artifact。
2. 确认当前请求有权访问其 project。
3. 如果请求来自 session 页面，再验证 artifact link。
4. 重建安全路径。
5. 做 realpath/symlink/size/mime 检查。
6. 返回内容。

迁移期保留：

```http
GET /api/sessions/{encoded_session_key}/artifacts
GET /api/sessions/{encoded_session_key}/artifacts/content?path=...
```

旧接口内部应优先查 registry；只有 legacy session 可以使用受限扫描 fallback，并返回 deprecation 标记。

### 16.4 Memory 和 diagnostics

```http
GET    /api/projects/{project_id}/memories
GET    /api/projects/{project_id}/memories/status
DELETE /api/projects/{project_id}/memories
DELETE /api/projects/{project_id}/memories/{memory_id}
POST   /api/projects/{project_id}/memories/reindex
POST   /api/projects/{project_id}/memories/consolidate

# 当前 websockets HTTP 适配层只解析 GET，桌面 GUI 使用以下显式 action alias；
# 迁移到完整 HTTP server 后保留上面的标准 method，并逐步废弃 alias。
GET /api/projects/{project_id}/memories/clear
GET /api/projects/{project_id}/memories/{memory_id}/forget
GET /api/projects/{project_id}/memories/reindex
GET /api/projects/{project_id}/memories/consolidate

GET /api/diagnostics/logs
GET /api/diagnostics/sessions/{session_id}
POST /api/diagnostics/state/verify
POST /api/diagnostics/state/repair
```

repair 属于重要操作，GUI 需要明确提示并记录审计日志。

其中：

- `status` 返回 Phase 1/Phase 2 的运行状态、watermark、最近错误和最近成功时间，不返回私有模型推理。
- collection `DELETE` 清空该项目可用记忆、文件投影和检索缓存，不影响 session JSONL；必须记录审计事件。
- `reindex` 只重建本期已有的项目内基础文本分块/关键词索引，不生成 embedding。
- `consolidate` 是用户显式触发的单项目归并；相同项目已有任务运行时返回现有 job，不重复启动。
- 所有路由都从 path project id 构造 `ProjectContext`，不得接受 body 中另一个 project id 覆盖。

## 17. WebSocket 协议

### 17.1 客户端发送

新会话：

```json
{
  "action": "new_chat",
  "project_id": "prj_01K...",
  "client_conversation_id": "..."
}
```

已有会话消息：

```json
{
  "action": "send_message",
  "session_id": "ses_01K...",
  "content": "..."
}
```

已有会话不需要、也不允许由客户端重新指定执行 project。

### 17.2 服务端事件 envelope

所有新事件建议统一包含：

```json
{
  "event": "artifact_created",
  "event_id": "evt_01K...",
  "project_id": "prj_01K...",
  "session_id": "ses_01K...",
  "turn_id": "turn_01K...",
  "sequence_no": 42,
  "timestamp": 1785032441123,
  "artifact": {
    "id": "art_01K...",
    "status": "ready",
    "name": "小红书上市分析.pdf",
    "kind": "pdf"
  }
}
```

GUI 必须：

- 只把事件应用到相同 session。
- event id 去重。
- 发现 project id 与本地 session 不一致时丢弃事件、刷新 session，并记录错误。
- 收到 sequence gap 时触发 thread snapshot 补偿。
- `artifact_created` 后按 artifact id 更新，不再按 path 猜测。

## 18. 鉴权和 401 恢复

当前 artifact 列表/内容请求必须纳入统一 gateway client：

1. 所有 REST 请求都从 bootstrap session 获取 base URL 和 token。
2. 收到 401 时只自动重新 bootstrap 一次。
3. 使用新 token 重试原请求一次。
4. 第二次仍失败则返回明确 `AUTH_EXPIRED`，停止 loading。
5. preview object URL 生命周期由 GUI 管理，切换文件时 revoke。
6. 日志记录 route、status、request id、project/session/artifact id，但不记录 token。

不能让 artifact API 绕开全局 401 刷新逻辑，也不能把所有错误统一显示成“无法加载会话产物”。

建议 GUI 错误区分：

```text
AUTH_EXPIRED
SESSION_NOT_FOUND
ARTIFACT_NOT_FOUND
ARTIFACT_NOT_LINKED
PROJECT_SCOPE_VIOLATION
FILE_MISSING
FILE_OUTSIDE_PROJECT
PREVIEW_TOO_LARGE
GATEWAY_UNAVAILABLE
```

## 19. 结构化日志

### 19.1 logs.sqlite

```sql
CREATE TABLE logs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp           INTEGER NOT NULL,
  level               TEXT NOT NULL,
  component           TEXT NOT NULL,
  event_name          TEXT,
  message             TEXT NOT NULL,
  request_id          TEXT,
  project_id          TEXT,
  session_id          TEXT,
  turn_id             TEXT,
  tool_call_id        TEXT,
  artifact_id         TEXT,
  error_code          TEXT,
  duration_ms         INTEGER,
  details_json        TEXT
);

CREATE INDEX logs_session_time
ON logs(session_id, timestamp DESC);

CREATE INDEX logs_artifact_time
ON logs(artifact_id, timestamp DESC);

CREATE INDEX logs_error_time
ON logs(error_code, timestamp DESC);
```

`logs.sqlite` 不与 state DB 建 foreign key，避免日志写入依赖核心事务；但所有关联 id 都由结构化 logger 从当前 context 注入。

### 19.2 必记事件

```text
gateway_started
db_migration_started/completed/failed
project_context_created/rejected
session_created/resumed
turn_started/completed/failed/cancelled
tool_started/completed/failed
artifact_staging/ready/failed/missing
artifact_list_requested/completed/failed
artifact_content_requested/completed/failed
auth_refresh_started/completed/failed
path_guard_rejected
project_scope_violation
projector_backfill_started/completed/failed
db_integrity_failed
db_rebuild_started/completed/failed
```

### 19.3 脱敏和保留

- token、cookie、API key 永不写入。
- prompt 和文件正文默认不写 operational log。
- path 默认记录项目内相对路径；绝对根路径仅在本地 debug 级别且需脱敏用户名。
- 默认保留 30 天或 200 MiB，以先到者为准。
- debug 日志可由用户临时开启，自动过期。
- 导出诊断包前再次脱敏。

### 19.4 Electron 日志

gateway 是 `logs.sqlite` 的唯一 schema owner。Electron 主进程：

- 优先通过本地受鉴权的批量 diagnostics endpoint 转发结构化日志。
- gateway 不可用时写独立轮转 `electron.log`。
- gateway 恢复后不强制回灌旧 Electron 日志，避免重复。
- Renderer 不直接连接 SQLite。

## 20. GUI 改动

### 20.1 类型

在 `src/core/types.ts` 增加：

```ts
interface ProjectPayload {
  id: string;
  kind: "workspace" | "inbox" | "legacy_quarantine";
  name: string;
  rootPath?: string | null;
  status: "active" | "missing" | "detached" | "archived";
  createdAt: number;
  updatedAt: number;
}

interface SessionPayload {
  id: string;
  sessionKey: string;
  projectId: string;
  title: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

interface ArtifactPayload {
  id: string;
  projectId: string;
  sessionId: string;
  turnId?: string | null;
  toolCallId?: string | null;
  status: "staging" | "ready" | "failed" | "missing" | "quarantined";
  name: string;
  kind: string;
  mimeType?: string | null;
  size?: number | null;
  relation: string;
  error?: { code: string; message: string } | null;
}

interface ProjectMemoryPayload {
  id: string;
  projectId: string;
  kind:
    | "project_preference"
    | "workflow"
    | "repo_fact"
    | "failure_shield"
    | "decision_rule"
    | "reference";
  title: string;
  content: string;
  confidence?: number | null;
  sourceCount: number;
  usageCount: number;
  lastUsedAt?: number | null;
  updatedAt: number;
}

interface ProjectMemoryJobStatusPayload {
  projectId: string;
  phase1: "idle" | "queued" | "running" | "succeeded" | "failed";
  phase2: "idle" | "queued" | "running" | "succeeded" | "failed";
  inputWatermark?: number | null;
  completedWatermark?: number | null;
  lastSucceededAt?: number | null;
  error?: { code: string; message: string; retryable: boolean } | null;
}
```

### 20.2 Store

- `workspaceStore.recentPaths` 只在迁移期作为导入来源，不再是项目事实来源。
- 项目列表从 `/api/projects` 同步。
- `chatStore` 中每个 conversation 必须镜像 `sessionId` 和 `projectId`。
- active conversation 切换时清空上一个会话的临时 artifact view state。
- artifact query key 至少包含 `projectId + sessionId`。
- `taskExecutionStore` 保存 turn/tool id，便于 Progress 和产物关联。
- 项目记忆列表和 job 状态必须按 `projectId` 分区缓存；切换项目时不得复用上一项目 snapshot。
- GUI 不持久化 `raw_memory`、rollout 原文或 consolidation 中间提示词。
- GUI 不本地修改 session 的 project id。

### 20.3 Artifacts UI

- 右栏列表使用 artifact id 作为 React key。
- `staging`、`ready`、`failed`、`missing` 显示不同状态。
- preview 使用 artifact content endpoint，不拼相对路径 URL。
- 失败卡展示 gateway error code，并提供重试。
- “重试”只重试查询/预览；重新生成产物必须发起新的 Agent/tool 操作。
- 收到 ready 事件后立即结束对应文件的 loading。
- 页面恢复时始终进行一次 HTTP snapshot，WebSocket 只负责增量。

### 20.4 项目侧栏

- 项目身份使用 project id，不再用 normalized path 作为 React key。
- 同名项目允许存在，必要时显示父目录辅助区分。
- “移除项目”调用 gateway archive API，不只删除 GUI localStorage。
- 项目目录 missing 时仍显示历史会话，但禁止执行文件工具并显示重新定位入口。
- 普通“对话”分组实际对应 Inbox Project，UI 可继续显示为“对话”而不暴露内部实现。

### 20.5 项目记忆 UI

GUI 提供轻量的项目记忆管理入口，但不承担提取、归并或检索执行：

- 从当前项目菜单或项目详情进入“项目记忆”，请求必须使用稳定 project id。
- 展示记忆条目类型、标题、更新时间、confidence、来源会话数量和最近使用时间。
- 展示 Phase 1/Phase 2 的 `idle/queued/running/succeeded/failed` 状态、最近成功时间和可操作错误。
- 允许用户打开来源会话或定位到可用的 turn/artifact；来源缺失时显示明确状态。
- 支持删除单条记忆、清空项目记忆和显式触发 consolidation；删除和清空属于重要操作，需要确认。
- 后台任务运行时可以离开页面；重新进入后以 status API 恢复，不依赖 GUI 本地倒计时。
- 不显示模型私有思维链、Phase 1 原始 provider trace 或未脱敏 rollout。
- 不展示“向量库”“语义召回”“深度 RAG 已启用”等本期未实现文案。
- 所有 loading 必须由 job 终态、HTTP 错误或超时收口，不能无限旋转。
- 新增文案全部进入 i18n，至少覆盖任务状态、来源、删除确认、重试和 fail-closed 错误。

## 21. nanobot 后端改动

建议新增或重构为以下模块，具体文件名可按现有包结构调整：

```text
nanobot/storage/
  database.py
  migrations/
  repositories/
    projects.py
    sessions.py
    turns.py
    artifacts.py
    memories.py
    schedules.py
  projector.py
  recovery.py

nanobot/events/
  journal.py
  schemas.py

nanobot/projects/
  context.py
  service.py
  path_guard.py

nanobot/artifacts/
  registry.py
  service.py
  reconciler.py

nanobot/memories/
  extraction.py
  consolidation.py
  retrieval.py
  provenance.py
  jobs.py

nanobot/diagnostics/
  structured_logger.py
  api.py
```

实现要求：

- repository 的项目级方法必须要求 ProjectContext 或 project id 参数。
- 禁止提供无范围的 `list_all_memories()`、`search_all_files()` 等给 Agent 使用。
- 记忆提取、归并和在线读取属于 nanobot runtime；GUI 只展示状态、来源并提供显式管理操作。
- 不新增 embedding provider、vector store 或 reranker 依赖。
- 数据库 row 到 domain object 的转换集中处理。
- migration 与 backfill 可重复执行。
- JSONL append 和 projector 都有明确幂等键。
- WebSocket 发送发生在 SQLite 投影提交之后。

## 22. 写入一致性和崩溃恢复

SQLite、JSONL 和文件系统无法参与一个真正的跨介质事务。采用“文件原子写 + JSONL 先行 + SQLite 幂等投影”：

### 22.1 普通事件

1. 构造带 event id 和 sequence 的事件。
2. append JSONL。
3. 对关键事件 flush/fsync。
4. SQLite transaction 幂等投影。
5. transaction commit。
6. 发送 WebSocket。

### 22.2 文件产物

1. SQLite 可先创建 `staging` 占位，方便 UI 显示。
2. 在目标目录写临时文件。
3. 校验并 atomic rename。
4. append `artifact_ready` 或 `artifact_failed`。
5. SQLite 投影终态和 link。
6. 发送 WebSocket。

`staging` 占位不是最终事实；超时 reconciler 必须将长期 staging 收口为 failed 或从 JSONL 恢复。

### 22.3 启动恢复

gateway 启动：

1. 获取单实例锁。
2. 打开 SQLite 并执行 migration。
3. 运行 `quick_check`。
4. 查找未完成 projector offset。
5. 按 lease 增量回放 JSONL。
6. 收口超时的 running turn/tool/artifact。
7. 检查 orphan 临时文件。
8. 完成后才开放项目 Agent 执行。

历史列表可以在 backfill 期间渐进显示，但未完成归属校验的 session 不得执行文件工具。

## 23. 数据库损坏处理

检测到 `SQLITE_CORRUPT`、`quick_check` 失败或不可恢复 migration 错误时：

1. 停止所有新 Agent 执行。
2. 关闭连接池。
3. 将 `state.sqlite`、`-wal`、`-shm` 一起移动到时间戳 backup 目录。
4. 创建空的新 schema。
5. 从所有 session JSONL 重建 projects、sessions、turns、messages、tool calls 和 artifacts。
6. 运行 artifact 文件 reconcile。
7. 再次执行 integrity check。
8. 在 GUI 显示修复结果和无法恢复项目。

不得静默删除损坏数据库。
不得在 state DB 不可信时退回“扫描所有 workspace 并展示全部文件”。

`logs.sqlite` 损坏不应阻断核心聊天；单独备份并创建新日志库。

## 24. 历史数据迁移

### 24.1 项目迁移

输入来源：

- `workspaceStore.recentPaths`
- session metadata 中的 `workspaceScope.project_path`
- session metadata 中的 `workspacePath`
- gateway 默认 workspace 配置

流程：

1. canonicalize 路径。
2. 以 canonical path + filesystem identity 去重。
3. 为每个真实项目创建稳定 project id。
4. 默认 workspace 映射为 Inbox Project。
5. 无路径或路径冲突且无法判断的 session 映射到 Legacy Quarantine。
6. 在 session JSONL 中追加 `session_project_assigned` 迁移事件。
7. 写入 SQLite。

迁移不得把“当前 GUI 选中的项目”用作历史会话的默认归属。

### 24.2 会话迁移

- 原 session key 保留为兼容映射。
- 根据 JSONL 和旧 metadata 恢复 created/updated/title。
- 每个导入 session 记录 migration source 和版本。
- 导入以 session id + source checksum 幂等。
- 使用 watermark 分批处理，避免启动长时间阻塞。

### 24.3 产物迁移

证据优先级：

1. tool result 中明确的 `files` / `artifacts`。
2. transcript 中的 `file_edit`。
3. `message.media`。
4. 旧 artifact event。
5. 最后才是同项目目录的受限历史扫描。

历史扫描规则：

- 只能扫描该 session 已确认所属项目。
- 同一文件若可能属于多个重叠 session，不自动选择唯一 owner；可建立 `referenced` 关系并标记低置信度，或进入待确认。
- 不因 mtime 自动把 B 会话文件挂给 A 会话。
- 超出 root、symlink escape、无法读取的文件进入 quarantine。
- 每条迁移 link 保存 source、confidence 和 migration version。

### 24.4 迁移阶段

#### Phase A：Shadow write

- 创建 schema 和 JSONL 新事件字段。
- 旧读取逻辑不变。
- 新状态同时投影 SQLite。
- 后台比较旧列表和新列表，记录差异。

#### Phase B：SQLite read primary

- 项目、会话、产物列表优先 SQLite。
- 仅 legacy session 可使用同项目扫描 fallback。
- GUI 开始使用 project/session/artifact id。

#### Phase C：强隔离

- 新会话完全禁止扫描 fallback。
- repository API 强制 ProjectContext。
- 项目记忆、基础文本 RAG、cron、subagent 全面纳入 project id。
- 旧 path-based artifact API 标记 deprecated。

#### Phase D：清理兼容

- 移除 GUI recentPaths 的权威用途。
- 移除正常路径上的 mtime artifact scan。
- 移除 GET delete 等旧接口。
- 保留离线 migration/repair 工具。

## 25. 删除、归档和导出

### 25.1 删除会话

默认使用软删除/归档：

- session 标记 archived。
- JSONL 移入 archive 或保留原位。
- project 文件不自动删除。
- managed artifact 只有在无其他 link 且过了回收期后才删除。
- 删除关系和文件动作记录审计日志。

### 25.2 移除项目

- 默认只归档项目注册，不删除用户磁盘目录。
- 有 active schedule 时必须先暂停。
- 历史 session 可继续只读查看。
- 重新添加同一目录时，优先通过 filesystem identity 提示恢复原项目，而不是自动创建第二身份。

### 25.3 导出

项目导出包建议包含：

```text
manifest.json
sessions/*.jsonl
state-export.json
managed-artifacts/*
```

用户项目目录中的普通文件默认不重复打包，除非用户明确选择。

## 26. 故障与用户提示

| 场景 | 后端行为 | GUI 行为 |
| --- | --- | --- |
| token 过期 | refresh 一次并重试 | 保持短 loading；失败显示重新连接 |
| artifact ready 但 turn 仍运行 | artifact 可读取 | 立即允许预览，Progress 继续 |
| PDF 渲染失败 | artifact failed，中间 MD ready，turn 收口 | 展示失败原因和 Markdown |
| 文件被用户删除 | artifact missing | 显示缺失，不无限重试 |
| 项目目录移动 | project missing | 历史只读，提示重新定位 |
| 客户端 project 与 session 不一致 | 409 并记 scope violation | 刷新会话，不发送消息 |
| state DB busy | 短重试，超过阈值明确失败 | 显示稍后重试 |
| state DB 损坏 | fail closed，备份并重建 | 显示修复进度 |
| JSONL 某行损坏 | 停在最后有效 offset，隔离损坏尾部 | 提示部分恢复 |
| WebSocket 丢事件 | sequence gap | HTTP snapshot 补偿 |

## 27. 测试方案

### 27.1 Schema 和 migration

- 空库创建全部表和索引。
- 从每个历史 schema 版本逐级升级。
- 重复 migration 不破坏数据。
- composite foreign key 阻止跨项目 session/artifact link。
- session project id 普通 update 被 service 拒绝。
- Inbox 和 Legacy Quarantine 初始化幂等。

### 27.2 项目隔离

- A 项目会话不能列出 B 项目 artifact。
- 伪造 B artifact id 读取返回 404/403，不泄露元数据。
- memory/RAG 查询不会返回其他 project 的内容。
- cache 在相同 query、不同 project 下不复用结果。
- 子 Agent 继承 project id。
- cron 继承 project id。
- MCP 文件参数经过同一 path guard。
- GUI 切换 active project 不改变正在运行 session 的 project。

### 27.3 路径安全

- 拒绝 `../`。
- 拒绝绝对路径。
- 拒绝 URL/file protocol。
- 拒绝 symlink escape。
- 目录在检查后被替换时仍安全。
- 大文件和不支持 MIME 返回明确错误。

### 27.4 Artifact

- tool 生成文件后 registry 和 link 同事务投影。
- 相同路径二次写入产生版本链。
- PDF ready 后无需等待 turn end 即可预览。
- PDF failed 时 loading 终止且中间产物可见。
- WebSocket 事件丢失后刷新仍能从 API 找到产物。
- 文件删除后变为 missing。
- 401 refresh 后 artifact list/content 自动成功一次。
- 同一 artifact 的重复 event 不产生重复 link。

### 27.5 JSONL 和恢复

- 在 append 后、SQLite commit 前模拟崩溃，重启后补齐。
- 在文件 rename 后、event append 前模拟崩溃，orphan 被隔离。
- projector 重复回放幂等。
- sequence gap 被检测。
- SQLite 损坏后从 JSONL 重建。
- 重建后 project/session/artifact 关系与原库一致。

### 27.6 GUI

- 项目侧栏以 project id 分组。
- 同名项目不会合并。
- 普通对话显示在“对话”组但绑定 Inbox。
- artifact loading 状态按 artifact status 收口。
- 不同 session 的 artifact query cache 不串数据。
- 错误码呈现正确，不统一吞成“无法加载”。
- narration 只显示在 Steps，不进入最终正文。
- 项目记忆页面只请求当前 project id，切换项目后清空上一项目的临时列表和 job 状态。
- Phase 1/Phase 2 状态可在重启 GUI 后从 API 恢复，失败和超时会终止 loading。
- 记忆来源可以导航到对应会话；跨项目或缺失来源不会被错误打开。
- 删除、清空和显式 consolidation 的确认、成功、失败状态均有 i18n 覆盖。

### 27.7 性能

- 10,000 sessions 下按项目分页列表满足目标延迟。
- 单 session 10,000 events 增量 replay 不全量阻塞启动。
- 日志高频写入不显著增加 state transaction 延迟。
- artifact list 不遍历 workspace，延迟与目录文件总数无关。

### 27.8 项目记忆

- Phase 1 只领取同一 project 的已完成 root session，不处理 ephemeral/subagent session。
- 同一 rollout revision 重复启动只产生一份 Stage 1 output。
- 无高信号内容时产生 `succeeded_no_output`，不生成填充式记忆。
- Phase 1 输出中的 secret 被脱敏，超长工具结果不会进入 memory 正文。
- Phase 2 同一项目只有一个有效 lease；崩溃后可以安全接管。
- A 项目的 Phase 2 无法读取或写入 B 项目 memory root 和 SQLite rows。
- `memory_summary.md` 有硬 token 上限；在线读取最多打开配置数量的详细来源。
- 使用某条记忆后异步更新 usage，不阻塞当前模型请求。
- 删除/失效来源后，下一次归并会清理或降级陈旧记忆。
- 记忆引用可以追溯到 source session、turn/event 或 rollout locator。
- SQLite 不可用、project id 不一致或 memory root 越界时 fail closed。
- `reindex` 不调用 embedding API，`embedding_ref` 在本期保持空值。

## 28. 验收标准

上线强隔离阶段前必须全部满足：

1. 新项目有稳定 project id，重启后不变。
2. 新 session 有非空 project id，且首条 JSONL 事件包含同一 id。
3. session 不能被静默改绑项目。
4. A 项目会话不能通过会话、记忆、检索、产物或工具访问 B 项目数据。
5. artifact 能追溯到 project、session、turn 和可选 tool call。
6. 新 artifact 列表不依赖 workspace 扫描或 mtime。
7. PDF ready 后 1 秒内可在本地 GUI 进入可预览状态，不依赖 turn end。
8. PDF 失败后 loading 必须停止，并显示中间产物或明确错误。
9. artifact list/content 遇到 token 过期能自动 bootstrap 并重试一次。
10. 刷新页面或重启应用后产物关系仍正确。
11. SQLite 损坏可从 JSONL 重建核心状态。
12. DB 不可用时不会退回跨项目全局扫描。
13. logs.sqlite 可按 session 或 artifact 查询完整失败链路。
14. GUI 不直接读写 SQLite，也不恢复本地 Agent 执行权威。
15. 相关 Python 测试、Vitest、`npm run build` 通过。
16. 每个项目具备独立的 Phase 1 提取、Phase 2 归并、渐进式读取和来源引用闭环。
17. 项目记忆任务具备 lease、watermark、退避重试、幂等和失败保留上次成功版本。
18. 本期没有 embedding/vector/reranker 运行依赖，产品文案不宣称支持深度 Project RAG。

## 29. 实施顺序

建议按以下顺序开发，降低一次性改动风险：

1. 建立 state DB、migrations、projects/sessions schema。
2. 引入 ProjectContext，先覆盖 session、filesystem 和 artifact API。
3. 引入统一 JSONL envelope 和 projector offset。
4. 建立 artifact registry、artifact link 和 id-based content API。
5. 修复 GUI 统一鉴权重试、artifact 状态机和错误码。
6. 把项目侧栏数据源从 recentPaths 切换到 gateway。
7. 把已有基础 text RAG/cache 纳入 project scope，但不扩展向量深度能力。
8. 实现单项目 Phase 1 记忆提取、任务 lease/重试和来源记录。
9. 实现单项目 Phase 2 归并、memory 文件投影、watermark 和遗忘处理。
10. 实现摘要注入、关键词搜索、按需打开详细来源、引用返回和 usage 回写。
11. 把 subagent、cron、MCP 路径纳入 project scope。
12. 建立 logs.sqlite 和 diagnostics 页面/导出。
13. 执行历史 backfill、shadow compare 和兼容清理。

每一步都应保持：

- GUI 仅为状态镜像。
- gateway 是运行时 source of truth。
- 不重新引入 GUI 本地执行引擎。
- 旧数据不确定时隔离，不猜测归属。

## 30. 最终架构决策

本项目不选择“全部只放 SQLite”，也不继续“只靠 JSONL 和目录扫描”。

最终方案为：

```text
项目身份与关系：SQLite
会话原始事件与恢复：JSONL
真实产物内容：文件系统
运行诊断：独立 logs.sqlite
安全边界：ProjectContext + 数据库约束 + PathGuard + 沙箱
```

SQLite 能解决会话、项目、产物和记忆之间缺少显式关系的问题，也能显著减少串项目；但只有当所有 Agent 数据通路都强制使用 project id，并继续执行文件系统边界检查时，项目隔离才真正成立。

## 31. 当前实施状态（2026-07-26）

Phase A、B、C 的运行时闭环已落地：

- gateway 启动时创建 `.nanobot/state.sqlite` 与独立 `.nanobot/logs.sqlite`。
- project、session、artifact 使用稳定 ID；session 的 project 绑定受 service 和 SQLite trigger 双重保护。
- 新 WebUI 会话在首次保存前写入 `project_id`、`session_id` 和 workspace scope。
- 项目列表、项目会话列表、session artifact 列表和 artifact id 内容接口以 SQLite 为主要数据源。
- 新会话不执行目录扫描；旧会话仅在首次迁移时进行一次项目内受限扫描。
- artifact 内容请求必须同时通过 artifact-session 显式关系和真实路径边界校验。
- artifact 文件缺失/恢复时，registry 状态在 `missing`/`ready` 间自动 reconcile。
- GUI 项目侧栏使用 gateway project registry；conversation 镜像 project/session ID。
- GUI artifact 列表和内容统一执行一次 401 token refresh；artifact snapshot 会校验 project/session 身份。
- 结构化日志可通过 `/api/diagnostics/logs` 按 project、session、artifact 或 error code 查询。
- 旧全局 MemoryStore 不再注入其他 project，也不再接收其他 project 的自动归档与 consolidation，先以 fail-closed 防止记忆串项目。
- WebUI transcript 已升级为 append-only event envelope；JSONL 先落盘、SQLite 后投影，包含稳定 event id、sequence、project/session/turn 身份。
- projector 已覆盖 turn、message、tool call、progress/step，并通过 `projected_events` 和 `projector_state` 幂等 replay；sequence gap 会 fail closed。
- gateway 重启会收口未终止的 turn/tool/progress/step，并把 stale staging artifact 转成明确 failed。
- artifact 已使用 `staging -> ready/failed` 状态机；同一生成重试会重新打开 staging，失败原因通过 API 返回，GUI 不再无限 loading。
- project 长期记忆使用 project-owned managed directory，并同步 `project_memories`；project id 与 workspace root 不一致时拒绝读取。
- `project_documents/project_chunks` 提供 project-scoped 文本产物索引与检索，`project_cache` 把 project id 纳入 cache 唯一键。
- 当前 Project RAG 仅为基础文本分块和 SQL 关键词匹配；`embedding_ref` 是未启用的兼容字段，深度向量 RAG 明确不在本期范围。
- 子 Agent 强制继承 workspace/project，创建同项目 child session 并在 `agent_edges` 持久化父子关系。
- cron payload 持久化 `project_id/created_session_id`，cron child session 在运行前重新绑定自己的 ProjectContext；GUI schedule 同步到 SQLite `schedules`。
- restricted 模式下 MCP 文件参数复用当前 workspace 边界，拒绝 `../`、project 外绝对路径和 `file:` URL。
- SQLite quick check 失败时自动把 DB/WAL/SHM 移到 `.nanobot/recovery/`，重建后从 session JSONL 与 transcript journal 恢复核心投影。
- transcript 遇到损坏 JSONL 尾部时保留 `.corrupt-*` 备份、原子保留最后有效前缀，后续事件可继续 append。
- session 删除改为 SQLite 软归档，JSONL 和 transcript 保留；GUI 撤销会调用 restore。
- project archive/restore/relocate/export API 已实现；relocate 保留稳定 project id，export 包含 manifest、state export、session JSONL 和 project memory，普通项目文件仅在显式请求时加入。
- GUI 项目菜单已接入项目归档、路径迁移和 ZIP 导出；产物面板在 turn 结束后仍会轮询 staging，直到 ready/failed/missing 终态。

Phase D 仅保留兼容性清理项，不影响强隔离主路径：

- 旧 path-based artifact content API 仍供滚动升级客户端使用；新 GUI 已优先使用 artifact id URL。
- `recentPaths` 仍作为旧本地状态迁移和未注册草稿的展示 fallback，不再是 gateway 项目关系的 source of truth。
- 大规模历史库的离线批量迁移/性能基准属于发布运维任务；在线恢复按 session 的 `artifact_indexed_at` 与 projector offset 增量执行。

Codex 式项目记忆能力已落地：

- Phase 1 在 root project session 空闲后按 rollout revision 幂等提取，排除 ephemeral、subagent、dream、cron 和 heartbeat；支持 secret redaction、长度上限、`succeeded_no_output`、失败重试和 lease 接管。
- Phase 2 只读取单一 `project_id` 的 Stage 1，按使用度/最近使用/新鲜度有界选择；输出 `raw_memories.md`、`rollout_summaries/`、memory-derived project skills、`MEMORY.md`、`memory_summary.md`、结构化 memories、来源边和 completed watermark，失败恢复上次文件投影。
- 在线读取先使用 `memory_summary.md`，再进行单项目结构化关键词检索；命中后只补充少量来源 rollout summary 或相关 memory-derived project skill，并异步回写 memory/stage1 usage。
- Gateway 已提供列表、状态、单条忘记、整项目清空、显式 consolidate 和基础文本 reindex；清空不会删除 session JSONL、产物或项目文件，重要操作写结构化审计日志。
- GUI 项目菜单已提供项目记忆管理弹窗，展示 Phase 2 状态、类型、正文、使用次数、最近使用和来源会话，并支持刷新、立即整理、基础索引重建、单条忘记和整项目清空。
- 当前运行时不包含 embedding、vector store、混合召回、语义 reranker、OCR 或复杂文档深度摄取；UI 明确标识“有界关键词检索 · 深度 RAG 未启用”。

保留的发布运维清理项：

- 当前 WebSocket 共端口 HTTP 解析器只接受 GET，写操作暂时使用带鉴权的显式 action alias；更换完整 HTTP server 后迁回标准 POST/DELETE。
- 大规模历史会话首次离线批量生成 Stage 1、性能基准和灰度开关属于发布任务，不阻塞新会话闭环。
