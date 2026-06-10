# TaiziRuyi (太资如意) - AI 桌面办公助手

## Project Overview

TaiziRuyi 是一个本地运行的 AI 桌面办公助手，灵感来自 Claude Code 的 Cowork 模式。用户通过自然语言对话指挥 AI 完成读文件、跑命令、写文档、做报表等任务。

- **当前版本**: v0.5.9
- **品牌名称**: 太资如意
- **产品标识**: com.taiziruyi.app
- **支持平台**: macOS (dmg), Windows (nsis)

## Tech Stack

### 核心技术
- **Frontend**: React 19.2 + TypeScript 5.9 + Vite 7.3
- **Desktop**: Electron 34.0 (TypeScript)
- **Styling**: Tailwind CSS 4.2 + Radix UI + shadcn/ui
- **State Management**: Zustand 5.0
- **AI SDK**: Anthropic SDK 0.78 (@anthropic-ai/sdk)
- **MCP**: Model Context Protocol SDK 1.27 (@modelcontextprotocol/sdk)
- **Testing**: Vitest 4.0 + Happy DOM

### 关键依赖
- **文档处理**: docx-preview, react-pdf, xlsx, yaml
- **Web 内容提取**: @mozilla/readability, turndown
- **Markdown**: react-markdown, remark-gfm, remark-breaks
- **代码高亮**: react-syntax-highlighter
- **工具库**: immer, zod, clsx, class-variance-authority
- **图标**: lucide-react

## Key Commands

```bash
# 开发模式
npm run dev              # 前端开发服务器 (http://localhost:5173)
npm run electron:dev     # 启动 Electron 桌面应用

# 构建
npm run build            # 构建前端 (tsc + vite build)
npm run electron:build   # 构建 Electron 桌面应用

# 测试
npm run test             # 运行测试
npm run test:watch       # 监听模式
npm run test:coverage    # 覆盖率报告

# 代码质量
npm run lint             # ESLint 检查
npm run preview          # 预览构建产物
```

## Project Structure

```
src/
├── main.tsx             # 入口文件
├── App.tsx              # 主应用组件
├── components/          # React 组件
│   ├── chat/           # 聊天相关组件 (ChatView, MessageList, InputArea 等)
│   ├── common/         # 通用组件 (Button, Dialog, Tooltip 等)
│   ├── customize/      # 自定义面板 (Agents/Skills/MCP 管理)
│   ├── panel/          # 右侧面板 (文件预览、任务进度、便签等)
│   ├── preview/        # 文件预览组件 (PDF, DOCX, Excel, 图片等)
│   ├── schedule/       # 定时任务组件
│   ├── settings/       # 设置面板 (API、模型、权限、外观等)
│   ├── sidebar/        # 侧边栏 (会话列表、工作区切换)
│   └── ui/             # UI 基础组件 (shadcn/ui)
├── core/               # 核心逻辑
│   ├── agent/          # Agent 核心
│   │   ├── agentLoop.ts        # Agent 主循环
│   │   ├── orchestrator.ts     # 任务编排
│   │   ├── registry.ts         # Agent 注册
│   │   └── ...                 # 其他 Agent 相关逻辑
│   ├── context/        # 上下文管理 (会话上下文、工作区上下文)
│   ├── llm/            # LLM 调用 (Anthropic API 封装)
│   ├── mcp/            # MCP 协议实现
│   ├── sandbox/        # 沙箱执行环境
│   ├── scheduler/      # 定时任务调度器
│   ├── search/         # 搜索功能
│   ├── session/        # 会话管理
│   ├── skill/          # 技能系统
│   ├── tools/          # 工具注册与实现
│   │   ├── builtins.ts         # 内置工具定义
│   │   ├── registry.ts         # 工具注册表
│   │   ├── commandSafety.ts    # 命令安全检查
│   │   ├── pathSafety.ts       # 路径安全检查
│   │   └── ...
│   ├── updates/        # 应用更新检查
│   └── capabilities.ts # 能力定义
├── stores/             # Zustand 状态管理
│   ├── chatStore.ts            # 聊天状态 (消息、会话)
│   ├── settingsStore.ts        # 设置状态 (API、模型、权限)
│   ├── workspaceStore.ts       # 工作区状态
│   ├── mcpStore.ts             # MCP 服务器状态
│   ├── scheduleStore.ts        # 定时任务状态
│   ├── taskExecutionStore.ts   # 任务执行状态
│   ├── taskProgressStore.ts    # 任务进度状态
│   ├── scratchpadStore.ts      # 便签状态
│   ├── previewStore.ts         # 预览状态
│   ├── permissionStore.ts      # 权限状态
│   ├── customizeStore.ts       # 自定义状态
│   ├── discoveryStore.ts       # 发现状态
│   └── toastStore.ts           # Toast 通知状态
├── hooks/              # React Hooks
│   ├── useAutoScroll.ts        # 自动滚动
│   ├── useFileDragDrop.ts      # 文件拖拽
│   └── useItemName.ts          # 项目名称
├── i18n/               # 国际化 (中文/英文)
├── utils/              # 工具函数
└── types/              # TypeScript 类型定义

electron/               # Electron 主进程
├── main.ts             # 主进程入口
├── preload.ts          # 预加载脚本
└── ...

builtin-skills/         # 内置技能
├── schedule/           # 定时任务技能
├── weekly-report/      # 周报生成技能
├── theme-factory/      # 主题工厂技能
├── doc-coauthoring/    # 文档协作技能
├── translate/          # 翻译技能
└── ...

builtin-agents/         # 内置 Agent (待实现)

docs/                   # 文档
website/                # 官网
```

