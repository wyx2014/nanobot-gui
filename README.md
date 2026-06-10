<div align="center">

# TaiziRuyi (太资如意)

**你的 AI 桌面办公搭子 — 交给太资如意就行啦**

本地运行的 AI 桌面办公助手，灵感来自 Claude Code 的 Cowork 模式。
你说需求，太资如意干活 — 读文件、跑命令、写文档、做报表，全在本地完成。

</div>

---

## 产品预览

> 简洁直观的界面，强大灵活的能力

### 对话式交互
用自然语言告诉太资如意你想做什么，对话即指令。

<img src="website/assets/screenshot-home.png" width="800" />

### 任务执行
智能调用工具，自动完成文件整理等复杂任务。

<img src="website/assets/screenshot-task.png" width="800" />

### 工具箱
丰富的 Skills、Agents 和 MCP 工具，按需安装扩展能力。

<img src="website/assets/screenshot-toolbox.png" width="800" />

### 定时任务
设定定时计划，让太资如意每天自动为你工作。

<img src="website/assets/screenshot-schedule.png" width="800" />

### 自定义模型
支持自定义 API 和模型，灵活接入各类 LLM 服务。

<img src="website/assets/screenshot-model.png" width="800" />

## 核心特性

- **Agent 自主执行** — 不只是聊天，能自主规划、调用工具、读写文件、执行命令，完成复杂任务
- **Skill 技能系统** — 内置翻译、周报、代码审查、深度研究、文章写作等技能，一键安装，支持自定义
- **MCP 工具协议** — 通过 Model Context Protocol 连接数据库、搜索引擎、GitHub 等外部服务
- **定时任务** — 设定定时计划，让太资如意定期执行任务（如每天早上发送 AI 日报）
- **多模型支持** — 支持 Anthropic Claude、DeepSeek、通义千问、豆包、Moonshot、智谱等主流模型
- **沙箱安全** — macOS Seatbelt 沙箱隔离 + 敏感路径保护 + 命令安全检查
- **本地优先** — 数据存在本地，API Key 存在本地，不经过第三方服务器
- **跨平台** — 支持 macOS (Apple Silicon / Intel) 和 Windows

## 快速开始

1. 下载安装并打开 TaiziRuyi
2. 点击左下角设置图标，进入「自定义模型」
3. 选择 API 厂商，填入 API Key
4. 回到主界面，开始对话

**试试这些指令：**

```
帮我整理下桌面的文件，按类型分类放好
```
```
把这个 PDF 里的表格提取出来，生成 Excel
```
```
每天早上 9 点帮我搜索最新的 AI 新闻，生成日报
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 34.0 (TypeScript + Web) |
| 前端 | React 19 + TypeScript + TailwindCSS v4 + Vite |
| LLM | 多模型适配 (Anthropic / OpenAI-compatible) |
| 状态管理 | Zustand + Immer |
| 工具协议 | MCP (`@modelcontextprotocol/sdk`) |
| 安全沙箱 | macOS Seatbelt + 路径/命令双重校验 |
| UI | Radix UI + Lucide Icons |
| 测试 | Vitest + happy-dom |

## 从源码构建

### 前置要求

- Node.js >= 20
- 操作系统依赖 (Git 等)

### 开发

```bash

# 安装依赖
npm install

# 启动桌面应用（推荐）
npm run electron:dev

# 仅启动前端（开发服务器）
npm run dev
```

### 构建

```bash
npm run electron:build
```

构建产物位于 `dist/installers/` 或 `out/`。

### 测试

```bash
npm test              # 运行测试
npm run test:watch    # 监听模式
npm run test:coverage # 覆盖率报告
npm run lint          # ESLint 检查
```

## 项目结构

```
src/
├── components/       # React UI 组件
│   ├── chat/         # 对话界面、消息气泡、Markdown 渲染
│   ├── sidebar/      # 侧边栏导航
│   ├── panel/        # 右侧详情面板
│   ├── schedule/     # 定时任务视图
│   ├── settings/     # 系统设置
│   └── ui/           # 基础 UI 组件 (shadcn/Radix)
├── core/             # 核心引擎（非 UI）
│   ├── agent/        # Agent 循环、重试、记忆
│   ├── llm/          # LLM 适配层 (Claude + OpenAI-compatible)
│   ├── tools/        # 工具注册、内置工具、安全校验
│   ├── mcp/          # MCP 客户端
│   ├── skill/        # Skill 加载与预处理
│   ├── scheduler/    # 定时调度引擎
│   ├── context/      # 上下文管理与 Token 估算
│   └── sandbox/      # 沙箱配置
├── stores/           # Zustand 状态管理
├── hooks/            # React Hooks
├── i18n/             # 国际化 (中文 / English)
├── types/            # TypeScript 类型定义
└── utils/            # 工具函数

builtin-skills/       # 内置技能定义 (翻译、周报、代码审查等)
builtin-agents/       # 内置 Agent 定义
electron/             # Electron 主进程代码
ruyi-browser-bridge/   # 浏览器桥接服务
ruyi-chrome-extension/ # Chrome 扩展
```

## 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建你的分支：`git checkout -b feat/my-feature`
3. 提交改动：`git commit -m 'feat: add my feature'`
4. 推送分支：`git push origin feat/my-feature`
5. 发起 Pull Request

## 反馈与交流

使用中遇到问题或有好的想法，欢迎扫码加微信交流：

<img src="src/assets/wechat-qr.png" width="200" />

## 赞赏支持

如果太资如意对你有帮助，欢迎请作者喝杯咖啡：

<img src="src/assets/sponsor-qr.png" width="200" />

