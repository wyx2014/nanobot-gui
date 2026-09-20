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

本地开发默认启用低功耗模式：状态图标保留静态画面，关闭持续动画、文字流光和毛玻璃效果。任务执行、流式回复、工具调用、文件预览及热更新保持可用。

需要在开发时检查完整视觉效果，可在 `.env.local` 中设置以下值，然后重启开发服务器：

```dotenv
VITE_DEV_LOW_POWER=0
```

删除该配置或设为 `1` 即恢复低功耗模式。普通构建和安装包自动保留完整效果，不受这个本地开关影响。

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

# Windows x64
npm run build:win

# Windows x64 免安装版
npm run build:win:portable

# Linux x64 主机本地构建 AppImage 和 DEB；macOS 请使用 GitHub Actions
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

Windows 安装包必须在 Windows x64 上原生构建：

- Windows x64 开发机可运行 `npm run build:win`，脚本会下载 Python 3.12.9 standalone，并安装 nanobot 及 Windows 依赖。
- 在 macOS 或 Linux 上运行 `npm run build:win` 会以 `target-host-required` 终止。
- 非 Windows 开发者应在 GitHub Actions 手动运行 `Build Windows Installer`，由 `windows-latest` 直接生成最终 NSIS 安装包。

Linux AppImage 和 DEB 必须在 Linux x64 文件系统上构建：

- 在 Linux x64 上运行：本机下载 Python 3.12.9 standalone，安装 nanobot 及 Linux 依赖，并生成 AppImage 和 DEB。
- 在 macOS 上运行 `npm run build:linux` 会直接终止，避免大小写不敏感的文件系统破坏 Linux runtime 的符号链接。
- macOS 开发者应在 GitHub Actions 手动运行 `Build Linux Packages`，由 Ubuntu 22.04 原生生成最终产物。

Windows workflow 会执行以下步骤：

1. 检出 GUI 与指定的 nanobot 分支、标签或提交。
2. 安装 Node 依赖并校验打包约束。
3. 在 Windows 上构建完整 Python runtime 和 NSIS 安装包，再验证内置 `python.exe` 与 nanobot 导入。
4. 生成 SHA-256，上传 Actions artifact，并发布到 `windows-installer-<version>` prerelease。

Linux workflow 会执行以下步骤：

1. 检出 GUI 与指定的 nanobot 分支、标签或提交。
2. 安装 Node 依赖并在 Ubuntu 上构建完整 Linux Python runtime。
3. 生成 AppImage 和 DEB，再分别解包验证 Python、nanobot 导入和符号链接。
4. 生成 SHA-256，上传 Actions artifact，并发布到 `linux-packages-<version>` prerelease。

GitHub 仓库需要配置以下 Actions Repository Secrets：

```text
JUYUAN_MCP_TOKEN
CAIHUI_MCP_API_KEY
IFIND_MCP_API_KEY
ANYSEARCH_API_KEY
```

四个密钥仅注入 Windows/Linux 的实际构建步骤。成功后可在 Actions artifact 或对应 prerelease 下载：

```text
TPCowork Setup <version>.exe
TPCowork Setup <version>.exe.sha256
TPCowork-<version>.AppImage
TPCowork-<version>.AppImage.sha256
tpcowork_<version>_amd64.deb
tpcowork_<version>_amd64.deb.sha256
```

Ubuntu 用户建议安装 DEB，它会通过系统包管理器注册应用菜单：

```bash
sudo apt install ./tpcowork_0.0.1_amd64.deb
```

AppImage 是免安装版。GitHub Actions Artifact 不保留 Unix 可执行权限，从 Artifact 或浏览器下载后需要重新授权再运行：

```bash
chmod +x TPCowork-0.0.1.AppImage
./TPCowork-0.0.1.AppImage
```

如果提示缺少 `libfuse.so.2`，Ubuntu 22.04 可安装 `libfuse2`，Ubuntu 24.04 可安装 `libfuse2t64`；DEB 安装不依赖 AppImage 的 FUSE 启动方式。

打包配置会把这些资源放入安装包：

- `out/**/*`
- `package.json`
- `embedded-python/runtime/` -> `resources/python/`
- `embedded-node/runtime/` -> `resources/node/`（Node 22 与 npm/npx）
- `../nanobot/` 会在 `prepare-python` 时安装并预编译进 `resources/python/`

