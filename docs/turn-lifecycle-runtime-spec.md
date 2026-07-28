# Codex 风格会话 Turn 生命周期与任务计划运行时 Spec

> 状态：待实施
> 适用范围：`nanobot` gateway、Electron GUI、WebSocket/REST 协议、会话 SQLite 投影
> 设计参照：`/Users/wyx/ai/ruyi` 中 Codex 的 Thread / Turn / Item、ActiveTurn、ThreadWatchManager、终态事件和 rollout/state DB 分层
> 最后更新：2026-07-26

## 1. 文档定位

本 Spec 专门解决以下问题：

- Agent 已经输出最终回答，但会话仍显示“运行中”。
- gateway 重启、WebSocket 断线或终态事件丢失后，会话永久处于 running。
- 同一个运行状态同时由 Python task、进程内 Map、SQLite、WebSocket 和 GUI 推导。
- 任务计划有时不出现，或者 Turn 已结束但计划步骤仍显示 running。
- 主 Agent 已输出最终回答，迟到的子 Agent、记忆任务或产物索引继续污染原 Turn。

本 Spec 是以下文档在“实时运行态、Turn 终态、计划终态、重连恢复”方面的权威补充：

- `docs/conversation-workbench-spec.md`
- `docs/project-isolation-storage-spec.md`
- `docs/gui-backend-interface-spec.md`

若旧文档与本 Spec 冲突，以本 Spec 为准。项目隔离、Artifact 路径安全、ProjectContext、
JSONL 事件日志和 SQLite 外键关系继续沿用原有设计。

## 2. 核心结论

系统必须从“多个模块分别猜测是否运行”改为“唯一 ActiveTurn 决定是否运行”。

```text
Thread / Session
  └─ ActiveTurn?             ← 唯一实时运行事实
       ├─ RunningTask
       ├─ Turn Items
       ├─ Plan
       ├─ Pending approval
       ├─ Pending user input
       └─ Same-turn child work
```

必须遵循以下原则：

1. `running` 是易腐的进程内事实，不是可以跨进程信任的持久状态。
2. SQLite 可以保存 Turn 历史状态，但不得单独决定当前会话是否仍在运行。
3. Plan 是 Turn 的展示子资源，不得决定 Turn 或 Thread 的运行状态。
4. 文本流结束、最终回答出现、Turn 终态、Thread idle 是四个不同事件。
5. GUI 只投影 gateway 的权威快照，不根据 `isStreaming`、计划步骤或本地计时器推导 running。
6. 所有成功、失败、取消、替换、shutdown 和系统错误必须经过同一个终态收口函数。
7. WebSocket 是增量通知通道，不是唯一事实来源；重连后必须读取完整快照。

## 3. 目标

1. 同一 session 同一时刻最多存在一个 ActiveTurn。
2. 每个已开始 Turn 最终恰好有一个终态。
3. 任何异常路径都不能留下永久 running。
4. gateway 重启后，旧进程的 running 不会被当作仍在执行。
5. GUI 切换会话、刷新或重连后能恢复正确的 Thread、Turn、Plan 和等待状态。
6. Plan 是否存在、是否及时更新，不影响会话终态。
7. 子 Agent 和后台任务具有明确的 Turn 归属与 join 策略。
8. JSONL、SQLite 和 WebSocket 使用稳定 event id、turn id、revision 和 sequence，支持幂等恢复。
9. 保持项目强隔离；所有 snapshot、Turn、Plan、Item 查询都必须校验 project/session 关系。

## 4. 非目标

1. 不照搬 Codex 的 Rust 类型或 Tokio 实现。
2. 不在 GUI 中重新实现 Agent loop、任务调度器或本地 tool registry。
3. 不把 token 级 delta 全量写入 SQLite。
4. 不把私有 reasoning 写入普通消息或计划。
5. 不要求简单问答必须生成 Plan。
6. 不通过超时动画掩盖真实的后台运行状态。
7. 不依赖 SQLite 解决文件系统越界；路径安全仍由 ProjectContext、PathGuard 和沙箱保证。

## 5. Codex 设计映射

| Codex 概念 | nanobot 对应实现 | 说明 |
| --- | --- | --- |
| Thread | Session | 会话容器和历史归属 |
| ActiveTurn | `ActiveTurn` runtime object | 唯一实时运行事实 |
| RunningTask | `asyncio.Task + cancellation token` | 由 ActiveTurn 持有 |
| ThreadWatchManager | `ThreadRuntimeRegistry` | 统一发布 Thread 状态快照 |
| TurnStarted | `turn_started` | 明确开始事件 |
| TurnComplete | `turn_completed` | 统一的公开终态通知，资源内区分 completed/failed |
| TurnAborted | `turn_interrupted` journal | 内部记录中断原因，公开协议仍投影为 terminal Turn resource |
| Turn Item | message/tool/file/approval/plan item | 与 Turn 明确关联 |
| update_plan | `update_task_progress` | 只更新 Plan，不控制 running |
| rollout JSONL | WebUI transcript event journal | 可重放的事实日志 |
| state SQLite | `state.sqlite` | 查询优化和当前投影 |

借鉴的是状态所有权、资源模型和终态语义，不要求复制 Codex 的代码结构。

### 5.1 Codex 参考实现索引

实施时优先对照以下文件，而不是只模仿 UI：

