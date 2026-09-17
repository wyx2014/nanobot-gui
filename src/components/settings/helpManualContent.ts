export type HelpManualLanguage = 'zh' | 'en';

export type HelpManualSectionId = 'start' | 'work' | 'extend' | 'configure';

export type HelpManualChapterId =
  | 'quick-start'
  | 'conversations'
  | 'task-execution'
  | 'files-artifacts'
  | 'workspaces-permissions'
  | 'asset-research-team'
  | 'automations'
  | 'skills'
  | 'mcp-web'
  | 'models-voice'
  | 'personalization-settings'
  | 'troubleshooting';

interface LocalizedSection {
  label: string;
}

export interface HelpManualSection {
  id: HelpManualSectionId;
  zh: LocalizedSection;
  en: LocalizedSection;
}

export interface HelpManualChapterCopy {
  title: string;
  summary: string;
  keywords: string;
  body: string;
}

export interface HelpManualChapter {
  id: HelpManualChapterId;
  section: HelpManualSectionId;
  zh: HelpManualChapterCopy;
  en: HelpManualChapterCopy;
}

export const HELP_MANUAL_SECTIONS: HelpManualSection[] = [
  { id: 'start', zh: { label: '开始使用' }, en: { label: 'Getting started' } },
  { id: 'work', zh: { label: '核心工作' }, en: { label: 'Core workflows' } },
  { id: 'extend', zh: { label: '扩展能力' }, en: { label: 'Extensions' } },
  { id: 'configure', zh: { label: '配置与支持' }, en: { label: 'Setup & support' } },
];