用户机器是否需要环境：

- 不需要 Node。
- 正常打包成功后不需要系统 Python。
- 仍需要用户配置自己的模型 API Key 或 OAuth。

## 内网依赖包源

在“系统设置 → 依赖包源”中设置 npm 与 Python 索引，或使用“填入公司内网源”。
打包版首次迁移默认启用公司源，开发环境默认关闭；后续启动保留用户在 gateway 中保存的设置。

- npm：`http://10.94.211.66/repository/npm_mirror/`
- pip/uv：`http://10.94.211.66/repository/officialPypi/simple/`

这些配置由 nanobot 注入 Agent 命令、技能脚本和 MCP stdio 进程，覆盖 pip、npm/npx、uv/uvx 的默认索引。
配置仅用于任务进程，不修改用户全局 `.npmrc` 或 pip 配置；关闭后使用原有包源设置。
指定 HTTP Python 源时仅信任该主机；明确配置的仓库 IP 会通过现有网络白名单机制放行，域名规则仍然有效。

工作空间 Python 开关默认开启。首次执行命令时使用内置 Python 创建并复用工作空间 `.venv`，
继承内置包的读取能力，新增依赖安装到该虚拟环境。已有环境会保留；不完整环境会提示修复，不自动删除。
桌面任务中的 `python` / `python3` 与 `pip` / `pip3` 共用该解释器；关闭工作空间 Python 环境后，仍默认使用启动 gateway 的 Python（开发版为 nanobot venv，打包版为内置 Python）。
兼容入口仅位于软件自己的运行目录，不修改系统 PATH。MCP 的普通 Python 启动命令也会解析为内置解释器；显式指定的其他解释器路径仍会保留。
模型会收到实际解释器路径、包源与安装失败的处理说明。常见安装命令首次检查源的可达性，检查结果缓存一分钟。

“检查已保存配置”查询 `docx` / `python-docx` 示例包的元数据，不代表所有版本和平台的包均可下载。
显式指定的安装 URL、项目锁文件、scoped registry、浏览器等额外二进制下载仍需要相应内网资源。
保存后新命令使用新配置，已有 stdio MCP 会尝试重连；连接失败会提示到工具箱检查，需要重启时会单独说明。

打包命令会自动执行 `prepare-node`，从 Node 官方发行页下载指定平台的 Node/npm，并校验 SHA-256。
内网终端运行软件不需要再次下载 Node，也不需要额外安装 Python。

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

## MCP 服务管理

工具箱的 MCP 页面分为“我的服务”和“推荐服务”。“我的服务”保留连接失败和已停用的服务，支持编辑、启停、重新连接、查看工具范围和连接记录、确认删除。绿色状态来自 gateway 的实际连接结果；“测试连接”使用临时连接，不保存配置，也不会替换运行中的连接状态。

“添加 MCP”提供三个入口：

- **远程服务**：填写名称和 URL，选择无需认证、Bearer Token 或自定义请求头；默认使用 Streamable HTTP，可在高级设置中选择旧版 SSE。
- **本地程序**：填写启动程序，每个参数单独一行，环境变量使用键值行；高级设置可指定工作目录。电脑上需有对应的 `npx`、`uvx` 或可执行程序。
- **导入配置**：粘贴或选择 JSON 文件，先解析预览，再确认导入。支持常见 `mcpServers` 格式，遇到同名服务须明确选择替换、改标识或跳过；新增操作不会自动覆盖已有服务。

名称支持中文，内部标识自动生成。连接超时与工具超时均以秒为单位，默认分别为 15 秒、30 秒。已有环境变量和请求头的值不会回传到界面，编辑时留空保留、删除行移除。临时连接测试可取消；保存后连接失败会保留表单，允许修改重试。

导入支持 `disabled`、`connectTimeout`、`toolTimeout`、`enabledTools`、`cwd`，并将 Cursor 风格的 `${env:KEY}` 转为 nanobot 的 `${KEY}`。变量必须存在于 gateway 进程环境中；缺失时可先以 `disabled: true` 导入。OAuth、工作区路径占位符及未知字段会在预览中报出，不会静默丢弃。当前远程服务支持请求头认证，尚未实现 OAuth 浏览器登录。