## Architecture

### Agent 核心流程

1. **agentLoop** (`src/core/agent/agentLoop.ts`)
   - Agent 主循环，负责消息处理和工具调用
   - 处理用户输入、LLM 响应、工具执行结果
   - 管理对话上下文和状态

2. **orchestrator** (`src/core/agent/orchestrator.ts`)
   - 任务编排器，协调多个工具和子任务
   - 决策工具调用顺序和并行执行策略
   - 处理工具调用失败和重试逻辑

3. **registry** (`src/core/agent/registry.ts`)
   - Agent 注册表，管理可用的 Agent
   - 支持内置 Agent 和用户自定义 Agent
   - 提供 Agent 发现和加载机制

### 工具系统

- **工具定义**: `src/core/tools/builtins.ts` 定义所有内置工具
- **工具注册**: `src/core/tools/registry.ts` 管理工具注册表
- **安全检查**:
  - `commandSafety.ts` - 命令执行安全检查
  - `pathSafety.ts` - 文件路径安全检查
- **MCP 工具**: 通过 `@modelcontextprotocol/sdk` 连接外部 MCP 服务器
- **支持的工具类型**:
  - 文件操作 (读、写、编辑、删除)
  - 命令执行 (Bash、Shell)
  - 代码审查 (Lint、Format)
  - Web 搜索和抓取
  - 文档生成 (Markdown、PDF、DOCX)
  - 数据处理 (Excel、CSV、JSON)

### 状态管理

使用 Zustand 管理全局状态，主要 stores:

- **chatStore**: 聊天消息、会话列表、当前会话
- **settingsStore**: API 配置、模型选择、权限设置、外观主题
- **workspaceStore**: 工作区路径、项目信息
- **mcpStore**: MCP 服务器连接状态
- **scheduleStore**: 定时任务列表和执行状态
- **taskExecutionStore**: 任务执行队列和结果
- **taskProgressStore**: 任务进度追踪
- **scratchpadStore**: 便签内容
- **permissionStore**: 工具权限管理

### 技能系统

- **技能定义**: 每个技能包含 `SKILL.md` 描述文件
- **内置技能**:
  - `schedule` - 定时任务管理
  - `weekly-report` - 周报生成
  - `theme-factory` - 主题定制
  - `doc-coauthoring` - 文档协作
  - `translate` - 翻译助手
- **技能加载**: 从 `builtin-skills/` 目录动态加载
- **技能执行**: 通过 Agent 调用技能提示词

### MCP 协议

- **协议版本**: Model Context Protocol 1.27
- **通信方式**: stdio 传输
- **服务器管理**: `mcpStore` 管理连接状态
- **工具集成**: MCP 工具自动注册到工具注册表

### 沙箱执行

- **隔离环境**: 命令在受控环境中执行
- **安全检查**:
  - 危险命令拦截 (rm -rf, sudo 等)
  - 路径遍历防护
  - 权限验证
- **执行监控**: 实时输出、超时控制、错误处理

### 定时任务

- **调度器**: `src/core/scheduler/` 实现 cron 风格调度
- **任务类型**:
  - 一次性任务
  - 周期性任务 (每天、每周、每月)
- **任务管理**: 创建、暂停、恢复、删除
- **执行历史**: 记录任务执行结果和日志

## Conventions

### 代码风格

#### 组件命名
- 组件文件: PascalCase (如 `ChatView.tsx`)
- 组件目录: 组件名作为目录名 (如 `chat/ChatView.tsx`)
- Hooks: camelCase with `use` prefix (如 `useAutoScroll.ts`)
- Stores: camelCase with `Store` suffix (如 `chatStore.ts`)

#### 文件组织
- 每个组件一个文件
- 相关组件放在同一目录下
- 测试文件与源文件同目录 (如 `chatStore.test.ts`)
- 类型定义优先使用 `types/` 目录

### 样式规范

- **CSS 框架**: Tailwind CSS 4.2
- **组件库**: Radix UI + shadcn/ui
- **样式工具**:
  - `cn()` 函数 (tailwind-merge + clsx) 用于条件样式
  - `cva()` (class-variance-authority) 用于变体样式