| 参考文件 | 借鉴内容 |
| --- | --- |
| `/Users/wyx/ai/ruyi/codex-rs/app-server/src/thread_status.rs` | RuntimeFacts、Thread 状态集中计算、snapshot/watch、完成/中断/system error 统一清 active |
| `/Users/wyx/ai/ruyi/codex-rs/core/src/tasks/mod.rs` | RunningTask 所有权、CancellationToken、统一 `on_task_finished()`、终态事件和 flush barrier |
| `/Users/wyx/ai/ruyi/codex-rs/core/src/tasks/lifecycle.rs` | turn start/stop/abort/error 与 thread idle 的独立 lifecycle hook |
| `/Users/wyx/ai/ruyi/codex-rs/app-server/src/thread_state.rs` | Active Turn snapshot、terminal Turn 记录和事件串行化 |
| `/Users/wyx/ai/ruyi/codex-rs/app-server/src/bespoke_event_handling.rs` | TurnStarted/TurnComplete/TurnAborted 到协议资源和 ThreadStatus 的统一映射 |
| `/Users/wyx/ai/ruyi/codex-rs/core/src/tools/handlers/plan.rs` | Plan 只是 Turn Item，不参与 Thread running 判定 |
| `/Users/wyx/ai/ruyi/codex-rs/state/migrations/0001_threads.sql` | SQLite thread metadata 不持久化 live running |

不得只复制其中某一个类。Codex 的稳定性来自这些层共同遵守同一生命周期边界。

## 6. 术语

- **Thread**：面向协议的会话运行容器；当前产品中与 Session 一一对应。
- **Turn**：从一条用户输入开始，到明确终态结束的一次 Agent 执行。
- **ActiveTurn**：当前 Python 进程中真实存在并拥有 RunningTask 的 Turn。
- **Turn Item**：本轮产生的用户消息、最终回答、narration、工具调用、文件编辑、审批和 Plan 更新。
- **Plan**：当前 Turn 的用户目标级计划快照。
- **Stream Segment**：一次 answer、narration 或 reasoning 流；只控制文本渲染。
- **Terminal Event**：JSONL 中的 `turn_completed`、`turn_failed` 或 `turn_interrupted`；公开
  WebSocket 统一发送 `turn_completed`，由 Turn Resource 的 status 表达具体终态。
- **Thread Status**：`notLoaded`、`idle`、`active`、`systemError`。
- **Active Flag**：Thread active 时附带的等待原因，例如审批或用户输入。
- **Runtime Snapshot**：gateway 根据当前 ActiveTurn 和已持久化投影生成的完整状态。
- **Projection**：从 JSONL 事件幂等计算得到的 SQLite 查询状态。

## 7. 状态所有权

### 7.1 唯一事实来源

实时运行状态只能来自 gateway 的 `ThreadRuntimeRegistry`：

```python
@dataclass
class RuntimeFacts:
    is_loaded: bool = False
    active_turn: ActiveTurn | None = None
    pending_approval_count: int = 0
    pending_user_input_count: int = 0
    has_system_error: bool = False
```

Thread 状态按以下规则计算：

```text
is_loaded = false
    => notLoaded

active_turn 存在，或存在 pending approval/user input
    => active(activeFlags)

has_system_error = true
    => systemError

否则
    => idle
```

禁止存在另一个可独立写入的 `session.running`、`goal_status running Map` 或 GUI running 真相源。

### 7.2 SQLite 的角色

SQLite 保存：

- Session/Turn 的稳定身份和项目关系。
- Turn 的历史终态。
- Turn Items、工具、Plan、Artifact 的可查询投影。
- projector offset、event id 和恢复水位。

SQLite 不保存或不直接暴露：

- 可跨 gateway 进程继续生效的实时 running。
- GUI 自己推导的 isStreaming。
- 仅凭 `sessions.active_turn_id` 就能认定的活跃执行。

`active_turn_id` 可以作为同进程查询优化或恢复线索保留，但必须满足：

1. 带 `runtime_epoch` 或 `lease_owner`。
2. 只在当前 gateway epoch 内有效。
3. gateway 重启后先收口为 interrupted，再清除。
4. API 返回 live running 前必须同时确认 `ThreadRuntimeRegistry` 中存在同一个 ActiveTurn。

### 7.3 GUI 的角色

GUI 可以拥有：

- 当前连接状态。
- 文本流临时 buffer。
- 当前 Runtime Snapshot 的本地镜像。
- 乐观用户消息。
- 展开/折叠、滚动位置和预览状态。

GUI 不得：

- 根据 `stream.isStreaming` 设置 conversation running。
- 根据 Plan 中存在 running step 设置 conversation running。
- 根据最后一条消息类型推断 Turn 未完成。
- 在断线后长期保留旧 running。
- 将本地持久化 conversation status 当作 gateway 状态。

## 8. 领域模型

### 8.1 ThreadStatus

协议状态：

```ts
type ThreadStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError"; errorCode?: string }
  | {
      type: "active";
      activeFlags: Array<"waitingOnApproval" | "waitingOnUserInput">;
    };
```

工具执行、模型请求、子 Agent join 等普通运行不需要额外 active flag；空 flags 的 active 即表示正常执行。

### 8.2 TurnStatus

新协议采用：

```ts
type TurnStatus =
  | "queued"
  | "inProgress"
  | "completed"
  | "failed"
  | "interrupted";
```

兼容映射：

```text
旧 running   -> inProgress
旧 cancelled -> interrupted
旧 error     -> failed
```