桌面 MCP 配置操作通过现有已认证 WebSocket 发送结构化消息（单次配置上限 1 MiB），避免把完整配置放入 HTTP 请求头触发长度限制。配置保存和连接仍由 Python nanobot 负责，HTTP MCP 保留 SSRF 校验，内网地址需在安全设置中显式放行。开发环境需重启应用加载更新后的 gateway；安装包需重新准备内置 Python 并打包。

## 日志与归档

桌面诊断日志保存在 Electron `userData` 目录，诊断窗口中可以查看实际路径。当前日志始终使用固定文件名，历史归档与当前文件放在同一目录：

| 日志 | 内容 | 分卷阈值 | 历史归档容量 |
| --- | --- | --- | --- |
| `nanobot.log` | Python gateway 的 INFO、WARNING、ERROR 等运行日志 | 10 MiB | 200 MiB，gzip 压缩后计算 |
| `startup.log` | Electron 启动、gateway 生命周期、启动期间的进程输出 | 2 MiB | 20 MiB |

两类日志都在本地日期变化后的首次写入时归档，当天达到大小阈值也会提前分卷。归档文件名带日期、时间及冲突序号，例如 `nanobot.2026-09-06_10-30-00_123456.log.gz`、`startup.2026-09-06_10-30-00_123.log`。重启会识别已有日志的日期和大小，同一天的小文件继续追加。

历史归档最多保留 1 年（365 天）；达到容量限制时优先清理较旧归档，因此日志量大时实际保留时间可能更短。清理在启动及分卷时执行，也兼容旧的运行日志归档和 `startup.log.previous`。容量不包含当前文件；单条超大日志会完整写入，可能暂时超过分卷阈值。

Python 日志轮转由同级 `../nanobot/nanobot/utils/desktop_logging.py` 中的 Loguru 文件 sink 负责，启动日志由 `electron/startupLog.ts` 负责。开发环境重启 gateway 后生效；安装包需要重新执行打包流程，将更新后的 nanobot 安装进内置 Python。

### 结构化操作日志

`userData/desktop-events.jsonl` 持久化桌面启动、renderer 异常、HTTP/WS 连接与请求、IPC 和界面状态应用事件。按 5 MiB 分卷，最多 10 个历史分卷。诊断窗口的复制内容也包含该文件尾部、启动 ID 和写入健康计数。

Gateway 的操作事件写入工作区 `.nanobot/logs.sqlite`，`component` 以 `operations.` 开头，覆盖 HTTP、WS 请求接收、Turn、模型尝试和重试、Trace span、MCP 连接/初始化/发现/调用、PPT 渲染/校验/预览及产物发布登记。通过认证 `/api/diagnostics/logs?trace_id=...` 查询；响应中的 `collection` 提供队列深度、丢弃、写入失败及保留策略执行失败计数。操作行按 30 天、100,000 条和约 128 MiB 内容预算清理；每会话（无会话时按进程）再限制 5,000 条、约 8 MiB，错误和普通记录分别计算分区预算。每写入 1,000 条检查一次，可能短暂超过上限；内容预算不等于 SQLite/WAL 文件体积。不改变已有 Trace、安全审计和会话数据的保留策略。

`app_launch_id` 关联 Electron 和 gateway 进程；HTTP 的 `request_id`、聊天的 `client_action_id` 关联对应请求和权威 Turn/Trace。事件包含起止状态、耗时及失败阶段；流式正文、工具参数、认证凭证不进入新增事件。两端使用有界异步队列，满载优先预留终态记录空间，并报告丢弃数量。旧文本日志尚未整体迁移为此格式，后续外发诊断包仍需再次脱敏。

### 导出诊断包

在 **设置 → 帮助与反馈 → 导出诊断包** 或窗口 **帮助 → 导出诊断包** 中填写问题描述、发生时间，选择 15 分钟、1 小时或 24 小时的时间范围。「日志来源」默认选中当前聊天并显示名称，可搜索选择具体历史会话，也可选择「全部运行日志」；没有打开聊天时默认选全部。原「意见反馈」入口已移除。

