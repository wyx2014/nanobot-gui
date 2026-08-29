<div align="center">

# TPCowork (TPCowork)

**本地运行的 AI 桌面办公助手**

TPCowork 是一个 Electron 桌面客户端，负责对话界面、设置、工具箱、文件预览和本地状态管理；真正的 Agent 循环、模型调用、记忆、工具执行、MCP、会话持久化由内置的 Python `nanobot` gateway 承接。

</div>

---

## 当前架构

```text
Electron Main Process
  ├─ 创建桌面窗口
  ├─ 托管本地文件/系统 IPC
  └─ PythonBridge 启动 nanobot gateway
        ├─ 开发环境: ../nanobot/venv/bin/python3
        └─ 打包环境: resources/python/bin/python3

Renderer (React)
  ├─ Chat / Sidebar / Schedule / Toolbox / Settings / Preview
  ├─ Zustand stores 管理 GUI 状态
  ├─ WebSocket 连接 nanobot gateway
  └─ REST API 读取/更新 gateway 设置

nanobot gateway (Python)
  ├─ Agent loop
  ├─ LLM provider / model routing
  ├─ Memory / session persistence
  ├─ Tool execution
  ├─ MCP / app catalog
  └─ Safety / sandbox policy
```

重点边界：

- GUI 不再维护独立的本地 Agent loop。
- GUI 不再维护独立的 LLM adapter、memory engine、tool registry。
- GUI 的职责是桌面体验、状态展示、用户输入、设置管理和与 gateway 的协议适配。
- nanobot 是执行侧的 source of truth。

## 核心特性

- **对话式任务执行**：用户在 GUI 输入需求，消息通过 WebSocket 交给 nanobot 执行。
- **工具调用可视化**：gateway 返回 tool progress、reasoning、file edit 等事件，GUI 渲染为消息气泡和任务进度。
- **会话同步**：启动后从 gateway 同步历史会话和 WebUI thread 快照，保证重启后能看到用户提问和模型回复。
- **设置同步**：设置页通过 gateway REST API 管理模型服务、模型预设、联网搜索、图像生成和安全边界。
- **定时任务**：定时任务由 nanobot CronService 存储和触发，GUI 只负责展示、编辑和手动触发。
- **工具箱**：Skills 和 MCP 管理放在工具箱，不放在系统设置。
- **本地优先**：桌面端启动本机 gateway，配置和工作区位于用户本地目录。
- **可打包运行**：安装包内置 Python runtime 和 nanobot 源码，用户机器不需要安装 Node，理论上也不需要安装 Python。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面 | Electron 34 + electron-vite + electron-builder |
| 前端 | React 19 + TypeScript 5.9 + Vite + Tailwind CSS v4 |
| 状态 | Zustand + Immer |
| 图标/UI | lucide-react + Radix/shadcn 风格基础组件 |
| 后端执行 | Python nanobot gateway |
| 通信 | WebSocket 多路复用 + REST API |
| 测试 | Vitest + happy-dom |
| 打包 | electron-builder + python-build-standalone |

## 快速开始

### 前置要求

- Node.js 20+
- npm
- 同级目录存在 `../nanobot`
- 开发环境需要准备 nanobot Python 虚拟环境：

```bash
cd ../nanobot
python3 -m venv venv
venv/bin/pip install -e ".[desktop]"
```

### 安装依赖

```bash
npm install
```

### 启动桌面开发环境

```bash
npm run electron:dev
```

仅启动 renderer 开发服务器：

```bash
npm run dev
```

## 构建与打包

普通构建：

```bash
npm run build
npm run electron:build
```

生成安装包：

```bash
# macOS
npm run build:mac

# Windows
npm run build:win

# Windows 免安装版
npm run build:win:portable

# Linux x64 主机本地构建；macOS 请使用 GitHub Actions
npm run build:linux
```

产物目录：

```text
dist/installers/
```

