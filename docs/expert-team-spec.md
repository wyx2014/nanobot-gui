# 专家团队 Spec

## 1. 概述

专家团队是工具箱中的一种复合 Agent 能力。一个专家团队由团队元数据、原始工作流、角色分工、运行策略和展示资源组成。

第一版内置团队为：

- ID：`asset-research-team`
- 名称：资产投研团队
- 上游来源：`/Users/wyx/project/nanobot-pc/ai-berkshire`
- 核心入口：`skills/investment-team.md`
- 核心成员：Team Lead、商业分析师、财务分析师、行业研究员、风险评估师

第一版目标：

- 在工具箱中展示、查看并启动资产投研团队。
- 启动后创建绑定该团队的专属会话。
- 由 nanobot 调度 4 个研究角色并行执行。
- 在聊天任务步骤中实时展示每个成员的状态。
- 最终由 Team Lead 汇总，并输出经过财务验算和数据抽检的报告。
- 建立可复用的专家团队协议，后续团队不需要重复开发一套 GUI。

## 2. 已确认的产品边界

### 2.1 执行权威

- Electron/React GUI 只负责团队目录、详情、选择、状态展示和文件预览。
- nanobot gateway 是专家团队的唯一执行权威。
- GUI 不直接运行 Python 脚本，不在 renderer 中创建子代理，也不恢复旧的 GUI 本地 Agent 引擎。

### 2.2 上游文件原样保留

资产投研团队需要使用的 `ai-berkshire` 文件放入 `nanobot-gui` 仓库，但保持文件内容和相对路径不变。

原则：

- 不编辑原始 Skill 内容。
- 不给原始 Skill 增加 frontmatter。
- 不把 Claude/Codex 指令直接替换成 nanobot 指令。
- 不在原始资源目录中放置 GUI 或 nanobot 自有文件。
- 通过独立适配层解释原始工作流中的 `TeamCreate`、`TaskCreate`、`TaskUpdate`、`SendMessage`、`TeamDelete` 等语义。
- 同步上游版本时，可以通过文件哈希确认原始文件没有发生本地改写。

### 2.3 历史数据边界

不导入和不读取上游仓库中的以下内容：

- `reports/`
- `实盘记录/`
- `logs/`
- `筛选公司/`
- 上游个人历史研究产物

新报告统一写入当前会话的运行目录，并作为会话文件产物交给 GUI 预览。

### 2.4 投资安全边界

- 产品输出是研究辅助材料，不构成投资建议。
- 信息不足时必须标记低置信度或数据不足，不允许用推测补齐数字。
- 关键财务数据至少使用两个独立来源交叉验证。
- 计算型结果优先使用原始财务校验脚本，而不是模型心算。

## 3. 仓库与打包结构

### 3.1 GUI 仓库资源目录

建议目录：

```text
nanobot-gui/
  resources/
    expert-teams/
      asset-research-team/
        team.yaml
        adapter.md
        upstream.json
        source/
          ai-berkshire/
            AGENTS.md
            README.md
            skills/
              bottleneck-hunter.md
              deep-company-series.md
              dyp-ask.md
              earnings-review.md
              earnings-team.md
              financial-data.md
              industry-funnel.md
              industry-research.md
              investment-checklist.md
              investment-research.md
              investment-team.md
              management-deep-dive.md
              news-pulse.md
              portfolio-review.md
              private-company-research.md
              quality-screen.md
              thesis-drift.md
              thesis-tracker.md
              wechat-article.md
            tools/
              financial_rigor.py
              report_audit.py
              xueqiu_scraper.py
            assets/
              team-core.svg
              architecture.svg
```

`source/ai-berkshire/` 内的文件必须从上游原样复制。`team.yaml`、`adapter.md` 和 `upstream.json` 属于太资如意适配层，不属于上游源码。

第一版只复制 19 个 canonical `skills/*.md`，不复制由其生成的 `codex-skills/` 和 `codex-prompts/`，避免保存三份相同来源。

### 3.2 上游记录

`upstream.json` 示例：

```json
{
  "name": "ai-berkshire",
  "sourcePath": "/Users/wyx/project/nanobot-pc/ai-berkshire",
  "importedAt": "2026-07-11T00:00:00Z",
  "sourceRevision": "git-commit-or-tree-hash",
  "files": {
    "skills/investment-team.md": "sha256:...",
    "tools/financial_rigor.py": "sha256:..."
  }
}
```

`sourcePath` 仅用于开发追踪，不允许成为运行时依赖。

### 3.3 打包