终态集合：

```text
completed | failed | interrupted
```

终态不可逆。重复提交同一终态必须幂等；提交不同终态必须记录 invariant violation 并拒绝覆盖。

### 8.3 ActiveTurn

建议的 Python runtime 结构：

```python
@dataclass
class ActiveTurn:
    id: str
    project_id: str
    session_id: str
    session_key: str
    runtime_epoch: str
    started_at: float
    task: asyncio.Task | None
    cancellation: CancellationToken
    state: TurnRuntimeState
    same_turn_children: dict[str, ChildWork]
    terminal_committed: bool = False
```

`ActiveTurn` 必须由 `ThreadRuntimeRegistry` 持有，不能只散落在：

- `AgentLoop._active_tasks`
- `_pending_queues`
- WebSocket channel Map
- subagent manager
- GUI run cache

这些模块可以持有引用或查询接口，但不能成为运行状态权威。

### 8.4 Turn Resource

REST/WS 返回：

```ts
interface TurnResource {
  id: string;
  projectId: string;
  sessionId: string;
  status: TurnStatus;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  finishReason:
    | "success"
    | "modelError"
    | "toolError"
    | "userInterrupted"
    | "replaced"
    | "gatewayRestarted"
    | "shutdown"
    | "internalError"
    | null;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  plan?: TurnPlanResource;
}
```

### 8.5 Turn Plan

```ts
type TurnPlanStepStatus =
  | "pending"
  | "inProgress"
  | "completed"
  | "failed"
  | "skipped"
  | "interrupted";

interface TurnPlanResource {
  turnId: string;
  revision: number;
  status: "pending" | "inProgress" | "completed" | "failed" | "interrupted";
  currentStepId: string | null;
  note?: string;
  terminalizationReason?: string;
  steps: Array<{
    id: string;
    ordinal: number;
    title: string;
    detail?: string;
    status: TurnPlanStepStatus;
  }>;
  updatedAt: number;
}
```

Plan 永远带 `turnId` 和单调递增 `revision`。客户端忽略小于等于当前 revision 的重复或乱序更新。

## 9. Turn 状态机

```text
                ┌─────────────┐
                │   queued    │
                └──────┬──────┘
                       │ start_turn
                       ▼
                ┌─────────────┐
                │ inProgress  │
                └───┬────┬────┘
                    │    │
         success ───┘    └── error
             ▼               ▼
      ┌───────────┐     ┌──────────┐
      │ completed │     │  failed  │
      └───────────┘     └──────────┘

         interrupt / replace / shutdown / restart
                       │
                       ▼
                ┌─────────────┐
                │ interrupted │
                └─────────────┘
```

不允许：

- `completed -> inProgress`
- `failed -> completed`
- `interrupted -> completed`
- 同一个 session 同时存在两个 inProgress Turn

## 10. 最终回答、Turn 终态与 Thread idle

三者必须分开：

```text
final answer committed
    表示用户可见正文已经确定

turn terminal committed
    表示本轮所有 same-turn 必要工作已经收口

thread idle
    表示没有 ActiveTurn，也没有需要立即触发下一 Turn 的队列
```

规则：

1. `stream_end(answer)` 只关闭 answer stream。
2. 最终 answer 出现不自动清除 ActiveTurn。
3. 明确的 terminal event 才清除该 Turn 的运行状态。
4. 清除 ActiveTurn 后，如果存在 trigger-next-turn mailbox，Thread 仍可立即进入下一个 ActiveTurn。
5. title、project memory、artifact reconcile、日志写入等 detached background work 不阻止 Thread idle。

## 11. 统一终态收口

### 11.1 单一入口

所有终态必须调用：

```python
await lifecycle.finish_turn(
    turn_id=turn_id,
    terminal_status=TerminalStatus.COMPLETED,
    finish_reason=FinishReason.SUCCESS,
    error=None,
)
```

禁止业务代码自行组合以下操作：

- 手动发送 `turn_end`
- 手动清除 wall clock Map
- 手动更新 SQLite turn
- 手动设置 GUI idle
- 手动清除 `active_turn_id`

### 11.2 异常安全 TurnScope

建议实现：

```python
async with lifecycle.turn_scope(request) as turn:
    result = await agent_runner.run(...)
    await turn.complete(result)
```

`TurnScope.__aexit__` 必须映射：

| 退出原因 | Turn 终态 |
| --- | --- |
| 正常且显式 complete | completed |
| `asyncio.CancelledError` + 用户停止 | interrupted / userInterrupted |
| 被新 Turn 替换 | interrupted / replaced |
| gateway shutdown | interrupted / shutdown |
| provider/model 异常 | failed / modelError |
| tool pipeline 致命异常 | failed / toolError |
| 未分类异常 | failed / internalError |
| 进程重启恢复旧 inProgress | interrupted / gatewayRestarted |

即使 `complete()` 未被调用，退出 scope 也必须生成一个终态。

### 11.3 终态提交顺序

参照 Codex 在 terminal event 前后设置持久化 barrier：