选择具体会话时，只收集能通过会话、聊天或其 Trace 身份关联的日志及任务状态，并保留软件环境检查；无法归属会话的公共事件、启动和后端旧文本日志仅在「全部运行日志」中收集。尚未同步到后端的新聊天仍可导出其界面日志，并明确标记后端信息不可用。切换选择不会改变当前聊天，导出时按所选会话重新采集界面状态；会话名称仅用于本地选择，不写入诊断包。

导出在独立 worker 中收集、清洗并生成本地 ZIP，保存成功后显示问题编号、大小、缺失/截断来源和打开文件夹按钮。原生 **帮助 → 导出诊断包** 同样优先打开这个弹窗；界面无法响应时，自动使用原生保存窗口导出最近 15 分钟的可用应用诊断，gateway 离线也可导出桌面日志。原生菜单也可取消导出。所有导出均不调用模型，不自动上传。

ZIP 含 `issue.json`、环境摘要、桌面和 gateway 事件、Trace/Run/Span、安全事件、导出时运行状态、事件时间线、`summary.md`、AI 分析说明、脱敏统计和带 SHA-256 的文件清单。旧文本日志只投影时间、级别、异常类型、错误代码和匿名化栈位置，正文不进入包内；原始数据库、配置、对话和文稿附件也不导出。

错误采集最多提取 5 层原因链和 12 个结构化堆栈帧，保留模块、函数及行列号，区分 DNS、TLS、代理、超时、认证、资源缺失等技术原因，不保存异常正文。失败事件自动附带当时的技术快照和最近关联事件 ID，持久化在原有操作日志中；导出汇总为 `snapshots/incidents.json`。renderer 每 10 秒记录有限的界面上下文，主进程遇到窗口无响应或 gateway 退出时可引用最近上下文，`context_captured_at` 标明其实际时间。仅包含新采集器观察到的失败；突然断电、进程强杀及日志丢弃仍可能没有现场。`snapshots/export.json` 始终是导出时状态。

导出前，renderer 发送全部待发批次并请求主进程确认；主进程和 gateway 分别等待已接收日志处理到固定序号，最多等待 1 秒。清单中的 `*_flush` 报告完成、超时、丢失或写入失败，旧 gateway 的刷新能力会标为不可用。刷新完成表示写入调用已完成，不承诺物理磁盘同步。导出自身的成功、失败、取消和超时也记录终态。

`doctor.json` 在 gateway 可用时检查 Python/包版本、运行状态、日志目录空间和权限提示、模板资源、代理及证书覆盖配置。最多等待 2 秒，不生成 PPT 预览，不调用模型、探测远端或验证凭证；不收集代理地址、用户名、密码或证书路径。`analysis/evidence.json` 按显式操作 ID 还原起止、父操作关系与 Span 链接，给出失败索引、耗时排行和证据行号；缺少终态不等于失败。摘要最多保留 1,000 个操作、100 个失败、100 份现场和 3,000 个 Span，超限显式标记，原始事件仍按各自预算导出。PPT 窗口记录模板提交到界面的时间、目录、历史文稿和预览请求耗时，首帧指标不代表图片已全部解码。

Electron 构建会生成唯一构建 ID、Git revision 和工作区是否有未提交修改的标记，并产生 hidden source maps。诊断包仅包含构建身份；开发端应保留对应构建产物与 source maps 用于源码定位。

Gateway 的认证 `/api/diagnostics/export` 在一个只读 SQLite 事务中查询，包含 WAL 数据并记录截止水位。每次最多导出 5,000 条日志、1,000 条安全事件、100 个 Trace、500 个 Run 和 3,000 个 Span，gateway 原始投影上限 8 MiB。桌面文件仅从已知日志目录读取，拒绝符号链接；每文件最多读取 2 MiB，每类日志最多读取 8 MiB，兼容 gzip 归档。ZIP 和压缩前内容上限均为 32 MiB，超出来源预算会标记截断；gateway 收集限时 10 秒，整体后台任务限时 35 秒。取消或失败清理临时文件，最终保存前不替换用户已有文件。

将 ZIP 和问题编号发给技术支持，即可按包内说明交给 AI 分析，并在开发端关联修复提交、回归用例和复测结果。附件选择、远程上传和自动修复案例管理仍属后续范围，见 [日志与问题诊断闭环设计](docs/diagnostics-system-design.md)。

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