Electron Builder 将 `resources/expert-teams/` 作为 `extraResources` 打入：

```text
process.resourcesPath/expert-teams/
```

开发环境使用：

```text
nanobot-gui/resources/expert-teams/
```

`electron/pythonBridge.ts` 启动 gateway 时通过环境变量传入资源根目录：

```text
NANOBOT_EXPERT_TEAMS_DIR=<absolute expert-teams path>
```

nanobot 不得依赖 GUI 工程的相对目录层级，也不得依赖上游开发机绝对路径。

## 4. 团队清单

`team.yaml` 是太资如意自己的适配清单，不改写原始 Skill。

建议结构：

```yaml
schema_version: 1
id: asset-research-team
name: 资产投研团队
description: 四角色并行完成商业、财务、行业与风险研究，并由 Team Lead 汇总。
version: 1.0.0
source_root: source/ai-berkshire
cover: source/ai-berkshire/assets/team-core.svg
entry_workflow: investment-team
enabled: true

runtime:
  requested_concurrency: 4
  max_members: 4
  report_directory: reports
  adapter: adapter.md

data_sources:
  - id: ifind-finance-data
    name: 同花顺 iFinD 金融数据
    skill: ifind-finance-data
    priority: primary
    required: true

mcp_presets:
  - name: juyuan
    display_name: 聚源金融数据 MCP
    required: false
    description: 工具箱已配置时由团队自动启用，并继承给团队成员。

members:
  - id: business-analyst
    name: 商业分析师
    framework: 段永平视角
  - id: financial-analyst
    name: 财务分析师
    framework: 巴菲特视角
  - id: industry-researcher
    name: 行业研究员
    framework: 芒格视角
  - id: risk-assessor
    name: 风险评估师
    framework: 李录视角

workflows:
  - id: investment-team
    name: 团队深度投研
    source: skills/investment-team.md
    mode: team
    featured: true
  - id: earnings-team
    name: 团队财报复盘
    source: skills/earnings-team.md
    mode: team
    featured: true
  - id: investment-research
    name: 公司深度研究
    source: skills/investment-research.md
    mode: lead
    featured: true
```

完整清单应登记全部 19 个工作流。`mode` 只描述调度方式，不改变对应 Markdown 内容。

## 5. 原始 Skill 适配规则

### 5.1 适配层职责

`adapter.md` 提供高优先级运行约束：

- `$ARGUMENTS` 映射为当前用户任务。
- Claude Code 的 `.claude/settings*.json`、`permissions.allow` 和 `/permissions` 预检在 nanobot 中必须跳过；`WebSearch`/`WebFetch` 分别映射为 `web_search`/`web_fetch`，联网状态以真实工具调用为准。
- `TeamCreate` 映射为创建本次 `team_run`。
- `TaskCreate` 映射为创建结构化成员任务。
- `Task`/Agent 并行调用映射为 nanobot 子代理调度。
- `TaskUpdate` 映射为成员状态事件。
- `SendMessage` 映射为子代理结果回传 Team Lead。
- `shutdown_request` 映射为成员任务完成后的资源释放。
- `TeamDelete` 映射为关闭本次运行上下文，不删除会话历史和报告。
- 原 Skill 中要求写入 `~/...` 的报告路径，由运行时重定向到本次运行的 `reports/` 目录。

适配器不得改写原 Skill 文件。发生冲突时，优先级为：

```text
安全策略 > 会话工作区权限 > 专家团队适配器 > 原始 Skill > 用户普通偏好
```

用户本轮明确要求可以覆盖工作流的非安全性默认项，但不能关闭数据真实性要求。

### 5.2 相对路径

原 Skill 使用 `skills/...`、`tools/...` 等相对路径。运行时必须保证这些路径仍然以 `source/ai-berkshire/` 为根解析。

推荐每次运行创建隔离目录：

```text
<nanobot-workspace>/team-runs/<run-id>/
  source/       # 指向或只读复制团队源文件
  reports/      # 最终报告
  working/      # 临时研究文件
  run.json      # 运行状态快照
```

源文件只读，生成内容只能写入 `reports/` 和 `working/`。

### 5.3 工具依赖

第一版原始工作流直接引用的脚本：

| 文件 | 用途 | 第一版状态 |
| --- | --- | --- |
| `tools/financial_rigor.py` | 市值、估值、交叉验证和情景计算 | 必须可用 |
| `tools/report_audit.py` | 报告财务数据抽检和准出 | 必须可用 |
| `tools/xueqiu_scraper.py` | 雪球观点抓取 | 可选能力 |