1. 停止接受当前 Turn 的新 same-turn Item。
2. 等待或取消必须 join 的 same-turn child work。
3. flush 当前 Turn 已产生的消息、工具和文件事件。
4. 终态化 Plan 和未结束 Tool Item。
5. append 唯一 terminal event 到 JSONL。
6. 对 terminal event 执行 flush/fsync。
7. 在一个 SQLite transaction 中幂等投影 Turn、Plan、Tool 和 session 索引。
8. transaction commit。
9. 更新 `ThreadRuntimeRegistry`，移除 ActiveTurn。
10. 发布统一的 `turn_completed` Turn Resource 和 `thread_status_changed`。
11. 检查是否触发下一 Turn。

WebSocket 事件必须来自已经提交的 terminal event，不允许先通知客户端、后写持久化。

### 11.4 幂等键

terminal event 使用稳定键：

```text
event_id = "turn-terminal:{turn_id}"
```

SQLite projector 使用 `projected_events(event_id)` 防止重复处理。WebSocket 可以重复投递；
GUI 根据 `turnId + status + snapshotRevision` 幂等合并。

### 11.5 终态持久化失败

RunningTask 已经退出后，即使 JSONL 或 SQLite 写入失败，也不得继续把 Thread 显示为正常运行：

1. 从 registry 移除已经停止的 RunningTask。
2. 清除审批和用户输入 guard。
3. 将 Thread 设置为 `systemError`，而不是 `active`。
4. 如果 terminal event 已经 fsync，仅 SQLite 投影失败，则后台 projector 可以幂等重试。
5. 如果 terminal event 本身未能持久化，记录 `TURN_TERMINAL_PERSIST_FAILED`，停止该
   project/session 的新 Turn，并要求恢复流程补写明确终态。
6. snapshot 必须暴露 systemError 和 error code，GUI 不得继续显示普通运行动画。

这对应 Codex 在系统错误时清除 running 和所有 pending counter 的处理原则。

## 12. ThreadRuntimeRegistry

建议新增：

```text
nanobot/runtime/thread_registry.py
nanobot/runtime/turn_lifecycle.py
```

接口：

```python
class ThreadRuntimeRegistry:
    async def load_thread(session_key: str) -> None: ...
    async def unload_thread(session_key: str) -> None: ...
    async def start_turn(spec: StartTurnSpec) -> ActiveTurn: ...
    async def finish_turn(spec: FinishTurnSpec) -> FinishResult: ...
    async def interrupt_turn(
        session_key: str,
        expected_turn_id: str,
        reason: FinishReason,
    ) -> bool: ...
    async def snapshot(session_key: str) -> ThreadRuntimeSnapshot: ...
    async def subscribe(session_key: str) -> AsyncIterator[ThreadRuntimeSnapshot]: ...
```

实现要求：

- registry 内部使用单一 `asyncio.Lock` 或每 session 串行 actor。
- start/finish/approval counter 更新和 snapshot 发布在同一个临界区内完成。
- subscription 是带当前值的 snapshot/watch 语义，不是只发送边沿事件。
- pending approval/user input 使用 guard/context manager，在退出或异常时自动递减。
- 任何 subscriber 断开都不影响 runtime 状态。

## 13. RunningTask 与取消

Python 适配 Codex `RunningTask + CancellationToken + AbortOnDrop`：

```python
@dataclass
class RunningTask:
    task: asyncio.Task
    cancellation: CancellationToken
    done: asyncio.Event
    turn_id: str
```

要求：

1. ActiveTurn 拥有 RunningTask。
2. `/stop` 必须带 `expected_turn_id`，避免旧停止请求误杀新 Turn。
3. 先触发 cooperative cancellation。
4. 在短 grace period 内等待任务退出。
5. 超时后 `task.cancel()`。
6. 无论任务是否优雅退出，都由 lifecycle 统一提交 interrupted。
7. RunningTask 从 ActiveTurn 移除后才能发布 Thread idle。

## 14. Plan 不是运行状态

### 14.1 Plan 更新

`update_task_progress` 只允许更新当前 ActiveTurn：

```text
request context session_key
    -> registry.active_turn(session_key)
    -> validate turn_id
    -> validate revision
    -> append turn_plan_updated
```

拒绝：

- 没有 ActiveTurn 时更新 Plan。
- 更新其他 project/session/turn 的 Plan。
- revision 回退。
- 多于一个 `inProgress` step。
- `currentStepId` 指向非 inProgress step。

### 14.2 模型契约与服务端保障

仍要求 Agent：

- 工具任务开始时发布 2–4 步计划。
- 每次发送完整稳定快照。
- 最终回答前发布全终态快照。

但系统不得依赖模型完全遵守。Turn 终态提交时，服务端必须强制终态化残留步骤：

| Turn 终态 | 原 inProgress | 原 pending |
| --- | --- | --- |
| completed | skipped | skipped |
| failed | failed | skipped |
| interrupted | interrupted | skipped |

已 completed/failed/skipped/interrupted 的步骤保持不变。

completed Turn 中残留步骤不能被伪装为 completed；应设置：

```text
terminalizationReason = "turn_completed_without_explicit_plan_close"
```

这样 UI 停止动画，同时不虚构工作已完成。

### 14.3 Plan 显示

右侧 Progress 数据源优先级：

1. Runtime Snapshot 中当前 ActiveTurn 的 Plan。
2. 最新 terminal Turn 的 SQLite Plan 投影。
3. legacy transcript `agentUI.task_progress` 兼容投影。

新会话不得再以 GUI messages 中最后一个 `task_progress` 作为唯一事实来源。

## 15. Turn Items

Turn Item 使用稳定类型：

```text
user_message
assistant_answer
narration
tool_call
file_edit
artifact
approval_request
user_input_request
plan
```