export const HELP_MANUAL_CHAPTERS: HelpManualChapter[] = [
  {
    id: 'quick-start',
    section: 'start',
    zh: {
      title: '3 分钟快速上手',
      summary: '完成模型配置、选择工作区并发出第一条有效任务。',
      keywords: '首次使用 API Key 默认模型 新建任务 快速开始 入门',
      body: `## 先理解一件事

TP Cowork 的所有任务都在本地电脑上执行，无需把文件上传到云端。通常只需先配置一个可用的文字模型，就能开始工作。

## 第 1 步：配置文字模型

1. 点击左下角 **设置**。
2. 打开 **模型配置 → 接入**，添加 OpenAI-compatible 模型服务，填写 API 地址、API Key 和模型。
3. 点击 **测试并获取模型**，确认服务可连接。
4. 回到 **模型配置 → 使用 → 文字**，把其中一个模型设为默认。

如果发送时没有可用密钥，TP Cowork 会自动打开模型配置页。语音模型与文字模型彼此独立，不使用语音时可以暂不配置。

## 第 2 步：决定是否选择工作区

| 任务 | 是否需要工作区 |
| --- | --- |
| 问答、写作、翻译、联网检索 | 通常不需要 |
| 读取或修改项目文件、执行项目命令 | 建议选择 |
| 让 AI 在指定目录生成报告或代码 | 需要 |

在新任务输入框下方点击 **选择项目**，可以打开已有文件夹。

## 第 3 步：把目标说完整

一个容易执行的请求最好包含：**目标、输入、范围、输出形式和限制**。

| 场景 | 推荐写法 |
| --- | --- |
| 日常办公 | 根据我附上的会议记录，整理决策事项、负责人和截止日期，输出 Markdown 表格。 |
| 表格分析 | 分析这份持仓表，检查行业集中度和前十大持仓，并给出三条需要跟踪的风险。 |
| 单股投研 | 使用资产投研团队 · 个股研究分析长江电力（600900.SH），数据截至今天，最后交付 HTML 研报。 |
| 项目文件 | 阅读当前工作区的 README 和配置文件，先说明问题，再提出修改方案；暂时不要改代码。 |

按 **Enter** 发送，按 **Shift+Enter** 换行。任务运行时仍可继续输入，新内容会进入队列。

## 怎样确认任务正在正常执行

- 输入框上方会出现任务计划、工具调用和执行进度；
- 会话头部的 **置顶摘要** 可查看当前步骤与产物；
- 生成的报告、表格、网页或代码文件会进入右侧 **产物** 区；
- 完成后可以点击文件卡片预览或下载。

> 首次启动后的第一条消息可能需要等待本地服务、模型连接和工具初始化；后续消息通常会更快。`,
    },
    en: {
      title: 'Get productive in 3 minutes',
      summary: 'Configure a model, choose a workspace, and send a well-scoped first task.',
      keywords: 'first run API key default model new task quick start',
      body: `## One thing to know first

TP Cowork runs entirely on your local computer — your files stay on your machine. In most cases, configuring one working text model is all you need to begin.

## Step 1: Configure a text model

1. Open **Settings** in the lower-left corner.
2. Go to **Model Configuration → Connect**, add an OpenAI-compatible service, and enter its API base URL, API key, and models.
3. Use **Test and Fetch Models** to verify the connection.
4. Return to **Model Configuration → Use → Text** and set one model as the default.

Text and speech recognition use separate defaults. You can leave speech unconfigured if you do not need voice input.

## Step 2: Decide whether you need a workspace

| Task | Workspace? |
| --- | --- |
| Q&A, writing, translation, web research | Usually no |
| Read or edit project files, run project commands | Recommended |
| Generate reports or code in a specific folder | Required |

Use **Choose project** below the new-task composer to open a folder.

## Step 3: State the task clearly

A useful request includes the **goal, inputs, scope, output, and constraints**.

| Scenario | Example |
| --- | --- |
| Office work | Turn the attached meeting record into decisions, owners, and deadlines in a Markdown table. |
| Spreadsheet | Review this holdings file for sector concentration and top-ten exposure, then list three risks to monitor. |
| Stock research | Use Asset Research Team · Stock Research to analyze 600900.SH with data through today and deliver an HTML report. |
| Project work | Read the README and configuration in this workspace, explain the issue, and propose a fix without editing yet. |

Press **Enter** to send and **Shift+Enter** for a new line. While a task runs, new requests are placed in the queue.

## Signs that the task is running

- Plans, tool calls, and progress appear above the composer;
- **Pinned summary** shows the current steps and artifacts;
- Generated reports, spreadsheets, pages, and code appear under **Artifacts**;
- Click a file card to preview or download it.

> The first message after a cold launch may wait for the local service, model connection, and tools to initialize. Later turns are normally faster.`,
    },
  },
  {
    id: 'conversations',
    section: 'start',
    zh: {
      title: '界面、会话与历史',
      summary: '认识主界面，管理会话，并在历史记录中快速定位工作。',
      keywords: '侧栏 会话 历史 搜索 重命名 导出 归档 数据管理 返回 前进 置顶摘要',
      body: `## 主界面分为四个区域

| 区域 | 用途 |
| --- | --- |
| 左侧栏 | 新任务、自动化、工具箱、工作区和历史会话 |
| 中间会话区 | 用户消息、执行步骤、模型回复 |
| 底部输入区 | 文字、附件、语音、技能、连接器和专家团队 |
| 右侧工作台 | 置顶摘要、任务进度、生成产物和文件预览 |

收起左侧栏后，文件夹图标和会话标题会留在顶部标题栏。顶部的前进、后退按钮用于在刚访问过的页面和会话之间切换。

## 新建和查找会话

- 点击左侧 **新任务** 开始空白会话；
- 点击侧栏顶部的放大镜，按标题或消息内容搜索历史；
- 搜索结果支持方向键选择、Enter 打开；
- 工作区下的会话会归到对应项目中，普通会话显示在独立的历史区域。

## 会话管理

右键点击会话可以：

- **重命名**：修改侧栏和标题栏显示的名称；
- **导出会话**：保存完整对话记录；
- **归档会话**：从侧栏隐藏会话，但保留完整历史。

归档内容可在 **设置 → 数据管理** 中取消归档。只有在数据管理中再次确认“永久删除”，才会清理会话记录、任务进度和内部索引；永久删除无法撤销，但不会删除工作空间目录、生成产物或其他磁盘文件。项目菜单中的 **归档工作空间** 也可以从数据管理恢复。

## 消息操作

- 悬停用户消息：复制，或将消息内容放回输入框继续修改；
- 悬停助手最终回复：复制回复；
- 点击执行步骤左侧箭头：展开或收起工具过程；
- 点击回复中的文件卡片：在右侧预览。

编辑历史用户消息只会把内容放回输入框，不会修改或截断已有会话记录。

## 两个不同的帮助入口

- 侧栏底部的问号：重新体验「综合办公 → 撰写与润色材料」的点击引导，认识工作空间、技能和资料的用法；
- **设置 → 帮助与反馈 → 使用手册**：打开这份完整手册。`,
    },
    en: {
      title: 'Interface, conversations, and history',
      summary: 'Learn the main layout, manage conversations, and find prior work.',
      keywords: 'sidebar conversation history search rename export archive data management back forward pinned summary',
      body: `## The four main areas

| Area | Purpose |
| --- | --- |
| Sidebar | New tasks, automations, toolbox, workspaces, and history |
| Conversation | User messages, execution steps, and final answers |
| Composer | Text, attachments, voice, skills, connectors, and expert teams |
| Right workbench | Pinned summary, progress, artifacts, and file previews |

When the sidebar is collapsed, the folder icon and conversation title remain in the top bar. Back and forward navigate recently visited views and conversations.

## Create and find conversations

- Select **New task** for a blank conversation;
- Use the magnifier at the top of the sidebar to search titles and message text;
- Use arrow keys and Enter in search results;
- Workspace conversations are grouped under their project.

## Conversation management

Right-click a conversation to **rename**, **export**, or **archive** it. Archiving hides it from the sidebar while preserving its history.

Restore archived conversations or workspaces in **Settings → Data Management**. Only the separately confirmed permanent-delete action removes conversation journals, task progress, and internal indexes. Permanent deletion cannot be undone, but workspace folders, generated artifacts, and other files on disk are never removed there.

## Message actions

- Hover a user message to copy it or place its content back in the composer;
- Hover a final assistant reply to copy it;
- Expand or collapse execution steps with the arrow;
- Open file cards in the preview panel.

Editing a historical prompt only places its content in the composer. Existing conversation history remains unchanged.

## Two help entries

- The question mark in the sidebar replays the Office → Draft and polish materials tutorial, introducing workspaces, skills, and source materials;
- **Settings → Help & Feedback → User Manual** opens this full manual.`,
    },
  },
  {
    id: 'task-execution',
    section: 'start',
    zh: {
      title: '提问、执行与任务队列',
      summary: '理解普通 Agent、工具调用、运行中排队以及停止与重试。',
      keywords: '提问 Agent 工具 计划 队列 停止 重试 网络搜索 技能 连接器',
      body: `## 普通 Agent 怎样工作

没有选择专家团队时，请求由普通 Agent 处理。简单问答可直接回复；需要读文件、联网、调用 MCP 或生成产物时，系统会建立任务计划并调用相应工具。

输入框左下角的 **+** 菜单提供：

- **添加文件**：附加图片或本地文件引用；
- **专家团队**：把适合的任务绑定到固定团队工作流；
- **技能**：显式选择一套专业说明或流程；
- **添加连接器**：允许本轮使用选定 MCP 服务；
- **网络搜索**：打开或关闭普通联网搜索。

技能和连接器会以标签显示在用户消息上，不需要把技术名称重复写进正文。

## 任务运行时继续发送

任务未完成时，发送按钮旁会出现停止按钮。此时发送新内容不会打断当前任务，而是加入会话队列。

队列中的每条内容都可以：

- **发送**：立即作为下一条提交；
- **编辑**：放回输入框修改；
- **删除**：取消这条排队内容。

当前任务完成后，系统会自动发送队列中的下一条。附件、技能和连接器会和各自的排队消息一起保存。

## 什么时候停止

以下情况适合点击红色 **停止**：

- 发现标的、文件或要求写错；
- 工具在重复执行无意义操作；
- 想先补充关键条件，再重新开始。

停止只终止当前运行，不删除已经产生的消息和文件。停止后重新描述完整目标，不要只写“继续”，除非上下文已经非常明确。

## 如何让结果更稳定

1. 一次只给一个主要交付目标；
2. 指定数据日期、市场、单位和输出格式；
3. 明确“先分析再修改”还是“直接修改并验证”；
4. 对高风险操作说明是否允许写文件、执行命令或访问工作区外路径；
5. 对长任务说明完成标准，例如“必须生成 HTML 报告并附上数据来源”。

> 网络搜索、技能和 MCP 是不同能力。打开网络搜索不会自动启用金融 MCP；选择 MCP 也不等于要求 Agent 调用其全部工具。`,
    },
    en: {
      title: 'Prompts, execution, and the queue',
      summary: 'Understand the regular agent, tool execution, queued prompts, stopping, and retrying.',
      keywords: 'prompt agent tools plan queue stop retry web search skills connector',
      body: `## How the regular agent works

Without an expert team, the regular agent handles the request. Simple questions may be answered directly. File work, web research, MCP calls, and artifact generation normally produce a plan and tool activity.

The composer **+** menu contains:

- **Add files** for images and local file references;
- **Expert teams** for fixed team workflows;
- **Skills** for explicit professional instructions;
- **Add connector** for selected MCP services;
- **Web search** for ordinary internet research.

Skills and connectors appear as tags on the user message, so their technical names do not need to be repeated in the prompt.

## Sending while a task is running

New messages are queued instead of interrupting the active run. Every queued item can be sent next, edited, or deleted. Its attachments, skills, and connectors stay with that queued item.

The next item is submitted automatically after the current run finishes.

## When to stop

Use the red **Stop** button when the target or file is wrong, a tool is repeating unhelpful work, or important conditions are missing.

Stopping ends only the active run. Existing messages and artifacts remain. When restarting, restate the complete goal instead of writing only “continue” unless the context is unambiguous.

## Make results more reliable

1. Give one primary deliverable per request;
2. Specify dates, market, units, and output format;
3. Say whether to analyze first or edit immediately;
4. State whether file writes, commands, or access outside the workspace are allowed;
5. Define completion, such as “deliver an HTML report with dated sources.”

> Web search, skills, and MCP are separate capabilities. Enabling one does not implicitly enable or require all the others.`,
    },
  },
  {
    id: 'files-artifacts',
    section: 'work',
    zh: {
      title: '文件、附件与产物',
      summary: '弄清图片与普通文件怎样进入任务，以及如何预览和保存结果。',
      keywords: '上传 附件 文件 图片 PDF Word Excel Markdown 预览 下载 产物 拖拽 粘贴',
      body: `## 添加文件的五种方式

- 点击 **+ → 添加文件**；
- 使用 **Command/Ctrl + U**；
- 把文件拖入会话输入区；
- 直接粘贴剪贴板图片或截图；
- 已选择工作空间时，在输入框中键入 **@**，按名称或相对路径搜索工作空间文件与文件夹；候选项和已选项会用标签区分类型。

选择后，文件会先显示在输入框上方；点击叉号可以在发送前移除。允许只发送附件而不输入文字，但最好补充希望系统如何处理。

输入 **/** 会打开统一能力列表，可选择 Skill 或连接器。连接器不再占用 **@** 触发入口。

## 图片与普通文件当前怎样处理

| 类型 | 当前行为 |
| --- | --- |
| PNG、JPG、WEBP、GIF | 随消息发送给本地服务；每条消息最多 4 张，单张上限 8 MB |
| 文件夹 | 采用本地路径引用，由 Agent 先列出目录内容，再按任务读取需要的文件 |
| PDF、DOCX、XLSX、PPTX、文本等 | 采用本地路径引用，由 Agent 在需要时读取 |

普通文件当前不会复制成远端云附件。发送后请不要立即移动、重命名或删除原文件；如果文件在受限工作区外，Agent 可能无法读取。

TP Cowork 可提取 PDF、DOCX、XLSX、PPTX，以及 TXT、Markdown、CSV、JSON、XML、HTML、YAML、日志和常见配置文本。单个可提取文档上限为 50 MB。旧版 DOC、XLS、PPT 建议先转换为 DOCX、XLSX、PPTX。

## 怎样写附件任务

不要只发送“看看这个”。说明：

- 要处理哪个文件或工作表；
- 关注哪些字段、日期和单位；
- 希望得到摘要、核对结果、图表还是新文件；
- 是否允许修改原文件，还是只生成副本。

示例：**读取持仓.xlsx 的“组合明细”工作表，按申万一级行业统计占比，检查单一证券和行业集中度，只读原文件，另生成一份分析报告。**

## 文件卡片与右侧预览

用户附件和 Agent 生成文件都会显示为文件卡片。点击后可在右侧预览：

- PDF、DOCX、XLSX、CSV；
- Markdown、文本和常见代码文件；
- 图片、视频和 HTML。

预览头部可执行打开系统应用、在文件夹中显示、复制路径、下载或全屏。远程签名文件通常提供下载；本地文件提供系统打开和定位。

## “附件”和“产物”的区别

- **附件**：你提供给本轮任务的输入；
- **产物**：Agent 生成的报告、表格、网页、图片或代码。

置顶摘要中的 **产物** 会持续汇总当前会话生成的文件。重要结果应及时下载或保存到工作区，不要只依赖聊天气泡。`,
    },
    en: {
      title: 'Files, attachments, and artifacts',
      summary: 'Understand how images and documents enter a task and how to preview and save results.',
      keywords: 'upload attachment file image PDF Word Excel Markdown preview download artifact drag paste',
      body: `## Five ways to add files

- Choose **+ → Add files**;
- Press **Command/Ctrl + U**;
- Drag files into the composer;
- Paste clipboard images or screenshots;
- With a workspace selected, type **@** to search its files by name or relative path.

Files appear above the composer before sending and can be removed. Attachment-only messages are allowed, but adding an instruction is more reliable.

Type **/** to open the unified capability list for Skills and connectors. Connectors no longer use the **@** trigger.

## Current handling by type

| Type | Behavior |
| --- | --- |
| PNG, JPG, WEBP, GIF | Sent with the message to the local service; up to 4 images per message and 8 MB each |
| PDF, DOCX, XLSX, PPTX, and text files | Referenced by local path and read by the agent when needed |

Regular documents are currently local references rather than cloud uploads. Do not move, rename, or delete the source immediately after sending. A restricted workspace may block files outside its folder.

TP Cowork can extract PDF, DOCX, XLSX, PPTX, TXT, Markdown, CSV, JSON, XML, HTML, YAML, logs, and common configuration text. Extractable documents are limited to 50 MB each. Convert legacy DOC, XLS, and PPT files to their newer formats first.

## Write a useful file request

Specify the file or sheet, fields and dates, expected output, and whether the source may be modified.

Example: **Read the Portfolio Detail sheet in holdings.xlsx, calculate sector concentration, keep the source read-only, and generate a separate review report.**

## File cards and preview

Attachments and generated artifacts appear as cards. The preview panel supports PDF, DOCX, XLSX, CSV, Markdown, text, code, images, video, and HTML.

Depending on the file, actions include opening in a system app, revealing its folder, copying its path, downloading, and expanding the preview.

## Attachment vs. artifact

- An **attachment** is input you provide;
- An **artifact** is a report, sheet, page, image, or code file generated by the agent.

Save important artifacts to the workspace or download them rather than relying only on the chat bubble.`,
    },
  },
  {
    id: 'workspaces-permissions',
    section: 'work',
    zh: {
      title: '工作区与权限',
      summary: '让 Agent 在正确目录工作，并理解受限访问与完全访问。',
      keywords: '工作区 项目 文件夹 权限 沙箱 受限 完全访问 命令 路径 归档工作空间',
      body: `## 工作区是什么

工作区是某个任务允许使用的项目目录。它把以下内容关联起来：

- 会话和项目历史；
- 允许读取、修改和生成文件的位置；
- 这个项目可使用的“我的技能”；
- 执行命令时的默认目录。

普通问答不必选择工作区。涉及代码、报告落盘、本地资料或命令时，应先选对目录。

## 选择、创建和切换

在新任务输入框下方：

- 从最近项目中选择；
- 打开已有文件夹；
- 创建空白项目。

侧栏的 **工作区** 会按项目组织相关会话。

## 受限访问和完全访问

- **受限访问**：文件和命令被限制在当前工作区内，适合不希望任务访问其他目录的场景；
- **完全访问**：本轮可按系统授权访问工作区外路径，适合读取外部附件或调用项目外工具。

如果任务确实需要工作区外文件，界面会显示 **需要完全访问权限**，可以点击“切换完全访问并重试”。只在信任任务和路径时授权。

## 为什么会提示无法读取文件

依次检查：

1. 文件是否仍在发送时的原路径；
2. 当前会话是否选中了正确工作区；
3. 文件是否位于工作区外；
4. 文件是否被其他程序锁定或当前账户无权读取；
5. 是否需要切换完全访问后重试。

## 项目菜单

右键工作区可以：

- 在文件管理器中打开位置；
- 管理该项目允许使用的“我的技能”；
- 归档工作空间。

**归档工作空间会将工作空间及其会话从侧栏隐藏，但不会删除磁盘文件。** 之后可在 **设置 → 数据管理** 中取消归档；只有单独确认“永久删除”才会清理应用内记录。`,
    },
    en: {
      title: 'Workspaces and permissions',
      summary: 'Keep the agent in the right folder and understand restricted versus full access.',
      keywords: 'workspace project folder permission sandbox restricted full access command path archive',
      body: `## What a workspace means

A workspace is the project folder available to a task. It associates conversations, permitted file locations, project skills, and the default command directory.

General Q&A does not require one. Code changes, reports written to disk, local documents, and commands should use the correct workspace.

## Choose, create, and switch

Below the new-task composer you can select a recent project, open an existing folder, or create a blank project. 

## Restricted and full access

- **Restricted access** keeps file and command operations inside the workspace;
- **Full access** permits system-authorized paths outside it for the current conversation.

When an outside path is genuinely required, the UI can offer **Switch to full access and retry**. Grant it only for trusted tasks and paths.

## If a file cannot be read

Check that the file still exists at the original path, the correct workspace is selected, the file is not outside the allowed scope, the current account can read it, and full access is granted when appropriate.

## Project menu

Right-click a workspace to reveal it, manage its project skills, or archive it.

**Archiving a workspace hides it and its conversations from the sidebar without deleting files on disk.** Restore it from **Settings → Data Management**; only a separately confirmed permanent deletion removes app records.`,
    },
  },
  {
    id: 'asset-research-team',
    section: 'work',
    zh: {
      title: '资产投研团队 · 个股研究',
      summary: '什么时候启动单股投研工作流，以及固定 DAG、数据源和交付物怎样运作。',
      keywords: '股票 A股 投研 专家团队 基础数据 商业 财务 行业 风险 主笔 审校 HTML iFinD 聚源 财汇',
      body: `## 适用范围

资产投研团队 · 个股研究只承接**明确指向单只股票的投资研究任务**。正确输入应尽量包含：

- 公司名称或证券代码；
- 市场，例如 A 股、港股、美股；
- 研究重点和数据截止日期。

“比亚迪”“长江电力”“600900”这类能明确定位证券的输入可以启动；行业泛研、翻译、写作、天气等请求仍由普通 Agent 执行。

即使团队已经选中，每一轮也会由模型根据语义判断：

- 启动单股团队流程；
- 缺少标的时追问；
- 用户补充资料时续跑；
- 非单股任务交给普通 Agent。

## 怎样启动

方式一：**工具箱 → 专家团队 → 资产投研团队 · 个股研究 → 使用团队**。应用会返回新对话并在输入框中预选该团队，不会提前创建会话或启动任务。

方式二：在输入框选择 **+ → 专家团队 → 资产投研团队 · 个股研究**，然后发送具体标的。

选择后输入框会显示团队标签；点击标签上的叉号可以取消。填写具体需求并发送后，系统才会创建会话并启动相应流程。

## 固定工作流

团队流程由运行时图引擎控制，节点不能被模型跳过或重排：

1. **建立基础数据包**：公司摘要、财务指标、公告新闻、行业板块；
2. **四位专家并行研究**：
   - 商业分析师：商业模式、主营构成、竞争壁垒；
   - 财务分析师：报表、现金流、盈利质量与估值；
   - 行业研究员：行业格局、产业链、可比公司；
   - 风险评估师：治理、诉讼处罚、质押减持与风险新闻；
3. **主笔交叉质证与汇总**：核对四路证据和冲突；
4. **报告审校与交付**：检查结构、数据口径和文件完整性。

只有四个并行角色都进入终态，主笔节点才会开始；报告写入后才进入审校。

## 数据来源顺序

对 A 股关键数值，团队优先使用并交叉核验：

1. 同花顺 iFinD、聚源、财汇结构化金融数据；
2. 公司公告、交易所和巨潮资讯用于事实裁决；
3. 核心数据源不足时使用 AnySearch；
4. 最后才使用 DuckDuckGo 等公开网页搜索。

团队会尽量按字段核对数值、日期、单位和来源，而不是把三个数据源各自完整研究一遍。

## 失败与续跑

- 单个角色失败时，运行时最多自动重试一次；
- 仍失败时，主笔使用基础数据包和其他角色结果补齐，并标注证据缺口；
- 用户补充缺失材料后，可从主笔交叉质证和审校阶段续跑，不必重新执行全部四路研究；
- 只有无法生成最终报告文件时，整体任务才应失败。

## 最终交付

标准交付是经过审校的 Markdown 源报告和面向阅读的 HTML 研报，包含数据日期、来源、四维分析、关键指标、风险矩阵和研究局限。

> 资产投研团队 · 个股研究输出是研究辅助材料，不构成投资建议。对于组合风险、行业研究或普通办公任务，应使用普通 Agent 或相应工具，而不是强行启动单股工作流。`,
    },
    en: {
      title: 'Asset Research Team · Stock Research',
      summary: 'Learn when the single-stock workflow starts and how its fixed DAG, sources, and delivery work.',
      keywords: 'stock research expert team data package business financial industry risk lead audit HTML',
      body: `## Scope

Asset Research Team · Stock Research handles **investment research on one clearly identified security**. Include the company or ticker, market, research focus, and data cut-off when possible.

Inputs such as “BYD,” “Yangtze Power,” or “600900” can identify a security. Industry-wide research, translation, writing, weather, and other non-stock tasks stay with the regular agent.

Even while the team is selected, the model routes every turn to start the workflow, ask for a missing target, resume with new evidence, or use the regular agent.

## Start the team

- Open **Toolbox → Expert Teams → Asset Research Team · Stock Research → Use Team** to return to a new chat with the team preselected; or
- Select **+ → Expert Teams → Asset Research Team · Stock Research** in the composer.

The team chip appears in the composer. A session is created and the workflow starts only after you enter a concrete request and send it.

## Fixed workflow

The runtime graph owns the order:

1. **Build the base data package**;
2. Run four specialists in parallel:
   - Business analyst;
   - Financial analyst;
   - Industry researcher;
   - Risk assessor;
3. **Team Lead cross-examination and synthesis**;
4. **Report audit and delivery**.

The lead starts only after all four branches reach a terminal state. Audit starts only after the report is written.

## Source priority

For key A-share figures, the team cross-checks iFinD, Juyuan, and Caihui; uses company, exchange, and CNINFO disclosures for factual resolution; then falls back to AnySearch and finally ordinary public web search.

## Failure and resume

A failed specialist may retry once. If it still fails, the lead uses the base package and other outputs while marking evidence gaps. New user evidence can resume at synthesis and audit instead of rerunning all four branches.

## Delivery

The normal delivery is an audited Markdown source and a readable HTML report with dated sources, four-dimensional analysis, key metrics, a risk matrix, and limitations.

> The report is research assistance, not investment advice. Portfolio risk, industry-wide research, and office tasks should use the regular agent or an appropriate tool.`,
    },
  },
  {
    id: 'automations',
    section: 'work',
    zh: {
      title: '自动化与定时任务',
      summary: '创建、运行和检查重复任务。',
      keywords: '自动化 定时任务 每小时 每天 每周 每月 工作日 手动 暂停 运行记录 cron',
      body: `## 创建任务

打开侧栏 **自动化**，可以：

- 在 **定时任务** 页点击 **添加自动化** 手动填写；
- 从任务模板选择工作周报、晨间简报、AI 新闻、月度复盘、知识沉淀或邮件待办提取，并在保存前继续修改；
- 点击 **让 TP Cowork 帮我创建**，先在会话中描述需求。

一个任务包含名称、说明、执行指令、频率，以及可选的技能和工作区。

## 当前支持的频率

- 每小时：选择每小时的第几分钟；
- 每天：选择小时和分钟；
- 每周：选择星期、小时和分钟；
- 每月：选择日期、小时和分钟；
- 工作日：周一至周五固定时间；
- 仅手动：不会自动触发，只能点击“立即运行”。

当前编辑器不提供任意 cron 表达式输入。

## 管理和查看结果

任务卡片支持：

- 编辑；
- 立即运行；
- 暂停或恢复；
- 删除。

“我的自动化”只管理任务本身，不再展开执行记录。顶部 **执行记录** 页会汇总所有任务的执行结果，并支持按状态筛选、搜索任务或错误。每次运行都有独立会话；点击记录可以打开当次对话，查看完整过程、错误和产物。已完成或出错的记录可单独删除，正在执行的记录需等待结束后才能删除。

## 为什么任务没有按时运行

自动化任务在应用内运行，因此需要：

1. TP Cowork 应用保持运行；
2. 电脑没有休眠；
3. 模型服务和必要 MCP 凭证可用；
4. 绑定的工作区路径仍然存在；
5. 任务没有被暂停。

应用关闭或电脑休眠期间不会保证补跑错过的任务。关键自动化应先用“立即运行”验证一次。`,
    },
    en: {
      title: 'Automations and scheduled tasks',
      summary: 'Create, run, and inspect recurring tasks.',
      keywords: 'automation scheduled task hourly daily weekly monthly weekdays manual pause run history cron',
      body: `## Create a task

Open **Automations** and create a task manually, start from a weekly report, morning brief, AI news, monthly review, knowledge capture, or email action template, or ask TP Cowork to help draft one. Templates remain fully editable before saving.

A task has a name, description, instruction, frequency, and optional skill and workspace.

## Supported frequencies

- Hourly at a selected minute;
- Daily at a selected time;
- Weekly on a selected day and time;
- Monthly on a selected date and time;
- Weekdays, Monday through Friday;
- Manual only.

The current editor does not expose arbitrary cron expressions.

## Manage and review

Task cards only manage the automation itself: edit, run now, pause or resume, and delete. The top-level **Run history** tab is the single place for execution records, with status filters plus task/error search. Each run has its own conversation; open it to inspect the full process, errors, and artifacts. Completed and failed records can be deleted individually; running records become deletable after they finish.

## If a task does not run

TP Cowork must remain running, the computer must be awake, model and MCP credentials must work, the workspace must still exist, and the task must not be paused.

Missed executions are not guaranteed to catch up after shutdown or sleep. Test important automations once with **Run now**.`,
    },
  },
  {
    id: 'skills',
    section: 'extend',
    zh: {
      title: '技能与技能商店',
      summary: '使用、创建和按项目授权可复用的专业工作说明。',
      keywords: '技能 SKILL.md 内置技能 我的技能 创建 上传 技能商店 PromptHub 项目绑定',
      body: `## 技能是什么

技能是一份可复用的专业说明和工作流，通常存放在 SKILL.md 中。它告诉 Agent 在某类任务里遵循哪些步骤、规范和检查项，但它本身不是外部数据连接。

## 使用技能

- 在输入框选择 **+ → 技能**；
- 或输入 **/技能名** 从候选列表选择；
- 可以同时选择多个，但应只选择与任务直接相关的技能。

发送后，技能以标签显示在用户消息上。项目技能只有在当前工作区被授权后才会进入可用列表。

## 工具箱中的技能

打开 **工具箱 → 技能**：

- **内置技能**：随 TP Cowork 提供，可启用或禁用；
- **我的技能**：你创建或导入的工作区技能，可编辑管理和删除。

禁用技能后，它不会出现在输入候选中，也不会参与 Agent 的技能发现。

## 创建技能

工具箱右上角的创建菜单提供：

- **让 TP Cowork 创建**：进入会话，由 Agent 帮你梳理技能；
- **手动创建**：填写英文小写名称、触发描述和技能正文；
- **上传文件**：导入 Markdown，推荐文件名为 SKILL.md。

技能名称只能使用英文小写、数字和连字符。

## 项目绑定

右键侧栏中的工作区，选择 **管理技能**，可以决定哪些“我的技能”在该项目中可用。这样能避免某个项目的内部流程污染其他工作区。

## 技能商店

技能商店用于发现和安装共享技能；上传自己的技能需要先登录 PromptHub 账户。安装后仍应检查技能说明和适用范围，再决定是否启用。`,
    },
    en: {
      title: 'Skills and Skill Store',
      summary: 'Use, create, and authorize reusable professional instructions by project.',
      keywords: 'skill SKILL.md built-in my skills create upload store PromptHub project binding',
      body: `## What a skill is

A skill is reusable professional guidance, usually stored in SKILL.md. It defines steps, standards, and checks for a class of work; it is not an external data connection.

## Use a skill

- Select **+ → Skills**; or
- Type **/skill-name** and choose a suggestion.

Choose only skills relevant to the task. Project skills appear only when authorized for the active workspace.

## Manage skills

**Toolbox → Skills** separates built-in skills from **My Skills**. Skills can be enabled or disabled; workspace skills can also be deleted.

## Create a skill

Use the create menu to ask TP Cowork for help, create manually, or import Markdown (preferably SKILL.md). Names use lowercase English letters, digits, and hyphens.

## Project binding

Right-click a workspace and choose **Manage Skills** to decide which personal skills are available in that project.

## Skill Store

The store lets you discover and install shared skills. Publishing your own skill requires a PromptHub account. Review an installed skill before enabling it.`,
    },
  },
  {
    id: 'mcp-web',
    section: 'extend',
    zh: {
      title: 'MCP、连接器与网络搜索',
      summary: '配置外部数据服务，并分清连接器、技能和普通联网。',
      keywords: 'MCP 连接器 stdio HTTP SSE 网络搜索 DuckDuckGo iFinD 聚源 财汇 AnySearch 工具',
      body: `## 三种能力不要混淆

| 能力 | 解决什么问题 | 示例 |
| --- | --- | --- |
| 技能 | 告诉 Agent 应该怎样做 | 投研流程、报告规范 |
| MCP 连接器 | 提供外部工具或结构化数据 | iFinD、聚源、财汇、内部系统 |
| 网络搜索 | 检索公开网页 | 新闻、官网、公开资料 |

一个完整任务可以同时使用三者，但没有必要每次全部开启。

## 配置预置 MCP

打开 **工具箱 → MCP**：

1. 在“全部”中找到服务；
2. 补齐密钥、Token、命令或地址等必填项；
3. 点击启用或更新；
4. 点击 **测试** 检查连接；
5. 在工具列表中选择允许 Agent 使用的具体工具，或允许全部。

状态可能显示“缺少密钥”“缺少依赖”“已配置”或“暂不可用”。“已安装”不一定等于“已配置”。

## 添加自定义 MCP

自定义服务支持：

- **stdio**：填写启动命令、参数和环境变量；
- **HTTP**：填写 MCP endpoint、请求头和超时；
- **SSE**：填写 SSE 地址、请求头和超时。

参数、环境变量和请求头需要填写有效 JSON。保存后如果提示需要重启，请按界面提示重新启动应用。

## 在消息中使用

- 选择 **+ → 添加连接器**；
- 或输入 **@连接器名** 从候选中选择。

消息上的连接器标签表示“本轮允许使用”，不保证 Agent 一定调用；是否调用仍由任务需要决定。

## 网络搜索

输入框 + 菜单中的 **网络搜索** 控制普通网页检索。它独立于 MCP：

- 查结构化金融字段，优先使用已配置的金融 MCP；
- 查公告、官网和新闻，可使用网络搜索；
- 资产投研团队 · 个股研究会按自己的数据源优先级自动使用绑定来源。

## 性能建议

不要为每条消息附加所有 MCP。工具定义越多，模型首轮理解和选择工具的成本越高，也更容易选错来源。只附加本轮需要的连接器；专家团队已绑定的数据源不必手工重复选择。`,
    },
    en: {
      title: 'MCP, connectors, and web search',
      summary: 'Configure external data services and distinguish connectors, skills, and ordinary web access.',
      keywords: 'MCP connector stdio HTTP SSE web search iFinD Juyuan Caihui AnySearch tools',
      body: `## Do not confuse these capabilities

| Capability | Purpose | Example |
| --- | --- | --- |
| Skill | Tells the agent how to work | Research process, report standard |
| MCP connector | Supplies external tools or structured data | iFinD, Juyuan, Caihui, internal services |
| Web search | Finds public web information | News, official sites, public documents |

## Configure a preset

In **Toolbox → MCP**, find a service under All, provide its required credentials or connection fields, enable it, test it, and choose which tools the agent may use.

Installed does not always mean configured. Status may report missing credentials, missing dependencies, configured, or unavailable.

## Add a custom MCP

Custom transports include:

- **stdio** with command, arguments, and environment;
- **HTTP** with endpoint, headers, and timeout;
- **SSE** with URL, headers, and timeout.

Arguments, environment, and headers must be valid JSON. Restart the app when the UI says a restart is required.

## Use in a message

Choose **+ → Add connector** or type **@connector-name**. The tag grants availability for that turn; the agent still decides whether the task needs a call.

## Web search and performance

Web search is separate from MCP. Prefer financial MCP for structured fields and web search for public announcements, sites, and news.

Do not attach every MCP to every prompt. Larger tool definitions slow initial tool selection and increase the chance of choosing the wrong source. Expert teams already inject their configured bindings.`,
    },
  },
  {
    id: 'models-voice',
    section: 'configure',
    zh: {
      title: '模型配置与语音输入',
      summary: '接入文字模型，单独配置 ASR，并处理常见连接问题。',
      keywords: '模型 API Key OpenAI compatible 默认模型 语音 ASR 麦克风 实时识别 OAuth',
      body: `## 模型配置的两层结构

**模型配置 → 接入** 管理模型服务：

- 服务名称；
- OpenAI-compatible API 地址；
- API Key；
- Chat Completions、Responses 或自动协议；
- 该服务提供的模型列表。

**模型配置 → 使用** 决定默认用途：

- **文字**：普通对话、工具任务和专家团队使用的默认模型；
- **语音识别**：麦克风录音转文字使用的 ASR 模型。

添加服务后还需要在“使用”页设为默认，否则输入框可能仍然没有可用模型。

## 测试并获取模型

“测试并获取模型”会访问服务地址并读取模型列表。失败时检查：

1. API 地址是否包含正确版本路径；
2. Key 是否有效以及是否有模型权限；
3. 服务是否兼容选择的 API 类型；
4. 公司代理、防火墙或证书是否阻断；
5. 模型名称是否与服务端一致。

## 语音输入

在 **语音设置** 中：

1. 选择支持 speech_to_text 的默认模型；
2. 配置对应服务的 API Key 和地址；
3. 启用语音输入；
4. 选择识别语言和最长录音时长。

聊天输入框的麦克风会经历“连接中 → 录音 → 整理/识别”。录音完成后，识别文本会写入输入框，由你确认后再发送。

部分 ASR 支持边说边出字，其他模型在停止录音后一次性识别。双向语音通话模型不一定适合作为输入框听写模型。

## macOS 麦克风权限

打包应用需要给 TP Cowork 麦克风权限。开发模式下，权限可能归属于启动 Electron 的终端或 IDE；如果提示无权限，请在系统设置的“隐私与安全性 → 麦克风”中允许实际宿主应用。`,
    },
    en: {
      title: 'Models and voice input',
      summary: 'Connect a text model, configure ASR separately, and diagnose common connection issues.',
      keywords: 'model API key OpenAI compatible default voice ASR microphone realtime OAuth',
      body: `## Two layers of model configuration

**Model Configuration → Connect** manages service name, OpenAI-compatible base URL, API key, API type, and models.

**Model Configuration → Use** selects defaults:

- **Text** for chat, tools, and expert teams;
- **Speech Recognition** for microphone transcription.

After adding a service, set a model as the default for its capability.

## Test and fetch models

If probing fails, check the versioned base URL, key and permissions, API type compatibility, proxy or certificate restrictions, and exact model names.

## Voice input

Under **Voice**, select a speech-to-text model, configure its service, enable voice input, and choose language and maximum duration.

The composer moves through connecting, recording, and finalizing/transcribing. Recognized text is placed in the composer for review before sending. Some models stream partial text; others transcribe after recording.

## macOS permission

Packaged builds need microphone access for TP Cowork. In development, permission may belong to the terminal or IDE that launched Electron. Allow the actual host under Privacy & Security → Microphone.`,
    },
  },
  {
    id: 'personalization-settings',
    section: 'configure',
    zh: {
      title: '个性化、系统设置与账户',
      summary: '调整助手人格、用户画像、界面偏好、通知和 PromptHub 账户。',
      keywords: '个性化 SOUL.md USER.md 语言 主题 字体 通知 PromptHub 账户 反馈 日志',
      body: `## 个性化文件

**设置 → 个性化** 管理两个文件：

- **SOUL.md**：助手人格、工作方式和长期行为原则；
- **USER.md**：你的称呼、时区、沟通偏好和稳定背景。

页面通过“助手人格”和“用户画像”两个切页分别编辑；切换切页不会丢失当前草稿，带“未保存”标记的切页会在点击“保存更改”后一起保存。

修改会从下一条消息起生效，不需要重启。两个文件都可恢复内置模板。

适合写入长期偏好，例如：

- 默认使用中文和专业语气；
- 结论先行，复杂问题再展开证据；
- 投研数据必须标日期、单位和来源。

不要把只针对一次任务的要求写进 USER.md，也不要在这些文件中保存 API Key、密码等密钥。

## 系统设置

可以调整：

- 显示语言；
- 跟随系统、亮色或暗色主题；
- 全局字体大小；
- 默认工作区位置；
- 桌面通知。

默认工作区路径当前为只读展示，可点击“查看”在文件管理器中打开。

## 账户管理

PromptHub 账户主要用于技能商店的安装、发布和账号关联。普通本地聊天和自定义模型服务不要求登录 PromptHub。

## 帮助与反馈

**设置 → 帮助与反馈** 提供：

- 使用手册；
- 导出诊断包，填写问题描述和时间范围，保存本地 ZIP 后发给技术支持；
- 联系我们。

提交日志前应检查其中是否包含不希望分享的路径、错误信息或业务上下文。`,
    },
    en: {
      title: 'Personalization, system settings, and account',
      summary: 'Tune persona, profile, interface preferences, notifications, and PromptHub.',
      keywords: 'personalization SOUL.md USER.md language theme font notification PromptHub account feedback logs',
      body: `## Personalization files

**Settings → Personalization** manages:

- **SOUL.md** for assistant persona and durable working principles;
- **USER.md** for your name, timezone, communication preferences, and stable background.

Use the Assistant Persona and User Profile tabs to edit one file at a time. Switching tabs preserves drafts, and **Save changes** saves every tab marked as unsaved.

Changes apply on the next message without a restart. Both files can be restored to the bundled template.

Store durable preferences here, not one-off task instructions or secrets such as API keys and passwords.

## System settings

Configure display language, system/light/dark theme, global font size, default workspace location, and desktop notifications.

## Account

PromptHub is primarily for Skill Store installation, publishing, and account association. Local chat and custom model services do not require PromptHub sign-in.

## Help and feedback

The Help & Feedback page includes this manual, diagnostic bundle export, and contact information. Describe the issue and choose its time range to save a local ZIP for technical support. Nothing is uploaded automatically.`,
    },
  },
  {
    id: 'troubleshooting',
    section: 'configure',
    zh: {
      title: '故障排查与快捷键',
      summary: '按现象快速定位模型、文件、MCP、团队、自动化和性能问题。',
      keywords: '故障 排查 快捷键 无回复 发热 卡住 文件读不到 MCP 团队不启动 自动化 日志',
      body: `## 常见问题速查

| 现象 | 优先检查 |
| --- | --- |
| 点击发送没有开始 | 是否配置默认文字模型和有效 API Key，本地服务是否就绪 |
| 第一条消息等待较久 | 本地服务、模型连接和工具首次初始化；先等待，不要连续重复发送 |
| 文件卡片存在但 Agent 读不到 | 原文件是否移动、路径是否在工作区外、是否需要完全访问 |
| MCP 不可用 | 工具箱状态、必填凭证、依赖、测试结果，以及是否提示重启 |
| 资产投研团队 · 个股研究没有启动 | 是否选择团队，输入是否明确是单只股票的投研任务 |
| 团队停在某个成员 | 查看该成员状态；运行时会重试一次，其他成员终态后主笔才开始 |
| 自动化没有执行 | 应用是否运行、电脑是否休眠、任务是否暂停、工作区和凭证是否仍可用 |
| 任务反复调用工具 | 点击停止，缩小目标和来源范围后重新发送 |
| 电脑明显发热 | 长任务、多专家并行、网页渲染和大量工具会提高 CPU；停止无效任务并减少不必要 MCP |

## 反馈问题

反馈问题时建议附上：

- 发生时间；
- 会话标题和操作步骤；
- 错误提示截图；
- 是否为开发版或打包版、操作系统版本。

不要公开提交完整 API Key、Token 或业务敏感文件。

## 默认快捷键

| 操作 | macOS | Windows / Linux |
| --- | --- | --- |
| 新任务 | Command+N | Ctrl+N |
| 聚焦输入框 | Command+K | Ctrl+K |
| 收起/展开侧栏 | Command+B | Ctrl+B |
| 打开工具箱 | Command+T | Ctrl+T |
| 打开设置 | Command+, | Ctrl+, |
| 添加文件 | Command+U | Ctrl+U |
| 换行 | Shift+Enter | Shift+Enter |
| 发送 | Enter | Enter |
| 后退 | Command+[ | Alt+← |
| 前进 | Command+] | Alt+→ |

前五项可以在 **设置 → 快捷键** 中修改或恢复默认。自定义组合必须包含 Command 或 Ctrl。

## 仍然无法解决

打开 **设置 → 帮助与反馈 → 导出诊断包**，用“发生了什么、期望什么、如何复现”的顺序描述，选择时间范围并保存 ZIP。将 ZIP 和问题编号发给技术支持。窗口 **帮助 → 导出诊断包** 也能进入；界面无响应时可使用原生帮助菜单导出最近 15 分钟的应用诊断。`,
    },
    en: {
      title: 'Troubleshooting and shortcuts',
      summary: 'Diagnose model, file, MCP, team, automation, and performance issues by symptom.',
      keywords: 'troubleshooting shortcut no response hot stuck file MCP team automation log',
      body: `## Symptom checklist

| Symptom | Check first |
| --- | --- |
| Send does not start | Default text model, API key, local service readiness |
| First message is slow | Local service, model connection, and tool initialization |
| File card exists but cannot be read | Source moved, outside workspace, or full access required |
| MCP unavailable | Status, credentials, dependency, test result, restart notice |
| Research team does not start | Team selected and request is clearly single-stock investment research |
| Team waits on a member | The runtime may retry once; the lead waits for all branches to terminate |
| Automation did not run | App running, computer awake, task active, workspace and credentials valid |
| Repeated tools | Stop, narrow the goal and source range, then resend |
| High CPU or heat | Long tasks, parallel specialists, page rendering, and many tools increase load |

## Reporting issues

A useful report includes time, conversation, reproduction steps, screenshot, build type, and OS version.

Never publish API keys, tokens, or sensitive business files.

## Default shortcuts

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| New task | Command+N | Ctrl+N |
| Focus composer | Command+K | Ctrl+K |
| Toggle sidebar | Command+B | Ctrl+B |
| Open toolbox | Command+T | Ctrl+T |
| Open settings | Command+, | Ctrl+, |
| Add files | Command+U | Ctrl+U |
| New line | Shift+Enter | Shift+Enter |
| Send | Enter | Enter |
| Back | Command+[ | Alt+Left |
| Forward | Command+] | Alt+Right |

The first five can be customized under **Settings → Keyboard Shortcuts**.

## Still blocked

Open **Settings → Help & Feedback → Export Diagnostics**. Describe what happened, what you expected, and how to reproduce it, then choose the time range and save a ZIP. Send the ZIP and issue ID to technical support. The window Help menu offers the same entry; the native Help menu can export recent application diagnostics if the interface stops responding.`,
    },
  },
];

export function localizedHelpChapter(
  chapter: HelpManualChapter,
  language: HelpManualLanguage,
): HelpManualChapterCopy {
  return language === 'en' ? chapter.en : chapter.zh;
}

export function localizedHelpSection(
  section: HelpManualSection,
  language: HelpManualLanguage,
): LocalizedSection {
  return language === 'en' ? section.en : section.zh;
}

export function searchHelpManual(
  query: string,
  language: HelpManualLanguage,
): HelpManualChapter[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return HELP_MANUAL_CHAPTERS;

  const terms = normalized.split(/\s+/).filter(Boolean);
  return HELP_MANUAL_CHAPTERS.filter((chapter) => {
    const copy = localizedHelpChapter(chapter, language);
    const haystack = [
      copy.title,
      copy.summary,
      copy.keywords,
      copy.body,
    ].join('\n').toLocaleLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