前两个脚本只依赖 Python 标准库。`xueqiu_scraper.py` 依赖 Playwright，第一版允许显示为“可选依赖未安装”，不能因此让整个团队不可用。

## 6. 工具箱产品设计

### 6.1 导航

工具箱左侧顺序建议：

1. 专家团队
2. 技能
3. MCP
4. 技能商店

`ToolboxTab` 增加：

```ts
type ToolboxTab = "expert-teams" | "skills" | "mcp" | "skill-store";
```

第一版打开工具箱时仍可保持当前默认 Tab，待专家团队功能稳定后再决定是否改成默认入口。

### 6.2 团队卡片

资产投研团队卡片显示：

- 团队名称和封面。
- 一句话说明。
- `4 位专家`、`19 个工作流`。
- `内置`、`已启用`、`依赖正常/部分可选依赖不可用`。
- “查看团队”和“启动团队”。

搜索范围包括团队名称、说明、成员、分析框架和工作流名称。

### 6.3 详情页

详情页包括：

- 团队介绍。
- Team Lead 和 4 位成员的职责。
- 主要工作流和全部工作流列表。
- 数据源与质量控制说明。
- 依赖检查结果。
- 版本和上游来源信息。
- “启动团队”主按钮。

不在详情页直接展示原始 Skill 全文；可以提供“查看工作流说明”二级入口。

### 6.4 启动行为

点击“启动团队”后：

1. 创建一个新会话。
2. 将 `activeExpertTeamId` 设置为 `asset-research-team`。
3. 返回聊天视图。
4. 输入框上方显示团队标签。
5. 展示适合该团队的示例任务，但不自动发送消息。

推荐示例：

- 深度研究一家公司
- 复盘最新一期财报
- 分析一个行业的竞争格局
- 对比多家公司并给出优先级

团队绑定属于会话级状态。第一版不支持在已有普通会话中途切换团队，避免上下文和运行状态混乱。

## 7. 数据模型

### 7.1 GUI 类型

```ts
interface ExpertTeamSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  available: boolean;
  unavailableReason?: string;
  coverUrl?: string;
  memberCount: number;
  workflowCount: number;
  tags: string[];
}

interface ExpertTeamMember {
  id: string;
  name: string;
  framework?: string;
  description: string;
}

interface ExpertTeamWorkflow {
  id: string;
  name: string;
  description?: string;
  mode: "team" | "lead";
  featured: boolean;
}

interface ExpertTeamDetail extends ExpertTeamSummary {
  members: ExpertTeamMember[];
  workflows: ExpertTeamWorkflow[];
  optionalDependencies: Array<{
    name: string;
    available: boolean;
    reason?: string;
  }>;
}
```

会话增加：

```ts
interface Conversation {
  activeExpertTeamId?: string;
  activeExpertTeamVersion?: string;
}
```

### 7.2 Gateway 团队运行状态

```ts
type ExpertTeamMemberStatus =
  | "pending"
  | "running"
  | "completed"
  | "degraded"
  | "failed"
  | "cancelled";

interface ExpertTeamRunState {
  runId: string;
  teamId: string;
  workflowId: string;
  status: "running" | "completed" | "completed_with_warnings" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
  members: Array<{
    id: string;
    name: string;
    status: ExpertTeamMemberStatus;
    summary?: string;
    error?: string;
  }>;
  reportFiles: string[];
}
```

## 8. Gateway API

所有请求必须显式访问 gateway base URL。

### 8.1 团队目录

| 方法 | 接口 | 用途 |
| --- | --- | --- |
| GET | `/api/settings/expert-teams` | 获取可用团队列表 |
| GET | `/api/settings/expert-teams/detail?id=...` | 获取团队详情和依赖状态 |
| GET | `/api/settings/expert-teams/enable?id=...` | 启用团队 |
| GET | `/api/settings/expert-teams/disable?id=...` | 禁用团队 |

API 不返回原始文件绝对路径。封面通过 gateway 的受控资源接口或安全的资源 URL 返回。

### 8.2 WebSocket 入站

创建团队会话：

```json
{
  "type": "new_chat",
  "expert_team": {
    "id": "asset-research-team",
    "version": "1.0.0"
  },
  "workspace_scope": {}
}
```

发送消息时继续携带团队身份，gateway 必须以 session metadata 为权威进行校验：

```json
{
  "type": "message",
  "chat_id": "chat-id",
  "content": "深度研究腾讯，重点分析游戏和广告业务",
  "expert_team": {
    "id": "asset-research-team"
  },
  "webui": true
}
```

