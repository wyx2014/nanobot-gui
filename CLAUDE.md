# TPCowork（TPCowork）项目说明

## 项目概览

TPCowork 是一个本地运行的 AI 桌面办公助手。当前项目定位是 Electron 桌面 GUI：负责桌面体验、聊天界面、设置、工具箱、定时任务和文件预览；真正的 Agent 运行时由内置 Python `nanobot` gateway 承接。

当前版本：`0.0.1`

应用 ID：`com.tparuyi.app`

运行时分工：

- Electron 主进程负责启动/停止本地 Python gateway。
- React renderer 负责 UI 状态、设置、聊天渲染、工具箱、定时任务界面和文件预览。
- Python `nanobot` 负责 Agent loop、模型路由、记忆、工具执行、MCP、定时任务触发、安全策略和会话持久化。

## 当前架构

```text
electron/main.ts
  ├─ BrowserWindow 生命周期
  ├─ 文件 / shell / 窗口 IPC
  ├─ 配置同步 IPC
  └─ pythonBridge.start()

electron/pythonBridge.ts
  ├─ 开发环境 Python: ../nanobot/venv/bin/python3
  ├─ 打包环境 Python: resources/python/bin/python3
  ├─ 启动命令: python -m nanobot desktop-gateway
  └─ 端口: 8900

src/App.tsx
  ├─ syncNanobotSettings()
  ├─ bootstrapNanobotGateway()
  ├─ syncGatewaySettingsToStore()
  └─ syncSessionsFromGateway()

src/core/nanobot/chatBridge.ts
  └─ sendNanobotMessage()
       ├─ 先把用户/助手消息乐观写入 chatStore
       ├─ 通过 NanobotClient WebSocket 发送消息
       └─ 将 gateway 事件映射为 GUI 状态

nanobot gateway
  ├─ Agent loop
  ├─ 模型服务
  ├─ 记忆 / 会话
  ├─ 工具执行
  ├─ MCP
  ├─ CronService 定时任务
  └─ 沙箱 / 安全策略
```

## 重要边界

不要重新引入 GUI 本地执行引擎。

以下旧的 GUI 侧子系统已经删除或被替换：

- `src/core/agent`
- `src/core/agent_v2`
- `src/core/llm`
- `src/core/memory`
- `src/core/tools`
- 作为执行来源的 GUI 本地 tool registry
- GUI 本地定时任务 tick/scheduler

GUI 可以保留轻量辅助模块，用于渲染、发现、权限展示、安全标签和兼容旧状态；但执行权威属于 nanobot。

## 技术栈

- 前端：React 19 + TypeScript 5.9 + Vite
- 桌面：Electron 34 + electron-vite
- 样式：Tailwind CSS 4 + 本地 UI 组件
- 状态：Zustand + Immer
- 运行时后端：Python `nanobot` gateway
- 通信：REST + WebSocket
- 打包：electron-builder + standalone Python
- 测试：Vitest + happy-dom

## 常用命令

```bash
npm install

# 开发
npm run electron:dev
npm run dev

# 构建
npm run build
npm run electron:build

# 打包
npm run build:mac
npm run build:win

# 测试
npm run test
npm run test:watch
npm run test:coverage

# 代码质量
npm run lint
```

打包命令会先执行 `prepare-python`。该脚本会下载 standalone Python 到 `embedded-python/runtime/`，并把 `../nanobot[desktop]` 安装进去。

## 运行环境要求

开发环境：

- Node.js 20+
- npm
- 同级目录存在 `../nanobot`
- 已安装 nanobot 虚拟环境：

```bash
cd ../nanobot
python3 -m venv venv
venv/bin/pip install -e ".[desktop]"
```

打包后的应用：

- 用户不需要安装 Node。
- 如果 `prepare-python` 成功，用户不需要安装系统 Python。
- 用户仍然需要配置模型 API Key 或 OAuth。

当前打包目标支持情况：

- macOS arm64/x64 standalone Python 已支持。
- Windows x64 standalone Python 和 NSIS 安装包已支持，并由 Windows GitHub Actions 原生打包。
- Linux x64 standalone Python 和 AppImage 已支持，并由 Ubuntu GitHub Actions 原生打包。

## 项目结构

```text
electron/
  main.ts             # 主进程、窗口生命周期、IPC
  preload.ts          # Renderer bridge
  pythonBridge.ts     # 启动/停止 nanobot gateway
  nanobotConfig.ts    # 将 GUI 设置同步到 gateway 配置

src/
  App.tsx             # 应用启动和顶层视图路由
  components/
    chat/             # 聊天 UI、消息渲染、工具进度 UI
    sidebar/          # 会话/侧栏导航
    settings/         # 系统设置和工具箱视图容器
    customize/        # Skills 和 MCP 工具箱内容
    schedule/         # 定时任务 UI
    panel/            # 右侧面板
    preview/          # 文件预览组件
    ui/               # 基础 UI 控件
  core/
    api.ts            # nanobot REST API 封装
    bootstrap.ts      # bootstrap token / WebSocket URL 辅助
    types.ts          # gateway payload 类型
    nanobotClient.ts  # gateway bootstrap、WebSocket client、同步辅助
    nanobot/          # 聊天桥和 GUI 事件适配
    net/              # app fetch 兼容辅助
    runtime/          # 行为传感、computer use 权限辅助
    safety/           # GUI 侧路径/命令安全辅助
    search/           # 搜索服务设置辅助
    context/          # UI/本地上下文和 token 工具
  stores/             # Zustand stores
  i18n/               # 国际化文案
  utils/              # 平台、路径、通知、存储工具

builtin-agents/       # 预留 Agent 定义
embedded-python/      # prepare-python 后的 standalone Python runtime
dist/installers/      # 打包产物输出目录
```