- **主题**: 支持亮色/暗色主题，使用 CSS 变量
- **响应式**: 移动优先，使用 Tailwind 断点

### TypeScript 规范

- **严格模式**: 启用所有严格类型检查
- **类型定义**:
  - 优先使用 `interface` 定义对象类型
  - 使用 `type` 定义联合类型和工具类型
  - 避免使用 `any`，使用 `unknown` 代替
- **运行时验证**: 使用 Zod 进行数据验证
- **类型导出**: 从 `types/` 目录统一导出

### 测试规范

- **测试框架**: Vitest + Happy DOM
- **测试覆盖**:
  - 核心逻辑必须有单元测试
  - Store 必须有测试覆盖
  - 工具函数必须有测试
- **测试文件**: 与源文件同目录，`.test.ts` 后缀
- **测试命名**: `describe` + `it` 风格，描述清晰

### Git 规范

- **分支策略**:
  - `main` - 主分支，稳定版本
  - `dev` - 开发分支
  - `feature/*` - 功能分支
  - `fix/*` - 修复分支
- **提交信息**:
  - 格式: `<type>: <description>`
  - 类型: feat, fix, docs, style, refactor, test, chore
  - 示例: `feat: add weekly report skill`

## Development Guidelines

### 添加新功能

1. **规划**: 在 `docs/` 中创建设计文档
2. **类型定义**: 在 `types/` 中定义相关类型
3. **核心逻辑**: 在 `core/` 中实现核心功能
4. **状态管理**: 在 `stores/` 中添加状态管理
5. **UI 组件**: 在 `components/` 中实现界面
6. **测试**: 编写单元测试和集成测试
7. **文档**: 更新 README 和相关文档

### 添加新工具

1. 在 `src/core/tools/builtins.ts` 中定义工具
2. 实现工具执行逻辑
3. 添加安全检查 (如需要)
4. 在 `registry.ts` 中注册工具
5. 编写工具测试
6. 更新工具文档

### 添加新技能

1. 在 `builtin-skills/` 创建技能目录
2. 编写 `SKILL.md` 描述文件
3. 定义技能提示词和参数
4. 实现技能逻辑 (如需要)
5. 测试技能执行
6. 更新技能列表

### 添加新 Agent

1. 在 `builtin-agents/` 创建 Agent 目录
2. 编写 Agent 配置文件
3. 定义 Agent 能力和工具
4. 实现 Agent 逻辑
5. 在 `registry.ts` 中注册 Agent
6. 测试 Agent 执行

### 性能优化

- **React 优化**:
  - 使用 `React.memo` 避免不必要的重渲染
  - 使用 `useMemo` 和 `useCallback` 缓存计算结果
  - 虚拟滚动处理长列表
- **状态优化**:
  - Zustand 使用 selector 避免过度订阅
  - 使用 immer 简化不可变更新
- **打包优化**:
  - 代码分割和懒加载
  - Tree shaking 移除未使用代码
  - 压缩和混淆

### 安全最佳实践

- **命令执行**:
  - 始终使用 `commandSafety.ts` 检查
  - 避免直接执行用户输入
  - 使用白名单而非黑名单
- **文件操作**:
  - 使用 `pathSafety.ts` 验证路径
  - 防止路径遍历攻击
  - 限制文件大小和类型
- **API 调用**:
  - 不在前端存储敏感信息
  - 使用环境变量管理 API Key
  - 实现请求限流和重试

## Important Notes

### 环境要求
- **Node.js**: 20.19+ 或 22.12+
- **操作系统**: macOS 10.15+, Windows 10+

### 开发注意事项
- MCP 工具在运行时通过 stdio 传输连接
- 内置 Skills 和 Agents 打包在 resources 中
- Electron 窗口使用 Overlay 标题栏样式
- 默认窗口大小: 1200x800，最小: 900x600
- CSP 策略: 允许 https/http 连接，内联样式

### 构建配置
- **前端构建**: Vite 构建到 `dist/` 目录
- **桌面构建**:
  - macOS: DMG 安装包
  - Windows: NSIS 安装程序 (当前用户安装)
- **资源打包**: builtin-skills 和 builtin-agents 自动打包
- **图标**: 支持多尺寸 PNG、ICNS (macOS)、ICO (Windows)

### 调试技巧

- 使用 `npm run dev` 启动前端开发服务器
- 使用 `npm run electron:dev` 启动桌面应用调试
- 浏览器开发者工具可在 Electron 窗口中使用

### 常见问题

- **端口占用**: 确保 5173 端口未被占用
- **依赖安装失败**: 清除 node_modules 和 package-lock.json 重新安装

## Resources

- **官方文档**: `docs/`
- **官网**: `website/`
- **GitHub**: (待添加)
- **问题反馈**: (待添加)
- **更新日志**: `CHANGELOG.md`

## License

(待添加)