旧客户端没有 `expert_team` 字段时保持现有普通会话行为。

### 8.3 WebSocket 出站

运行开始：

```json
{
  "event": "team_run_started",
  "chat_id": "chat-id",
  "run_id": "run-id",
  "team_id": "asset-research-team",
  "workflow_id": "investment-team",
  "members": []
}
```

成员变化：

```json
{
  "event": "team_member_updated",
  "chat_id": "chat-id",
  "run_id": "run-id",
  "member": {
    "id": "financial-analyst",
    "name": "财务分析师",
    "status": "completed",
    "summary": "已完成财务和估值分析"
  }
}
```

运行结束：

```json
{
  "event": "team_run_completed",
  "chat_id": "chat-id",
  "run_id": "run-id",
  "status": "completed_with_warnings",
  "report_files": ["reports/腾讯投资研究报告_20260711.md"]
}
```

## 9. nanobot 运行规则

### 9.1 团队上下文

每轮执行时，gateway 根据 session 中的 `expert_team`：

1. 读取并校验 `team.yaml`。
2. 加载 `adapter.md`。
3. 按工作流路由加载对应的原始 Markdown。
4. 将团队资源根目录加入本次运行的只读访问范围。
5. 将报告目录加入本次运行的可写范围。
6. 将团队声明的内置 Skill 加入本轮精确 Skill scope；禁止为发现 Skill 扫描 Home 或项目外目录。
7. 对团队声明的 MCP preset 读取当前 gateway 配置，只自动激活已配置项；未配置项只在工具箱显示“配置后自动启用”，不得伪造连接或寻找凭证。
8. 将已激活的团队 MCP 工具按前缀加入 Team Lead，并继承给本次团队成员；不继承未绑定的其他 MCP。
9. 启动 Team Lead，按原始工作流调度成员。

资产投研团队与股票交易分析团队默认绑定 `ifind-finance-data` 和 `juyuan`。两者按字段覆盖互补；单一来源失败时先切换另一绑定结构化数据源，均不可用或仍缺字段时再使用交易所、公司公告、监管披露和公开网页。不得用固定取数次数代替数据完整性判断。

不能把 19 个工作流全量永久塞入每轮上下文。应先注入工作流摘要，由 Team Lead 选择后再加载全文。

### 9.2 并发

现有 nanobot 默认 `max_concurrent_subagents = 1`，且当前限制接近全局计数。专家团队不能直接修改全局默认值。

需要增加：

- 会话级或 run 级子代理额度。
- `asset-research-team` 单次运行最多 4 个成员并行。
- gateway 级总并发保护。
- 达到总并发上限时进入排队状态，而不是把成员标记为失败。
- 普通会话继续使用原有默认并发配置。

第一版所有成员继承当前会话模型。暂不支持每个角色选择不同模型。

### 9.3 失败语义

- 单个成员失败不等于团队失败。
- 有足够研究结果且生成最终报告时，团队状态为 `completed_with_warnings`。
- 失败成员在内部显示低饱和提示，不使用大面积红色。
- 只有无法形成最终结果或 Team Lead 本身失败时，团队整体才是 `failed`。
- 最终报告必须披露缺失维度、信息丰富度评级和 AI 研究局限性。

### 9.4 取消和恢复

- 用户停止生成时，取消本会话对应的 Team Lead 和所有成员任务。
- 已完成的中间结果和运行快照保留。
- 第一版不要求跨进程自动恢复正在运行的子代理。
- 应用重启后可以查看已完成运行和报告；未完成运行显示“已中断”。

## 10. GUI 运行状态展示

团队状态复用任务步骤的折叠容器，但成员作为同一团队任务的子步骤显示，只展示一份团队总耗时。

示例：

```text
资产投研团队                         进行中 6m32s

✓ 明确研究范围
● 商业模式与护城河分析               研究中
● 财务与估值分析                     研究中
✓ 行业格局与竞争分析                 已完成
● 风险与管理层评估                   研究中
○ Team Lead 交叉质证                  等待中
○ 财务数据抽检                       等待中
○ 生成最终报告                       等待中
```

要求：

- 进行中成员有加载动画。
- 团队完成后标题显示一次总耗时，成员行不重复显示相同总耗时。
- 折叠后只显示团队整体状态和总耗时。
- 单成员警告不改变外层“已完成”状态。
- 每个成员完成后可以展开查看 3-5 条摘要，但不把完整中间报告灌入主消息流。

## 11. 报告与文件产物