Python runtime 固定为 Python 3.12.9。打包脚本会执行：

1. 按目标平台准备 `embedded-python/runtime/`
2. 将 `../nanobot[desktop]` 安装进目标 Python runtime
3. `electron-vite build`
4. `electron-builder`

Windows 打包分为两种模式：

- 在 Windows x64 上运行：本机下载 Python 3.12.9 standalone，并安装 nanobot 及 Windows 依赖。
- 在 macOS 上运行：从 GitHub Release 下载 Windows CI 预制的完整 `win32-x64` runtime，校验 SHA-256、目标平台、Python 版本、依赖摘要和 nanobot 源码摘要后只负责组装。任何一项不匹配都会终止打包，不会回退使用 Mac Python。

Linux AppImage 必须在 Linux x64 文件系统上构建：

- 在 Linux x64 上运行：本机下载 Python 3.12.9 standalone，并安装 nanobot 及 Linux 依赖。
- 在 macOS 上运行 `npm run build:linux` 会直接终止，避免大小写不敏感的文件系统破坏 Linux runtime 的符号链接。
- macOS 开发者应在 GitHub Actions 手动运行 `Build Linux AppImage`，由 Ubuntu 22.04 原生生成最终产物。

首次从 Mac 打 Windows 包前，在 GitHub Actions 手动运行 `Build Windows Python runtime`，并填写要嵌入的 nanobot 分支、标签或提交。工作流会发布一个不参与应用自动更新的 prerelease，并写入以下稳定资产：

```text
tpcowork-python-3.12.9-win32-x64-desktop-v2-bytecode.zip
tpcowork-python-3.12.9-win32-x64-desktop-v2-bytecode.zip.sha256
tpcowork-python-3.12.9-win32-x64-desktop-v2-bytecode.zip.json
```

默认从 `wyx2014/nanobot-gui` Release 下载；仓库或下载地址不同时可覆盖：

```bash
TPCOWORK_RUNTIME_REPOSITORY=owner/repository npm run build:win

# 私有/镜像资产也可以直接指定
TPCOWORK_WINDOWS_RUNTIME_URL=https://example.com/runtime.zip \
TPCOWORK_WINDOWS_RUNTIME_SHA256_URL=https://example.com/runtime.zip.sha256 \
TPCOWORK_RUNTIME_TOKEN=token \
npm run build:win
```

Linux workflow 会执行以下步骤：

1. 检出 GUI 与指定的 nanobot 分支、标签或提交。
2. 安装 Node 依赖并在 Ubuntu 上构建完整 Linux Python runtime。
3. 生成 AppImage，再解包验证 Python、nanobot 导入和符号链接。
4. 生成 SHA-256，上传 Actions artifact，并发布到 `linux-appimage-<version>` prerelease。

GitHub 仓库需要配置以下 Actions Repository Secrets：

```text
JUYUAN_MCP_TOKEN
CAIHUI_MCP_API_KEY
IFIND_MCP_API_KEY
ANYSEARCH_API_KEY
```

成功后可在 Actions artifact 或对应 prerelease 下载：

```text
TPCowork-<version>.AppImage
TPCowork-<version>.AppImage.sha256
```

打包配置会把这些资源放入安装包：

- `out/**/*`
- `package.json`
- `embedded-python/runtime/` -> `resources/python/`
- `../nanobot/` 会在 `prepare-python` 时安装并预编译进 `resources/python/`

用户机器是否需要环境：

- 不需要 Node。
- 正常打包成功后不需要系统 Python。
- 仍需要用户配置自己的模型 API Key 或 OAuth。

## 常用命令

```bash
npm run electron:dev      # 启动 Electron 开发环境
npm run dev               # 仅启动 Vite renderer
npm run build             # TypeScript + Vite 构建
npm run electron:build    # Electron main/preload/renderer 构建
npm run build:mac         # 打 macOS 包
npm run build:win         # 打 Windows 包
npm run build:linux       # 打 Linux AppImage
npm run test              # 跑测试
npm run test:watch        # 测试监听
npm run test:coverage     # 覆盖率
npm run lint              # ESLint
```