所有 Item 必须携带：

```text
project_id
session_id
turn_id
item_id
sequence_no
created_at
status/revision（适用时）
```

文本 token delta 可以只存在实时流和 JSONL 聚合过程；最终 Item 投影进入 SQLite。

## 16. 子 Agent 与后台任务

### 16.1 Same-turn child work

如果主回答依赖子 Agent 结果，子 Agent 必须注册到：

```text
ActiveTurn.same_turn_children
```

最终回答 guard 必须在 answer commit 前检查 required child。主 Turn 只有在 join policy
满足后才能提交最终回答和 terminal：

- required child：必须 completed/failed/interrupted。
- best-effort child：在 terminal barrier 时取消或转为 detached next-turn work。

最终回答已经 commit 后仍在运行的 child 一律不得继续阻塞原 Turn；它必须被取消、转入
next-turn mailbox 或降为 detached work。这样不会出现“最终报告已经展示，但原会话仍因
迟到子 Agent 长时间运行”的模糊状态。

### 16.2 最终回答后的迟到结果

一旦 final answer committed：

- 当前 Turn 的 mailbox delivery phase 进入 `nextTurn`。
- 新到的 child result 不得追加到已经终态化的 Turn。
- 需要展示时，进入 session trigger queue，并创建新的 Turn。
- 不需要展示时，作为 detached diagnostic/background result 保存。

### 16.3 Detached background work

以下任务默认不属于 ActiveTurn：

- 会话标题生成。
- Project Memory Phase 1/2。
- Artifact hash、索引和 reconcile。
- 日志压缩。
- 非用户可见的缓存预热。

这些任务有自己的 job id、状态和错误日志，但不影响 Thread running。

## 17. 持久化模型

### 17.1 sessions

`sessions.status` 仅表示 durable session lifecycle，例如：

```text
active | archived
```

不得使用 `sessions.status = running` 表示实时执行。

保留 `active_turn_id` 时增加：

```sql
ALTER TABLE sessions ADD COLUMN runtime_epoch TEXT;
```

读取 live active 时必须同时匹配当前 gateway runtime epoch。

### 17.2 turns

目标 schema：

```sql
CREATE TABLE turns_v2 (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  turn_index      INTEGER NOT NULL,
  status          TEXT NOT NULL
                  CHECK (status IN (
                    'queued',
                    'in_progress',
                    'completed',
                    'failed',
                    'interrupted'
                  )),
  runtime_epoch   TEXT,
  started_at      INTEGER,
  completed_at    INTEGER,
  duration_ms     INTEGER,
  finish_reason   TEXT,
  error_code      TEXT,
  error_message   TEXT,
  terminal_event_id TEXT,
  UNIQUE(session_id, turn_index),
  UNIQUE(terminal_event_id),
  FOREIGN KEY(session_id, project_id)
    REFERENCES sessions(id, project_id)
);
```

### 17.3 Plan

`turn_progress/turn_steps` 增加：

- `skipped`
- `interrupted`
- `terminalization_reason`
- 单调 `revision`

SQLite trigger 或 service validation 保证同一个 Turn 最多一个 `in_progress` step。

### 17.4 Runtime epoch

gateway 每次启动生成：

```text
runtime_epoch = UUID
```

启动恢复：

1. 找出 status 为 queued/in_progress 且 epoch 不等于当前 epoch 的 Turn。
2. append `turn_interrupted(reason=gatewayRestarted)`。
3. 幂等投影为 interrupted。
4. 清除 session active_turn_id/runtime_epoch。
5. 不向 ThreadRuntimeRegistry 注册这些旧 Turn。

旧 Turn 不应标为普通业务失败；`interrupted/gatewayRestarted` 更符合事实。

## 18. 事件日志

### 18.1 标准事件

```text
turn_started
turn_item_started
turn_item_updated
turn_item_completed
turn_plan_updated
turn_answer_committed
turn_completed
turn_failed
turn_interrupted
thread_status_changed
```

其中前三种 terminal journal event 在公开协议层统一投影为 `turn_completed` 通知，通知内的
`turn.status` 分别为 `completed`、`failed` 或 `interrupted`。GUI 不需要订阅三个不同的
终态事件。这与 Codex app-server 使用统一 terminal Turn resource 的方式一致。

### 18.2 Event Envelope

```json
{
  "schema_version": 2,
  "event_id": "turn-terminal:turn_123",
  "event_seq": 42,
  "event": "turn_completed",
  "recorded_at": 1785052800000,
  "runtime_epoch": "epoch_uuid",
  "project_id": "prj_123",
  "session_id": "ses_123",
  "session_key": "websocket:chat_123",
  "turn_id": "turn_123",
  "payload": {
    "finish_reason": "success",
    "duration_ms": 18234
  }
}
```

### 18.3 Terminal 不变量

每个 `turn_started` 必须满足以下之一：

```text
恰好一个 turn_completed
或恰好一个 turn_failed
或恰好一个 turn_interrupted
```

projector 检测到多个不同 terminal event 时：

1. 保留第一个已提交终态。
2. 记录 `TURN_TERMINAL_CONFLICT`。
3. 不覆盖原终态。
4. diagnostics API 暴露冲突。

## 19. REST Snapshot API

新增：

```http
GET /api/sessions/{encoded_key}/runtime-snapshot
Authorization: Bearer {token}
```

响应：