## 主要数据流

### 应用启动

1. Electron 主进程创建窗口。
2. 主进程通过 `PythonBridge` 启动 nanobot，nanobot 内部启动 `CronService`。
3. Renderer 使用本地 GUI 设置调用 `syncNanobotSettings()`。
4. Renderer 调用 `bootstrapNanobotGateway()`。
5. Renderer 从 gateway 同步设置和会话。

### 一轮聊天

1. `ChatView` 调用 `sendNanobotMessage()`。
2. GUI 先乐观写入用户消息。
3. `NanobotClient.sendMessage()` 通过 WebSocket 发送本轮输入。
4. gateway 持续推送事件：
   - `delta`
   - `reasoning_delta`
   - 带 `tool_hint` / `progress` 的 `message`
   - `file_edit`
   - `turn_end`
   - `error`
5. GUI 将这些事件映射到 `chatStore` 和 `taskExecutionStore`。
6. 完成后，把执行步骤快照写入当前会话。

### 设置

系统设置通过 `src/core/api.ts` 调用 gateway REST API。

必须显式传入 gateway base URL：

```ts
const base = `http://127.0.0.1:${status.port}`;
await fetchSettings(token, base);
```

不要在 renderer 中直接调用相对路径 `/api/...`，否则可能打到 WebUI/renderer origin，返回 HTML 而不是 JSON。

系统设置负责：

- provider 凭证 / OAuth
- 模型预设
- 联网搜索
- 图像生成
- 安全边界
- GUI 通用偏好
- gateway 运行信息

工具箱负责：

- Skills
- MCP
- 自定义工具 / server

不要把工具箱职责移回系统设置。

定时任务负责：

- 定时任务的存储、触发和运行历史由 nanobot cron 负责。
- GUI 只调用 `/api/schedule/*` 展示、编辑、暂停/恢复、删除和手动触发任务。
- 不要重新引入 GUI 本地 tick/scheduler。

## 状态管理

重要 store：

- `chatStore`：会话、消息、流式状态、侧栏同步数据
- `settingsStore`：GUI 设置、当前视图、从 gateway 镜像来的模型设置
- `workspaceStore`：工作区/项目状态
- `taskExecutionStore`：进行中的工具/任务步骤，用于 UI 渲染
- `permissionStore`：命令/路径权限 UI 状态
- `discoveryStore`：从 nanobot gateway 读取可用 skills，并发现本地专家入口
- `toastStore`：通知

## Electron IPC

`electron/main.ts` 仍然暴露一些兼容 IPC，用于文件系统、shell、通知、窗口控制，以及部分旧 LLM helper。新的聊天执行不应该使用旧的 `llm:chat` 路径，必须走 nanobot。

gateway 相关 IPC：

- `nanobot:status`
- `nanobot:sync-config`
- gateway 生命周期由 `pythonBridge` 处理

## 打包

`package.json` 的 build 配置会打入：

- `out/**/*`
- `package.json`
- `embedded-python/runtime/` -> `resources/python/`
- `../nanobot/` 运行时文件 -> `resources/nanobot-src/`

macOS 当前目标输出 `zip`。

Windows 默认输出 `nsis`，也可通过 `build:win:portable` 输出免安装版；GitHub Actions 原生生成最终 NSIS 安装包。

输出目录：

```text
dist/installers/
```

## 开发准则

新增执行能力时：

1. 优先在 nanobot 中实现。
2. 增加或调整 gateway REST / WebSocket payload。
3. 在 `src/core/types.ts` 增加 TypeScript payload 类型。
4. 在 `src/core/api.ts` 或 `src/core/nanobotClient.ts` 增加 client wrapper。
5. 在 React/Zustand 中渲染状态。

新增纯 UI 能力时：

1. 遵循 `src/components` 里的现有组件风格。
2. 使用简洁卡片、暖色中性色、紧凑的操作型布局。
3. 优先复用现有 `Input`、`Select`、`Toggle`、`Button`、`Textarea`。
4. 工具/MCP 放在工具箱，不放系统设置。
5. 定时任务不要再加 GUI 本地 tick，必须通过 nanobot cron API。

新增设置项时：

1. 先确认 nanobot 是否已经拥有该配置。
2. 增加 gateway API wrapper。
3. 显式传入 gateway base URL。
4. 如果本地 store 需要镜像，保存成功后调用 `syncGatewaySettingsToStore()`。

## 测试说明

运行全部测试：

```bash
npm run test
```

常用定向测试：

```bash
npm run test -- src/core/nanobotClient.test.ts
npm run test -- src/core/search/providers.test.ts
npm run test -- src/core/sandbox/config.test.ts
npm run test -- src/core/nanobotClient.test.ts
```

交付较大改动前运行构建：

```bash
npm run build
```

## 已知架构说明

- GUI 中仍有一些兼容模块和旧 IPC surface。除非明确清理，否则把它们视作兼容层。
- `settingsStore` 仍然镜像部分模型、搜索、沙箱值，用于 UI 兼容；运行时 source of truth 是 nanobot。
- 技能列表、启停、详情和工作区技能删除走 nanobot `/api/settings/skills`；不要恢复 GUI 本地 skill loader。
- 会话历史应该来自 gateway 同步，而不是只依赖本地乐观状态。

## 常见问题

- `Gateway returned WebUI HTML instead of JSON`：renderer API 请求很可能用了相对 `/api/...`，而不是显式 gateway base URL。
- `Python binary not found`：开发环境 nanobot virtualenv 缺失，或打包前没有准备 embedded Python。
- 端口 `8900` 被占用：`PythonBridge` 会尝试清理外部监听进程，但受保护进程可能需要手动停止。
- 打包应用启动后 gateway 失败：查看应用 userData 目录下的 `nanobot.log`。