## 目录结构

```text
electron/
  main.ts                 # Electron 主进程入口、窗口、IPC
  preload.ts              # renderer 安全桥
  pythonBridge.ts         # 启停内置 nanobot gateway
  nanobotConfig.ts        # GUI 设置写入 gateway 配置

src/
  App.tsx                 # 应用入口，启动 gateway bootstrap 和同步流程
  components/
    chat/                 # 对话 UI、消息、工具调用渲染
    sidebar/              # 会话/工作区侧栏
    settings/             # 系统设置和工具箱视图容器
    customize/            # Skills / MCP 工具箱内容
    schedule/             # 定时任务 UI
    panel/                # 右侧面板
    preview/              # PDF/DOCX/XLSX/CSV 预览
    ui/                   # 基础 UI 组件
  core/
    nanobotClient.ts      # bootstrap、WebSocket client、会话/设置同步
    nanobot/              # GUI 到 nanobot 的聊天桥和事件适配
    api.ts                # gateway REST API 封装
    bootstrap.ts          # gateway bootstrap 请求和 WS URL 派生
    types.ts              # gateway payload 类型
    mcp/                  # GUI 侧 MCP 连接状态/辅助能力
    safety/               # GUI 侧路径/命令展示安全辅助
    runtime/              # 行为传感、computer use 权限辅助
    context/              # UI/本地上下文工具
  stores/                 # Zustand stores
  i18n/                   # 中文/英文文案
  utils/                  # 文件、平台、通知等工具

builtin-agents/           # 预留 Agent 定义目录
embedded-python/          # 打包时下载的 Python runtime
dist/installers/          # electron-builder 输出
```

## 运行时流程

1. Electron main 创建窗口。
2. `PythonBridge` 在 8900 端口启动 `python -m nanobot desktop-gateway`，gateway 内部启动 `CronService`。
3. Renderer 调用 `syncNanobotSettings()` 写入/同步配置。
4. Renderer 调用 `bootstrapNanobotGateway()` 获取 token 和 WebSocket 地址。
5. Renderer 调用：
   - `syncGatewaySettingsToStore()`
   - `syncSessionsFromGateway()`
6. 用户发送消息时，`sendNanobotMessage()`：
   - 先把用户消息写入 GUI store
   - 通过 `NanobotClient.sendMessage()` 发给 gateway
   - 监听 `delta`、`reasoning_delta`、`message/tool_hint`、`file_edit`、`turn_end`
   - 将事件映射为 GUI 消息、工具调用卡片和任务快照

## 设置与工具箱分工

系统设置：

- 模型服务 Provider / API Key / OAuth
- 模型预设
- 联网搜索
- 图像生成
- 安全边界
- 通用偏好
- gateway 运行信息

工具箱：

- Skills
- MCP
- 自定义工具相关管理

## 开发原则

- 新的执行能力优先放到 nanobot gateway。
- GUI 只做展示、输入、配置和协议适配。
- 不要重新引入 GUI 本地 Agent loop、LLM adapter、memory engine、tool registry。
- 不要重新引入 GUI 本地定时任务 tick；定时任务必须走 nanobot cron。
- 所有 gateway REST 请求必须显式使用 `http://127.0.0.1:<gateway_port>`，不要用相对 `/api/...`。
- 不要把工具/MCP 管理塞回设置页，应该放工具箱。

## 测试

```bash
npm run test
TPCOWORK_RUNTIME_TOKEN=YOUR_GITHUB_TOKEN npm run build:win
```

重点测试：

- `src/core/nanobotClient.test.ts`
- `src/core/search/providers.test.ts`
- `src/core/sandbox/config.test.ts`
- `src/core/context/*.test.ts`