```json
{
  "snapshot_revision": 18,
  "project_id": "prj_123",
  "session_id": "ses_123",
  "session_key": "websocket:chat_123",
  "thread_status": {
    "type": "active",
    "active_flags": []
  },
  "active_turn": {
    "id": "turn_123",
    "status": "inProgress",
    "started_at": 1785052800000,
    "completed_at": null,
    "duration_ms": null,
    "finish_reason": null,
    "plan": {
      "turn_id": "turn_123",
      "revision": 3,
      "status": "inProgress",
      "current_step_id": "analyze",
      "steps": []
    }
  },
  "latest_turn": null
}
```

规则：

- `active_turn` 只能来自 ThreadRuntimeRegistry。
- `latest_turn` 来自 SQLite terminal projection。
- snapshot 构造时再次校验 project/session/key 一致。
- `snapshot_revision` 对同一 session 单调递增。
- `/api/sessions` 可以附带 thread status 摘要，但会话详情以 snapshot API 为准。

## 20. WebSocket 协议

### 20.1 新事件

```json
{
  "event": "thread_status_changed",
  "chat_id": "chat_123",
  "snapshot_revision": 19,
  "thread_status": {
    "type": "idle"
  }
}
```

```json
{
  "event": "turn_started",
  "chat_id": "chat_123",
  "snapshot_revision": 20,
  "turn": {
    "id": "turn_456",
    "status": "inProgress",
    "started_at": 1785052800000
  }
}
```

公开 WebSocket 只使用一个 `turn_completed` 表示所有终态：

```json
{
  "event": "turn_completed",
  "chat_id": "chat_123",
  "snapshot_revision": 25,
  "turn": {
    "id": "turn_456",
    "status": "completed",
    "completed_at": 1785052818234,
    "duration_ms": 18234,
    "finish_reason": "success"
  }
}
```

失败或中断时保持相同事件名，只改变 Turn Resource：

```json
{
  "event": "turn_completed",
  "chat_id": "chat_123",
  "snapshot_revision": 25,
  "turn": {
    "id": "turn_456",
    "status": "interrupted",
    "finish_reason": "userInterrupted",
    "completed_at": 1785052818234
  }
}
```

Plan 使用：

```json
{
  "event": "turn_plan_updated",
  "chat_id": "chat_123",
  "snapshot_revision": 23,
  "turn_id": "turn_456",
  "plan": {
    "turn_id": "turn_456",
    "revision": 4,
    "status": "inProgress",
    "current_step_id": "report",
    "steps": []
  }
}
```

### 20.2 顺序与恢复

客户端处理规则：

1. 小于当前 `snapshot_revision` 的状态事件忽略。
2. revision 不连续时立即拉取 runtime snapshot。
3. WebSocket open/reopen 后拉取当前可见 session snapshot。
4. sidebar 中标记 active 的 session 可批量拉取 snapshot。
5. terminal event 到达后再次以 event payload 更新，不需要等待会话列表轮询。

### 20.3 兼容事件

迁移期间继续发送：

- `goal_status`
- `turn_end`

但它们由新 lifecycle 事件适配生成：

```text
turn_started            -> legacy goal_status running
turn_completed(any status) -> legacy turn_end + goal_status idle
```

旧事件不得反向驱动新 runtime 状态。

## 21. GUI 状态模型

### 21.1 chatStore

Conversation 增加：

```ts
interface ConversationRuntime {
  snapshotRevision: number;
  threadStatus: ThreadStatus;
  activeTurn: TurnResource | null;
  latestTurn: TurnResource | null;
}
```

侧栏 running 判定只能是：

```ts
conversation.runtime.threadStatus.type === "active"
```

删除或停止使用：

- `setConversationStatus(id, stream.isStreaming ? "running" : "idle")`
- 通过本地 `runStartedAtByChatId` 决定会话真相
- 重连时“保留本地 running”的逻辑

本地 `runStartedAt` 可以作为计时显示缓存，但必须来自 active Turn snapshot，并在 snapshot
变为非 active 时立即清除。

### 21.2 useNanobotStream

仅负责：

- answer/narration/reasoning buffer。
- stream segment open/close。
- 消息和 Turn Item 增量。

不负责：

- conversation running。
- Thread idle。
- 持久化 Plan 终态。

### 21.3 ConversationWorkbench

Progress 改为读取：

```text
conversation.runtime.activeTurn.plan
或 conversation.runtime.latestTurn.plan
```

legacy message-derived Plan 只用于旧历史兼容。

### 21.4 断线

WebSocket close 时：

1. 关闭本地 token stream animation。
2. connection status 显示 disconnected/reconnecting。
3. 不把 Thread 自动标为 idle，也不继续确信 active。
4. 将 runtime snapshot 标记为 stale。
5. 重连后立即重新获取 snapshot。

UI 可以显示“正在重新连接”，不能把网络状态伪装为 Agent 状态。

## 22. 当前实现迁移

### Phase A：后台生命周期内核

1. 新增 `ThreadRuntimeRegistry` 和 `TurnLifecycleManager`。
2. `AgentLoop._dispatch()` 使用 TurnScope。
3. success/error/cancel 统一调用 `finish_turn()`。
4. `_WEBSOCKET_TURN_WALL_STARTED_AT` 改为 registry 的只读兼容投影。
5. `/stop` 增加 expected turn id。
6. 添加 runtime epoch 和 startup interrupted reconciliation。

