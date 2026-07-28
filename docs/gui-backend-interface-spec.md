# GUI 后端接口 Spec

本文档记录当前 `nanobot-gui` 实际对接的后端接口。接口分为两类：

- `nanobot gateway`：本地 Python gateway，默认由 Electron 启动，运行在 `127.0.0.1:{port}`。
- `PromptHub`：技能商店服务，默认地址来自 `promptHubStore.baseUrl`。

Turn 生命周期 v2、Runtime Snapshot 和任务计划终态协议见
[turn-lifecycle-runtime-spec.md](turn-lifecycle-runtime-spec.md)。

## nanobot gateway

### 启动与认证

| 类型 | 接口 | 用途 |
| --- | --- | --- |
| Electron IPC | `nanobot:status` | 获取 gateway 是否 ready、端口、token secret。 |
| Electron IPC | `nanobot:sync-config` | 将 GUI 设置同步到 nanobot 启动配置。 |
| HTTP GET | `/webui/bootstrap` | 用 `X-Nanobot-Auth` 换取短期 token 和 WebSocket 地址。 |
| WebSocket | `ws_path?token=...` | 聊天、事件、会话更新的主通道。 |

### 会话与聊天

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/sessions` | 获取会话列表。 |
| GET | `/api/sessions/{key}/webui-thread` | 获取会话消息快照。 |
| GET | `/api/sessions/{key}/artifacts` | 获取当前会话工作区内的安全产物列表。 |
| GET | `/api/sessions/{key}/artifacts/content?path=...` | 鉴权读取或下载会话产物。 |
| GET | `/api/sessions/{key}/delete` | 删除会话。 |
| GET | `/v1/session/websocket:{conversationId}/info` | 获取会话信息。 |
| GET | `/v1/memory` | 读取 nanobot memory。 |

WebSocket 发送：

- 用户消息。
- workspace scope。
- 图片附件。
- MCP preset / CLI app / skill scope。
- interactive prompt answer。

WebSocket 接收：

- `delta`
- `stream_end`
- `reasoning_delta`
- `reasoning_end`
- `narration_delta`
- `narration_end`
- `message`
- `file_edit`
- `artifact_created`
- `turn_end`
- `error`
- `session_update`
- `runtime_model_update`
- `run_status`
- `goal_state`
- `team_run_started`
- `team_member_updated`
- `team_run_completed`

### 设置

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/settings` | 读取设置。 |
| GET | `/api/settings/update?...` | 更新模型、provider、上下文窗口、bot 信息等基础设置。 |
| GET | `/api/settings/provider/update?...` | 更新 provider API key/base/type。 |
| GET | `/api/settings/provider/oauth-login?...` | provider OAuth 登录。 |
| GET | `/api/settings/provider/oauth-logout?...` | provider OAuth 登出。 |
| GET | `/api/settings/provider-models?provider=...` | 获取 provider 模型列表。 |
| GET | `/api/settings/model-configurations/create?...` | 创建模型配置。 |
| GET | `/api/settings/model-configurations/update?...` | 更新模型配置。 |
| GET | `/api/settings/model-configurations/delete?...` | 删除模型配置。 |
| GET | `/api/settings/web-search/update?...` | 更新联网搜索配置。 |
| GET | `/api/settings/network-safety/update?...` | 更新网络安全配置。 |
| GET | `/api/settings/image-generation/update?...` | 更新图像生成配置。 |