- 最终报告默认生成 Markdown。
- 后续 PDF/HTML 转换继续走太资如意统一文件生成和预览链路。
- WebSocket `file_edit` 和 `team_run_completed.report_files` 都应指向同一 canonical 文件。
- 点击文件统一在右侧预览，不直接打开裸文件路径。
- 报告文件名需要清理非法字符，并兼容 Windows。
- 报告内容保留引用来源、数据日期、币种、估值假设和抽检结论。

## 12. 状态持久化

gateway session metadata 保存：

```json
{
  "expert_team": {
    "id": "asset-research-team",
    "version": "1.0.0"
  },
  "team_runs": [
    {
      "run_id": "run-id",
      "status": "completed",
      "report_files": []
    }
  ]
}
```

会话同步时，gateway 返回团队绑定和最近运行快照。GUI 本地 store 只做镜像，不能成为运行时 source of truth。

## 13. 预计代码改动

### 13.1 nanobot-gui

- `resources/expert-teams/asset-research-team/**`
- `package.json`：打包专家团队资源。
- `electron/pythonBridge.ts`：向 gateway 传递资源目录。
- `src/stores/settingsStore.ts`：增加 `expert-teams` Tab。
- `src/components/settings/ToolboxModal.tsx`：增加专家团队入口。
- 新增 `src/components/customize/ExpertTeamsSection.tsx`。
- 新增 `src/components/customize/ExpertTeamDetail.tsx`。
- 新增或扩展聊天团队状态组件。
- `src/core/api.ts`：团队 API wrapper。
- `src/core/types.ts`：团队 REST/WS 类型。
- `src/core/nanobot-client.ts`：发送团队绑定、接收团队事件。
- `src/core/nanobotClient.ts`：团队事件映射和会话同步。
- `src/stores/chatStore.ts`：镜像当前会话团队信息。

### 13.2 nanobot

- 新增专家团队 registry、manifest model 和资源校验。
- 新增 expert teams settings API。
- WebSocket 增加团队会话字段和团队状态事件。
- Agent context 增加适配器和按需工作流加载。
- SubagentManager 增加 run/session 级并发额度与状态回调。
- Session persistence 增加团队绑定和运行快照。
- 增加团队注册、并发、事件、失败降级和权限测试。

## 14. 实施阶段

### 阶段 A：资源与团队目录

- 建立 `resources/expert-teams` 目录和团队清单。
- 原样导入确认范围内的上游文件。
- 增加哈希和同步校验脚本。
- 打通开发、macOS 和 Windows 打包资源路径。

### 阶段 B：工具箱闭环

- 增加专家团队 Tab、卡片和详情。
- 增加团队 API。
- 支持创建绑定团队的新会话。
- 支持会话同步恢复团队标签。

### 阶段 C：团队运行时

- 实现适配器加载。
- 实现 4 成员并发和 Team Lead 汇总。
- 实现结构化团队进度事件。
- 实现停止、警告降级和总并发保护。

### 阶段 D：报告与质量

- 接入 `financial_rigor.py`。
- 接入 `report_audit.py`。
- 统一报告文件路径和右侧预览。
- 完成打包环境验证和端到端测试。

## 15. 验收标准

1. 工具箱能看到“资产投研团队”并打开详情。
2. GUI 展示的团队、成员和工作流均来自 gateway API，而不是硬编码运行状态。
3. 点击启动创建独立团队会话，普通会话不受影响。
4. 用户提交投研任务后，4 个成员可以真正并行执行。
5. GUI 实时显示成员等待、运行、完成、警告和失败状态。
6. 团队折叠标题只显示一次整体耗时。
7. 单成员失败时，Team Lead 可以降级完成，外层状态显示“已完成”并附温和警告。
8. 最终报告使用原始工作流要求的结构和质量控制规则。
9. 财务计算和抽检脚本在开发和打包环境都可以执行。
10. 报告点击后统一在右侧预览。
11. 应用重启后能恢复团队会话和已完成运行状态。
12. 打包应用不依赖 `/Users/wyx/project/nanobot-pc/ai-berkshire`。
13. `source/ai-berkshire/` 内导入文件与记录的上游哈希一致。
14. 不读取或打包上游历史报告、实盘记录和个人数据。

## 16. 第一版不做

- 用户自定义创建专家团队。
- 专家团队商店。
- 角色级模型选择和独立 API Key。
- 在普通会话中途切换专家团队。
- 多个专家团队在同一会话协作。
- 跨进程恢复正在运行的子代理。
- 自动交易、下单或连接券商账户。
- 导入上游历史报告作为模型长期记忆。