完成标准：

- 新 Turn 不再依赖散落的手工 `turn_completed()` 调用保证终态。
- 任意异常退出 TurnScope 都产生 terminal event。

### Phase B：标准事件与 Snapshot

1. 增加 v2 lifecycle event schema。
2. JSONL terminal event 前后 flush。
3. projector 支持 v2 Turn/Plan 状态。
4. 增加 runtime snapshot API。
5. `/api/sessions` 叠加 registry 的 ThreadStatus。

完成标准：

- WebSocket 断线后只靠 snapshot 能恢复正确 UI。
- SQLite 中的旧 in_progress 不会导致 live active。

### Phase C：GUI 单一投影

1. 增加 TS Thread/Turn/Plan 类型。
2. chatStore 保存 Runtime Snapshot。
3. 删除 ChatView 根据 `isStreaming` 设置 status。
4. Sidebar、计时条和 Workbench 改读 snapshot。
5. reconnect 和 revision gap 自动补拉 snapshot。

完成标准：

- GUI 没有第二个 conversation running 写入者。
- 切换会话不会复制上一个会话的运行状态。

### Phase D：Plan 强制收口

1. `update_task_progress` 绑定 ActiveTurn 和 revision。
2. terminal barrier 强制终态化 Plan。
3. GUI 支持 skipped/interrupted。
4. Workbench 优先读取 Turn Plan Resource。

完成标准：

- 模型忘记最后一次 Plan 更新时，UI 也不会永久 running。
- 未执行步骤不会被伪装为 completed。

### Phase E：子 Agent 和后台工作

1. same-turn child 注册与 join policy。
2. final answer 后 mailbox 切换到 nextTurn。
3. title/memory/artifact indexing 从 ActiveTurn 分离。
4. 迟到结果不修改 terminal Turn。

### Phase F：兼容清理

满足至少一个稳定发布周期后：

- 移除 GUI 对 legacy `goal_status` 的运行态依赖。
- 移除进程内 wall time Map。
- 移除 message-derived Plan 主路径。
- 保留旧 transcript replay adapter。

## 23. 建议代码改动位置

### nanobot

```text
nanobot/runtime/thread_registry.py               新增
nanobot/runtime/turn_lifecycle.py                新增
nanobot/agent/loop.py                            TurnScope 接入
nanobot/agent/subagent.py                        child join / nextTurn
nanobot/agent/tools/task_progress.py             turn/revision 校验
nanobot/session/webui_turns.py                   兼容适配
nanobot/channels/websocket.py                    v2 lifecycle 事件
nanobot/webui/ws_http.py                         runtime snapshot API
nanobot/webui/transcript.py                      v2 replay
nanobot/storage/state.py                         v2 migration/projector
nanobot/webui/gateway_services.py                runtime epoch/reconcile
```

### nanobot-gui

```text
src/core/types.ts                                Thread/Turn/Plan 类型
src/core/api.ts                                  snapshot API
src/core/nanobot-client.ts                       revision-aware lifecycle events
src/core/nanobotClient.ts                        reconnect snapshot sync
src/hooks/useNanobotStream.ts                    移除运行态权威
src/stores/chatStore.ts                          Runtime Snapshot 镜像
src/stores/conversationWorkbenchStore.ts         Turn Plan 投影
src/components/chat/ChatView.tsx                 删除 isStreaming -> running
src/components/sidebar/Sidebar.tsx               使用 ThreadStatus
src/components/panel/ConversationWorkbench.tsx   skipped/interrupted
```

## 24. 诊断与可观测性

每个 lifecycle 日志至少包含：

```text
runtime_epoch
project_id
session_id
session_key
turn_id
previous_status
next_status
finish_reason
event_id
snapshot_revision
task_name
```

标准错误码：

```text
TURN_ALREADY_ACTIVE
TURN_NOT_ACTIVE
TURN_ID_MISMATCH
TURN_TERMINAL_CONFLICT
TURN_SCOPE_EXIT_WITHOUT_TERMINAL
TURN_PROJECT_MISMATCH
TURN_RECONCILED_AFTER_RESTART
PLAN_REVISION_CONFLICT
PLAN_MULTIPLE_ACTIVE_STEPS
SNAPSHOT_REVISION_GAP
```

Diagnostics API 应支持按 session/turn 查询：

- 当前 runtime snapshot。
- 最新 terminal event。
- SQLite Turn/Plan 投影。
- projector watermark。
- 是否发生 reconciliation。

## 25. 测试方案

### 25.1 后台单元测试

1. start Turn 后 Thread 为 active。
2. completed/failed/interrupted 后 Thread 不再 active。
3. 每种异常退出 TurnScope 都产生唯一终态。
4. 重复相同 terminal event 幂等。
5. 冲突 terminal event 被拒绝。
6. expected turn id 不匹配时 interrupt 不生效。
7. approval/user input guard 在异常后自动递减。
8. Plan revision 回退被拒绝。
9. 多个 inProgress Plan step 被拒绝。
10. terminal barrier 正确收口 Plan。
11. detached background job 不影响 Thread idle。
12. required child 未结束时 Turn 不能完成。

### 25.2 持久化与恢复测试