### 工作区

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/workspaces` | 获取工作区列表和控制信息。 |
| WebSocket | `setWorkspaceScope` payload | 设置当前会话 workspace scope。 |

### 会话工作台

完整产品和协议说明见 [conversation-workbench-spec.md](conversation-workbench-spec.md)。

#### Steps narration

普通 `delta` 在片段结束前是 provisional 文本。gateway 确认该片段后面会继续调用工具时发送：

```json
{
  "event": "stream_end",
  "chat_id": "conversation-id",
  "stream_id": "stream-id",
  "resuming": true,
  "stream_kind": "narration"
}
```

随后用 `narration_delta` / `narration_end` 提交公开行动说明：

```json
{
  "event": "narration_delta",
  "chat_id": "conversation-id",
  "stream_id": "stream-id",
  "replaces_stream_id": "stream-id",
  "text": "接下来核对具体报道中的市场数据。"
}
```

没有工具跟随的最终回答以
`stream_end { "resuming": false, "stream_kind": "answer" }` 结束。GUI 将 narration 放进
Steps，把 answer 保留为 assistant 正文。`reasoning_delta` 仍是独立的私有推理通道，
不得当作 narration 或正文渲染。

#### Progress

新协议下右栏 Progress 以 Runtime Snapshot 中的 Turn Plan Resource 为准；
`message.agent_ui.kind === "task_progress"` 的最新快照仅作为 legacy transcript fallback。
没有结构化计划时只显示通用规划/工作状态。GUI 不把 `tool_events` 或 `tool_calls`
投影成计划步骤；工具轨迹只属于聊天中的 Steps。gateway 也不得按 search/read/exec/write
等工具类别自动合成 `task_progress`。

预计调用工具的 Agent 轮次必须先通过 `update_task_progress` 发布完整的 2–4 项计划。
计划标题描述用户目标或交付物，每次更新发送完整列表并保持 id、标题和顺序稳定；
非终态快照恰好一个 `running`，最终回答前所有步骤必须进入 `completed` 或 `error`。

#### Artifacts

列表和内容请求都必须使用显式 gateway base URL，并携带：

```http
Authorization: Bearer {bootstrap_token}
```

`GET /api/sessions/{encoded_key}/artifacts` 以 SQLite artifact registry 为事实来源，返回
`project_id/session_id/artifact id/status/relation` 和相对 workspace path。只有首次访问的
legacy session 可执行一次受限项目内迁移扫描；新会话不扫描目录。

新客户端使用 `GET /api/artifacts/{artifact_id}/content?session={encoded_key}`，服务端同时校验
artifact-session 显式 link、project id、realpath 和 symlink containment；`download=1` 返回
attachment。旧 path content API 仅为滚动升级兼容。文件编辑 start/end 会发送
`artifact_created` 状态提示，HTTP registry 仍是恢复后的事实来源。

GUI 对受保护产物使用 Bearer fetch 后创建临时 object URL 供 PDF、Office、图片和视频预览，
不把 token 放入 URL，也拒绝向 gateway 之外的绝对 URL 发送凭证。

桌面端右栏列表宽度为 `332px`；打开产物后替换为 `min(62vw, 960px)` 阅读栏，聊天保持可见，
左侧导航临时收起并在返回产物列表后恢复。阅读栏提供 breadcrumb、HTML 刷新、系统默认应用
打开、复制路径、在文件管理器中显示和鉴权下载；PDF 使用连续多页预览。

### 项目

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/projects` | 获取 active project registry。 |
| GET | `/api/projects/{id}/sessions` | 获取同一项目的非归档会话。 |
| GET | `/api/projects/{id}/archive` | 软归档项目注册，不删除用户目录。 |
| GET | `/api/projects/{id}/restore` | 恢复归档项目。 |
| GET | `/api/projects/{id}/relocate?path=...` | 保留 project id 并更新根目录。 |
| GET | `/api/projects/{id}/export` | 导出 manifest、状态、会话日志和项目记忆 ZIP。 |

项目动作沿用当前 WebSocket HTTP gateway 的 GET transport 约定，全部要求短期 Bearer token。

### 定时任务

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/schedule/tasks` | 获取定时任务列表。 |
| GET | `/api/schedule/tasks/create?...` | 创建定时任务。 |
| GET | `/api/schedule/tasks/update?...` | 更新定时任务。 |
| GET | `/api/schedule/tasks/delete?id=...` | 删除定时任务。 |
| GET | `/api/schedule/tasks/pause?id=...` | 暂停定时任务。 |
| GET | `/api/schedule/tasks/resume?id=...` | 恢复定时任务。 |
| GET | `/api/schedule/tasks/run?id=...` | 立即运行定时任务。 |
| GET | `/api/schedule/runs/viewed?task_id=...&run_id=...` | 标记运行记录已读。 |

### Skills

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/settings/skills` | 获取 skills 列表。 |
| GET | `/api/settings/skills/detail?name=...` | 获取 skill 详情。 |
| GET | `/api/settings/skills/enable?name=...` | 启用 skill。 |
| GET | `/api/settings/skills/disable?name=...` | 禁用 skill。 |
| GET | `/api/settings/skills/delete?name=...` | 删除 workspace skill。 |
| GET | `/api/settings/skills/save?name=...` | 保存 skill 内容。内容放在 `X-Nanobot-Skill-Values` header。 |

