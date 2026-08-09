import { useState } from 'react';
import {
  BookOpenText,
  Bot,
  FileText,
  Globe2,
  Keyboard,
  Plug,
  Rocket,
  Settings,
  Sparkles,
  Timer,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import MarkdownRenderer from '@/components/chat/MarkdownRenderer';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

interface ChapterCopy {
  title: string;
  body: string;
}

interface HelpChapter {
  id: string;
  icon: LucideIcon;
  zh: ChapterCopy;
  en: ChapterCopy;
}

const CHAPTERS: HelpChapter[] = [
  {
    id: 'getting-started',
    icon: Rocket,
    zh: {
      title: '快速开始',
      body: `## 首次使用

启动 TPACowork 后会进入首次引导，可以选择界面语言与外观主题，并设置 AI 对你的基础了解（称呼、沟通风格、回复长度、技术水平）。这些信息会写入 USER.md，之后随时可在 \`设置 → 个性化\` 中修改。

## 新建对话

- 点击侧栏顶部的 **新建** 按钮开始一段新对话；
- 侧栏中会按"最近使用"展示你的工作空间与历史会话；
- 输入框支持 \`Enter\` 发送、\`Shift+Enter\` 换行。

## 配置模型

首次使用前需要在 \`设置 → 模型配置\` 中配置模型服务：

- 选择内置提供商并填入 API Key（或 OAuth 授权）；
- 添加自定义服务（OpenAI-compatible）时填写地址、密钥与模型列表；
- 在"使用"页为**对话模型**与**语音识别模型**分别设置默认模型。

配置完成后即可开始对话。`,
    },
    en: {
      title: 'Getting Started',
      body: `## First run

A first-run guide starts on launch: pick the interface language, appearance theme, and tell the assistant a little about you (name, communication style, response length, technical level). This is saved to USER.md and can be changed anytime under \`Settings → Personalization\`.

## New conversations

- Click **New** at the top of the sidebar to start a conversation;
- The sidebar lists your workspaces and recent conversations;
- \`Enter\` sends, \`Shift+Enter\` inserts a new line.

## Configure a model

Before chatting, configure a model service under \`Settings → Model Configuration\`:

- Pick a built-in provider and add an API key (or OAuth);
- Add a custom OpenAI-compatible service with base URL, key, and model list;
- Set the default **conversation** model and **speech recognition** model on the Use tab.

Then start your first conversation.`,
    },
  },
  {
    id: 'conversation',
    icon: FileText,
    zh: {
      title: '对话与输入',
      body: `## 输入框

- 底部输入框支持文字、文件/图片、语音输入；
- 点击 **+** 展开附加菜单：
  - **添加文件**：附带本地文件；
  - **专家团队**：选择后交给专家团队协作执行；
  - **技能**：可以输入/符号，显式附加技能；
  - **连接器**：可以输入@符号，附加 MCP 服务。

## 置顶摘要

点击会话头部右侧的 **置顶摘要** 按钮，可以在右侧悬浮显示当前任务的进度与产物，摘要不挤压会话内容（滚动条保持在最右侧）。

## 会话操作

- 悬停模型回复可 **复制**、**编辑**（修改后重新发送上一条用户消息）；
- 打开产物时，右侧会显示产物预览面板；展开可全屏查看。`,
    },
    en: {
      title: 'Chatting & Input',
      body: `## The composer

- Send text, attach files/images, or use voice input;
- Click **+** to open the attach menu:
  - **Add files or photos** — attach local files;
  - **Expert teams** — hand the task to an expert team;
  - **Skills** — explicitly attach skills (shown as tags);
  - **Connectors** — attach MCP services (shown as tags).

## Pinned summary

The **pinned summary** button in the conversation header floats the task progress and artifacts on the right without squeezing the conversation (the scrollbar stays at the window's right edge).

## Working with replies

- Hover a reply to **copy** or **edit** it (editing resends the previous user message);
- Opening an artifact shows the preview panel on the right; expand for fullscreen.`,
    },
  },
  {
    id: 'expert-teams',
    icon: Bot,
    zh: {
      title: '专家团队',
      body: `## 什么是专家团队

专家团队是多个扮演不同角色的专家协同完成任务的模式。工具箱中的 **专家团队** 页签可查看与启动团队。

## 团队组成

- **团队负责人 (Team Lead)**：统筹任务、交叉质证与汇总；
- **团队成员**：如业务分析师、财务分析师、行业分析师、风险分析师，各自按特定投资框架（如段永平、巴菲特、芒格、李录）分工；
- **数据源**：团队绑定 iFinD / 聚源 / 财汇等 MCP 数据源，单一来源不可用时自动切换。

## 使用方式

1. 在工具箱 → 专家团队中查看团队详情；
2. 点击 **启动团队** 开始新会话；
3. 也可以在输入框 + → 专家团队中选择，把当前消息交给团队执行。`,
    },
    en: {
      title: 'Expert Teams',
      body: `## What are expert teams

Expert teams run tasks collaboratively with multiple specialists in distinct roles. Open the **Expert Teams** tab in the toolbox to browse and launch teams.

## Team structure

- **Team Lead**: coordinates, cross-examines evidence, and compiles the final report;
- **Members**: e.g. business, financial, industry, and risk analysts, each following an investment framework (Duan Yongping, Buffett, Munger, Li Lu);
- **Data sources**: teams bind iFinD / Juyuan / Caihui MCP sources and fall back to an alternative when one is unavailable.

## How to use

1. Browse team details in Toolbox → Expert Teams;
2. Click **Start Team** to open a new conversation;
3. Or pick a team from the composer **+** menu to hand the current message to the team.`,
    },
  },
  {
    id: 'skills',
    icon: Sparkles,
    zh: {
      title: '技能',
      body: `## 技能管理

工具箱 → **技能** 页签管理技能：

- **内置技能**：随 TPACowork 提供（如 TPACoworkHub、记忆、天气等）；
- **我的技能**：工作区/项目技能，可上传、删除；
- 右侧开关启用/禁用技能；禁用后不再出现在候选列表。

## 使用技能

在输入框 **+** → 技能中选择，发送后消息气泡会显示技能 tag；也可以在文本中直接输入 \`/技能名\` 唤起。

## 创建技能

工具箱 → 技能 → **创建技能**，填写名称、触发描述与说明，保存后即可使用。技能格式为 Markdown 的 SKILL.md。`,
    },
    en: {
      title: 'Skills',
      body: `## Managing skills

The **Skills** tab in the toolbox manages skills:

- **Built-in**: shipped with TPACowork (e.g. TPACoworkHub, memory, weather);
- **My skills**: workspace/project skills that can be uploaded or deleted;
- The toggle enables/disables a skill; disabled skills leave the picker.

## Using a skill

Pick a skill from the composer **+** → Skills; the message shows the skill tag. You can also type \`/skill-name\` directly in the text.

## Creating skills

Toolbox → Skills → **Create Skill**: enter a name, trigger description, and body (a Markdown SKILL.md).`,
    },
  },
  {
    id: 'mcp',
    icon: Plug,
    zh: {
      title: 'MCP 连接器',
      body: `## 什么是 MCP

MCP (Model Context Protocol) 让 AI 调用外部数据与服务。工具箱 → **MCP 服务** 页签管理连接器。

## 预置与自定义

- **预置服务**：聚源、财汇、同花顺 iFinD 等开箱即用的数据服务；
- **自定义服务**：手动添加 OpenAI 兼容的 MCP 服务，支持 stdio / HTTP / SSE。

## 配置 HTTP 服务

添加自定义服务时填写：

- **服务名**：例如 docs；
- **地址**：MCP endpoint URL，如 \`https://example.com/mcp\`；
- **请求头**：JSON 格式，如 \`{"Authorization":"Bearer ..."}\`；
- **环境变量 / 超时**：可选。

保存后可点击 **测试** 验证连通性，再启用。

## 使用

在输入框 **+** → 连接器中选择 MCP 服务，发送后消息气泡显示对应 tag。`,
    },
    en: {
      title: 'MCP Connectors',
      body: `## What is MCP

MCP (Model Context Protocol) lets the assistant call external data and services. Manage connectors in the Toolbox → **MCP Servers** tab.

## Presets and custom servers

- **Presets**: ready-to-use data services such as Juyuan, Caihui, and iFinD;
- **Custom**: manually add OpenAI-compatible MCP servers over stdio / HTTP / SSE.

## Configuring an HTTP server

When adding a custom server, fill in:

- **Service name**, e.g. docs;
- **Base URL**, e.g. \`https://example.com/mcp\`;
- **Headers** as JSON, e.g. \`{"Authorization":"Bearer ..."}\`;
- **Environment / timeout** (optional).

Save, then **Test** connectivity before enabling.

## Usage

Pick an MCP service from the composer **+** → Connectors; the sent message shows the connector tag.`,
    },
  },
  {
    id: 'workspaces',
    icon: Globe2,
    zh: {
      title: '工作空间',
      body: `## 工作空间与项目

侧栏中的 **工作空间** 分组管理你的项目目录。每个工作空间有独立的会话、技能与权限控制：

- 项目技能需要授权后才可在该工作空间使用；
- 切换会话时项目列表保持稳定，不会因为切换而重新排序。

## 权限控制

- 工作空间内的文件/命令访问受沙箱与授权机制约束；
- 首次访问目录时会请求授权，可在"系统设置"中调整安全边界。

## 管理

在侧栏项目上点击更多菜单可重命名、打开位置或移除工作空间（移除只解除关联，不删除磁盘文件）。`,
    },
    en: {
      title: 'Workspaces',
      body: `## Workspaces & projects

The **Workspaces** group in the sidebar manages your project folders. Each workspace has its own conversations, skills, and permission control:

- Project skills require authorization to be usable in that workspace;
- The project list stays stable when switching conversations.

## Permissions

- File and command access in a workspace is governed by the sandbox and authorization rules;
- Access requests appear on first use; adjust safety boundaries in System Settings.

## Managing

Use the project's more menu to rename, reveal its location, or remove the workspace (removal only unlinks it; disk files are kept).`,
    },
  },
  {
    id: 'automations',
    icon: Timer,
    zh: {
      title: '自动化',
      body: `## 定时任务

侧栏中的 **自动化** 管理定时任务：

- 新建任务：填写任务名称、指令与执行频率（每小时/每天/每周/每月/自定义 cron）；
- 任务执行后可在 **执行记录** 中查看结果；
- 支持暂停/恢复与手动触发。

## 注意

自动化仅在应用打开且电脑未休眠时运行。`,
    },
    en: {
      title: 'Automations',
      body: `## Scheduled tasks

The **Automations** section in the sidebar manages scheduled tasks:

- Create a task with a name, instruction, and frequency (hourly/daily/weekly/monthly/custom cron);
- Review results in the **run history**;
- Pause, resume, or trigger manually.

## Note

Automations only run while the app is open and the computer is awake.`,
    },
  },
  {
    id: 'personalization',
    icon: UserRound,
    zh: {
      title: '个性化',
      body: `## 让 AI 更懂你

\`设置 → 个性化\` 提供两个文件的自定义：

- **助手人格 (SOUL.md)**：定义助手的性格与工作方式，每轮加载进系统提示；
- **用户画像 (USER.md)**：你的称呼、时区、偏好等信息。

修改后**下一条消息起生效**，无需重启；每个文件都可一键恢复内置默认模板。

## 常用场景

- 告诉 AI 你的沟通偏好（简洁/详细/看情况自适应）；
- 补充长期不变的背景信息，例如常用工具、关注的领域；
- 写入特殊要求，如"投资分析报告输出为 PDF"。`,
    },
    en: {
      title: 'Personalization',
      body: `## Help the assistant know you

\`Settings → Personalization\` lets you customize two files:

- **Assistant persona (SOUL.md)**: personality and working style, loaded into the system prompt every turn;
- **User profile (USER.md)**: your name, timezone, and preferences.

Changes take effect on the **next message** — no restart needed. Each file can be restored to the bundled default.

## Common use cases

- Tell the assistant your communication preferences (concise / detailed / adaptive);
- Record durable background info, such as tools you use or fields of interest;
- Add special instructions, e.g. "export investment reports as PDF".`,
    },
  },
  {
    id: 'settings',
    icon: Settings,
    zh: {
      title: '设置',
      body: `## 系统设置

\`设置 → 系统设置\`：

- 显示语言、外观主题（自动/浅色/深色）、字体大小；
- 默认工作空间位置、桌面通知。

## 模型配置

\`设置 → 模型配置\`：提供商/API Key/OAuth、自定义服务、默认模型（对话 + 语音识别）。

## 语音设置

\`设置 → 语音设置\`：默认 ASR 模型、启用语音输入、识别语言与最长录音时长。

## 快捷键

\`设置 → 快捷键\`：查看与自定义常用操作的快捷键，支持恢复默认。

## 账户与帮助

账户管理（PromptHub 登录）、帮助与反馈。`,
    },
    en: {
      title: 'Settings',
      body: `## System

\`Settings → System\`:

- Interface language, appearance (auto/light/dark), font size;
- Default workspace location, desktop notifications.

## Model Configuration

\`Settings → Model Configuration\`: providers/API keys/OAuth, custom services, default models (conversation + speech).

## Voice

\`Settings → Voice\`: default ASR model, enable voice input, recognition language, max recording length.

## Keyboard Shortcuts

\`Settings → Keyboard Shortcuts\`: view and customize shortcuts, restore defaults.

## Account & Help

Account (PromptHub sign-in) and Help & Feedback.`,
    },
  },
  {
    id: 'shortcuts',
    icon: Keyboard,
    zh: {
      title: '快捷键',
      body: `## 默认快捷键

| 操作 | 快捷键 |
| --- | --- |
| 新聊天 | \`Mod+N\` |
| 聚焦输入框 | \`Mod+K\` |
| 切换侧边栏 | \`Mod+B\` |
| 打开工具箱 | \`Mod+T\` |
| 打开设置 | \`Mod+, \` |

> \`Mod\` 在 macOS 为 \`Command\`，在 Windows/Linux 为 \`Ctrl\`。

自定义快捷键请在 \`设置 → 快捷键\` 中修改，按键需包含 Command/Ctrl。`,
    },
    en: {
      title: 'Keyboard Shortcuts',
      body: `## Default shortcuts

| Action | Shortcut |
| --- | --- |
| New chat | \`Mod+N\` |
| Focus composer | \`Mod+K\` |
| Toggle sidebar | \`Mod+B\` |
| Open toolbox | \`Mod+T\` |
| Open settings | \`Mod+,\` |

> \`Mod\` is \`Command\` on macOS and \`Ctrl\` on Windows/Linux.

Customize shortcuts under \`Settings → Keyboard Shortcuts\`; bindings must include Command/Ctrl.`,
    },
  },
];

export default function HelpManual({ onClose }: { onClose: () => void }) {
  const { locale } = useI18n();
  const isEn = locale === 'en-US';
  const [activeId, setActiveId] = useState(CHAPTERS[0].id);
  const active = CHAPTERS.find((chapter) => chapter.id === activeId) ?? CHAPTERS[0];
  const copy = isEn ? active.en : active.zh;

  return (
    <div
      data-help-manual
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-8 backdrop-blur-[1px] animate-in fade-in duration-150"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex h-[min(760px,calc(100vh-64px))] w-[min(1100px,calc(100vw-96px))] overflow-hidden rounded-2xl bg-white shadow-2xl">
        <aside className="flex w-[240px] shrink-0 flex-col border-r border-[#e6e0d7] bg-[#f7f6f2]">
          <div className="flex items-center gap-2.5 border-b border-[#e6e0d7] px-5 py-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#d97757]/15 text-[#b96346]">
              <BookOpenText className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold text-[#202020]">
                {isEn ? 'User Manual' : '使用手册'}
              </div>
              <div className="truncate text-[11px] text-[#8a867c]">TPACowork</div>
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto p-2">
            {CHAPTERS.map((chapter) => {
              const Icon = chapter.icon;
              const activeChapter = chapter.id === activeId;
              return (
                <button
                  key={chapter.id}
                  type="button"
                  onClick={() => setActiveId(chapter.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors',
                    activeChapter
                      ? 'bg-[#e8e6e1] text-[#202020]'
                      : 'text-[#5f5a50] hover:bg-[#efede8] hover:text-[#202020]',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 text-[#8a867c]" strokeWidth={1.8} />
                  <span className="truncate">{isEn ? chapter.en.title : chapter.zh.title}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-[#e6e0d7] px-6">
            <h2 className="truncate text-[15px] font-semibold text-[#202020]">{copy.title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={isEn ? 'Close' : '关闭'}
              className="grid h-8 w-8 place-items-center rounded-lg text-[#6f6f73] transition-colors hover:bg-[#efede8] hover:text-[#202020]"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
            <MarkdownRenderer content={copy.body} />
          </div>
        </div>
      </div>
    </div>
  );
}