1. final answer 后、terminal append 前模拟崩溃。
2. terminal append 后、SQLite commit 前模拟崩溃。
3. SQLite commit 后、WebSocket 发送前模拟崩溃。
4. gateway 重启把旧 inProgress 转为 interrupted/gatewayRestarted。
5. SQLite 损坏后从 JSONL 重建相同终态。
6. 重复 replay 不增加第二个 terminal event。
7. A 项目的 Turn 无法投影到 B 项目 Session。

### 25.3 WebSocket/REST 集成测试

1. 正常 Turn 顺序：started → items → completed → idle。
2. provider error：started → turn_completed(status=failed) → idle。
3. 用户停止：started → turn_completed(status=interrupted) → idle。
4. 中途断线，重连 snapshot 恢复 active。
5. 终态通知丢失，snapshot 恢复 completed。
6. revision gap 触发 snapshot refresh。
7. 旧客户端仍收到 goal_status/turn_end。

### 25.4 GUI 测试

1. `isStreaming=true` 不能单独把 conversation 设置为 running。
2. active snapshot 驱动侧栏运行标记。
3. disconnected 不被显示为 idle 或 completed。
4. reconnect 后旧 running 被 snapshot 覆盖。
5. completed Turn 中遗留 Plan step 显示 skipped，不再动画。
6. 切换会话不会复用前一会话的 Plan 或 running。
7. terminal event 后滚动位置、Steps 和 Artifact 不受影响。

### 25.5 真实回归场景

必须覆盖：

- 投研报告正常完成。
- PDF 已生成但后续渲染或索引失败。
- 专家团队主 Agent 提前输出回答。
- 子 Agent 在最终回答后迟到。
- Project Memory Phase 2 失败。
- MCP 长时间调用后取消。
- gateway 被 Electron 自动重启。
- WebSocket 握手失败并重连。

## 26. 验收标准

1. Agent 最终回答出现后，terminal event 正常到达时 500ms 内停止会话 running。
2. terminal WebSocket 事件丢失后，重连 snapshot 能在一次请求内恢复正确状态。
3. gateway 重启后不存在从旧 epoch 继承的 live active Turn。
4. SQLite 中不存在长期 queued/in_progress 且没有明确 reconciliation 记录的 Turn。
5. GUI 不再写入权威 conversation running。
6. Plan 没有发布、发布失败或忘记最终更新，都不影响 Turn 终态。
7. terminal Turn 的 Plan 不包含 inProgress。
8. 同一 Session 不会并发出现两个 ActiveTurn。
9. 所有 terminal Turn 都有 `completed_at`、`finish_reason` 和唯一 terminal event id。
10. same-turn 子 Agent 未完成时不会错误提交 completed。
11. detached 记忆、标题和 Artifact 索引不会让会话继续显示运行中。
12. 项目、会话、Turn、Plan、Item 和 Artifact 的 project id 全链路一致。

## 27. 实施记录（2026-07-26）

本规范的主链路已经按以下边界落地：

- Python runtime 已增加 `ThreadRuntimeRegistry`、`TurnLifecycleManager`、
  `TurnScope`、`runtime_epoch`、单 final-answer guard 和 expected turn id 校验。
- WebSocket 主入口以 `turn_started`、统一 `turn_completed` 和
  `thread_status_changed` 作为 v2 lifecycle；`goal_status`、`turn_end` 仅作为兼容事件。
- `turn_completed` 在清除 ActiveTurn 前经过 JSONL fsync 与 SQLite 幂等投影 barrier；
  terminal event id 由 `runtime_epoch + turn_id` 稳定生成。
- SQLite schema v5 保存 `runtime_epoch`、`finish_reason`、`terminal_event_id`；
  启动时旧 running Turn 通过 journal-first recovery 变为
  `interrupted / gatewayRestarted`，最后才使用直接 reconcile 兜底。
- 已增加 Runtime Snapshot 与 runtime diagnostics API。Snapshot 的
  `active_turn` 只来自进程 registry，`latest_turn` 只来自 SQLite。
- GUI 保存 Runtime Snapshot 镜像，以 `runtime_epoch + snapshot_revision`
  拒绝旧事件；流式 token、`isStreaming` 和 WebSocket 断线均不再写会话 running。
- Plan 已绑定 `turn_id/revision`，步骤身份不可变，revision 不可倒退；terminal
  barrier 和 transcript replay 都会收口遗留的 pending/running 步骤。
- 最终回答提交前会 join/cancel same-turn 子 Agent；Project Memory、标题和产物索引
  继续作为 detached background jobs，不影响 Thread running。

兼容窗口内旧事件仍会发送，但 SQLite projector 会把 v2 后到达的 legacy
`turn_end` 识别为 compatibility alias，不允许它覆盖或制造第二个终态。

## 28. 实施决策摘要

本项目最终采用：

```text
实时运行事实
    ThreadRuntimeRegistry + ActiveTurn

任务执行所有权
    ActiveTurn -> RunningTask -> cancellation

历史事实
    append-only JSONL terminal events

查询和恢复
    SQLite idempotent projection

实时 UI
    runtime snapshot + revisioned WebSocket notification

任务计划
    Turn-owned Plan resource，不控制 Thread running

GUI
    只读投影，不从 stream 或 plan 猜测运行态
```

SQLite 仍然是项目、会话、Turn、Plan、Item 和 Artifact 关系的关键基础设施，但它不替代
ActiveTurn。Codex 最值得借鉴的不是“使用 SQLite”，而是把实时所有权、终态事件、持久化历史
和 UI 投影拆成不同层，并让每层只有一个清晰职责。
