# GUI 后端接口 Spec

本文档记录当前 `nanobot-gui` 实际对接的后端接口。接口分为两类：

- `nanobot gateway`：本地 Python gateway，默认由 Electron 启动，运行在 `127.0.0.1:{port}`。
- `PromptHub`：技能商店服务，默认地址来自 `promptHubStore.baseUrl`。

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
- `reasoning_delta`
- `message`
- `turn_end`
- `error`
- `session_update`
- `runtime_model_update`
- `run_status`
- `goal_state`

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
| `src/core/prompthubApi.ts` | PromptHub API wrapper。 |
| `electron/pythonBridge.ts` | 启动 `python -m nanobot desktop-gateway`。 |
| `electron/main.ts` | 暴露 `nanobot:status`、`nanobot:sync-config` IPC。 |