### 专家团队

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/settings/expert-teams` | 获取已注册专家团队列表。 |
| GET | `/api/settings/expert-teams/detail?id=...` | 获取团队成员、工作流和依赖状态。 |

团队会话通过 WebSocket `new_chat` 或 `message` 的 `expert_team` 字段绑定。gateway 将绑定保存到 session metadata，并在会话列表和 `webui-thread` 中返回 `expert_team`。

### MCP

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/settings/mcp-presets` | 获取 MCP preset 列表。 |
| GET | `/api/settings/mcp-presets/enable?name=...` | 启用 MCP preset。 |
| GET | `/api/settings/mcp-presets/remove?name=...` | 删除 MCP preset。 |
| GET | `/api/settings/mcp-presets/test?name=...` | 测试 MCP preset。 |
| GET | `/api/settings/mcp-presets/custom` | 保存自定义 MCP server。参数放在 `X-Nanobot-Mcp-Values` header。 |
| GET | `/api/settings/mcp-presets/import` | 导入 MCP 配置。配置放在 `X-Nanobot-Mcp-Values` header。 |
| GET | `/api/settings/mcp-presets/tools` | 更新 MCP server 启用工具。 |

### CLI Apps

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/settings/cli-apps` | 获取 CLI app 列表。 |
| GET | `/api/settings/cli-apps/install?name=...` | 安装 CLI app。 |
| GET | `/api/settings/cli-apps/update?name=...` | 更新 CLI app。 |
| GET | `/api/settings/cli-apps/uninstall?name=...` | 卸载 CLI app。 |
| GET | `/api/settings/cli-apps/test?name=...` | 测试 CLI app。 |

### 命令与侧栏状态

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/commands` | 获取 slash command 列表。 |
| GET | `/api/webui/sidebar-state` | 获取 WebUI 侧栏状态。 |
| GET | `/api/webui/sidebar-state/update?state=...` | 更新 WebUI 侧栏状态。 |

## PromptHub

PromptHub 不属于 nanobot gateway。GUI 通过 `src/core/prompthubApi.ts` 直接访问。

### 认证

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| POST | `/api/users/login` | 用户登录。请求体为 `{ username, passwordHash }`，返回 `{ token, user }`。 |

登录后的请求使用：

```http
Authorization: Bearer {token}
```

### 技能商店列表

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| POST | `/api/convex/query` | 获取公开技能列表。 |

请求体：

```json
{
  "path": "skills:listPublicPageV4",
  "args": {}
}
```

GUI 兼容返回字段：

- `page`
- `items`

每项结构：

```ts
{
  skill: PromptHubSkill
}
```

### 技能详情

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/skills/{id}` | 获取技能详情、最新版本和文件列表。 |

返回核心字段：

```ts
{
  skill: PromptHubSkill;
  latestVersion?: { id: string; version: string } | null;
  files: Array<{
    path: string;
    size: number;
    sha256: string;
    contentType: string;
  }>;
}
```

### 技能文件内容

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/skill-versions/files?versionId=...&path=...` | 获取某个版本的文件内容。 |

GUI 当前主要读取 `SKILL.md` 或 `skills.md`。

### 发布技能

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| POST | `/api/skills/publish` | 从“我的技能”上传 skill 到 PromptHub。 |

请求格式：`multipart/form-data`

字段：

- `slug`
- `displayName`
- `version`
- `changelog`
- `visibility`：当前 GUI 固定为 `public`
- `category`：当前 GUI 固定为 `general`
- `tags`
- `files`：当前 GUI 上传技能目录内的文件，保留相对路径

返回核心字段：

```ts
{
  status: string;
  skillId: string;
  versionId: string;
  fingerprint: string;
  fileCount: number;
}
```

## 代码入口

| 文件 | 作用 |
| --- | --- |
| `src/core/api.ts` | nanobot REST API wrapper。 |
| `src/core/nanobotClient.ts` | nanobot bootstrap、token、WebSocket client 初始化、会话同步。 |
| `src/core/nanobot-client.ts` | WebSocket client 实现。 |
| `src/core/sessionArtifacts.ts` | 会话 Artifacts API、鉴权和 payload 归一化。 |
| `src/core/prompthubApi.ts` | PromptHub API wrapper。 |
| `electron/pythonBridge.ts` | 启动 `python -m nanobot desktop-gateway`。 |
| `electron/main.ts` | 暴露 `nanobot:status`、`nanobot:sync-config` IPC。 |
