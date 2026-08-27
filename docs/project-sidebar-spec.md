# Project Sidebar Spec

## 背景

当前 GUI 里“项目”本质只是 `workspacePath` / `workspaceScope.project_path`，主要出现在输入框底部的目录选择器里。用户视角下这不是一个稳定的项目入口，也不方便按项目找历史会话。

目标是把文件目录提升为 GUI 的“项目”组织维度：左侧边栏显示项目列表，项目下面显示该项目的会话；没有绑定项目的会话放在普通“对话”分组下。

## 目标

1. 左侧边栏从“最近”改为“项目 + 对话”。
2. 项目分组显示在对话分组上方。
3. 无项目会话显示在“对话”分组下。
4. 有项目会话按项目分组显示。
5. 每个项目默认最多展示 5 个会话，超过 5 个显示“展开”入口。
6. 点击项目下的会话进入详情后，底部输入框不再显示“选择项目”功能。
7. 新建或选择项目后，该项目成为后续新会话的项目上下文。
8. 用户主动加入过的项目，即使其下没有会话，也应继续显示在项目列表中。
9. 项目标题行提供展开/收起、更多菜单和项目内新建对话入口。

## 非目标

1. 不引入 GUI 本地 agent 执行能力。
2. 不把项目做成复杂数据库实体。
3. 不实现团队协作、项目成员、项目权限管理。
4. 不改变 nanobot 的工具执行权威边界。
5. 不支持项目封面、颜色、成员、权限等重型项目管理能力。

## 术语

- **对话**：没有绑定 `workspacePath` / `workspaceScope.project_path` 的普通会话。
- **项目**：一个本地目录路径在 GUI 中的展示实体。
- **项目会话**：绑定了项目路径的会话。
- **当前项目上下文**：用户当前在边栏选中的项目，或当前会话所属项目。
- **默认工作目录**：nanobot 自动使用的 fallback 工作目录，例如 `workspace`。它不是用户主动选择的项目。

## 数据模型

第一版不新增独立项目表，项目列表从最近项目路径和已有会话元数据共同派生。

会话已有字段：

```ts
workspacePath?: string | null;
workspaceScope?: WorkspaceScopePayload | null;
```

项目派生规则：

```ts
projectPath = conversation.workspaceScope?.project_path ?? conversation.workspacePath ?? null
projectName = conversation.workspaceScope?.project_name ?? basename(projectPath)
```

同一路径视为同一个项目。

左侧“项目”分组来源：

- 先读取 `workspaceStore.recentPaths`，作为项目基础列表。
- 再读取会话中的 `workspaceScope.project_path` / `workspacePath`，把会话挂到对应项目下。
- 如果某个项目下的会话都被删除，只要该项目仍在 `recentPaths`，左侧项目仍显示。
- 项目下没有会话时，展开状态下显示“暂无对话”。
- “移除项目”只从 `recentPaths` 和本地项目展示名中移除，不删除磁盘目录，也不删除会话。

默认工作目录不视为项目：

- 如果会话绑定的是 nanobot 默认工作目录，归入“对话”。
- 第一版可以用目录名 `workspace` 识别默认工作目录。
- 后续更稳的方式是从 gateway 的 `workspaces.default_scope.project_path` 读取默认路径并排除。

路径归一化：

- macOS/Linux：保持大小写，去掉末尾 `/`。
- Windows：路径分隔符统一为 `/`，盘符大小写归一。

项目展示名：

- 默认从路径 basename 派生。
- 用户重命名项目时，只保存 GUI 本地展示名，不重命名磁盘目录。

## 边栏结构

```text
新建对话
定时任务
工具箱

项目
  青岛啤酒研究
    会话 1
    会话 2
    会话 3
    会话 4
    会话 5
    展开 3 个更多

  nanobot-gui
    会话 1

对话
  无项目会话 A
  无项目会话 B
```

## 项目行 UI

项目行参考 Codex 左侧项目效果：

- 左侧使用项目/文件夹图标；展开和收起状态使用不同图标。
- 展开/收起箭头紧跟项目名右侧。
- 展开/收起箭头、`...` 更多按钮、编辑按钮默认隐藏，鼠标 hover 项目行时显示。
- `...` 菜单包含：
  - 打开位置
  - 重命名项目
  - 移除
- 编辑按钮直接创建一个新对话并回到首页，输入框下方默认选择该项目。
- 项目行点击项目名区域只负责展开/收起，不自动打开最近会话。

## 排序

对话分组：

- 按 `updatedAt` 降序。

项目分组：

- 项目按该项目下最近会话的 `updatedAt` 降序。
- 项目内会话按 `updatedAt` 降序。

## 展开规则

每个项目默认展示最多 5 个会话。

超过 5 个时显示：

```text
展开 N 个更多
```

点击后显示该项目全部会话，并把入口改为：

```text
收起
```

展开状态只保存在 GUI 内存状态即可，不需要持久化。

## 交互

### 点击项目

点击项目标题：

- 展开/收起该项目的会话列表。
- 不自动创建新会话。
- 不自动切换到最近会话。

### 点击项目下会话

点击项目会话：

- 打开该会话。
- 当前输入框继承该会话项目上下文。
- 输入框底部不显示“选择项目”控件。

### 点击无项目会话

点击“对话”分组下会话：

- 打开该会话。
- 输入框可以显示“选择项目”控件。

### 新建对话

点击全局“新建对话”：

- 默认进入无项目对话状态。
- 输入框显示“选择项目”。

项目标题右侧编辑按钮用于项目内新建对话：

- 在该项目下创建新会话。
- 新会话自动绑定项目路径。
- 回到聊天首页。
- 输入框下方默认选择该项目。
- 首页标题显示：

```text
我们应该在 xxx 中构建什么？
```

其中 `xxx` 是项目展示名。

### 项目下无会话

如果项目仍存在于 `recentPaths`，但其下没有会话：

- 项目仍显示在“项目”分组。
- 展开状态下显示“暂无对话”。
- 收起状态下只显示项目行。

这保证“项目列表”和“选择项目列表”的来源一致：用户主动加入过的项目不会因为最后一个会话被删除而突然消失。

### 项目更多菜单

点击项目行右侧 `...`：

- 打开位置：调用 Electron shell 在系统文件管理器中定位项目目录。
- 重命名项目：只修改 GUI 本地展示名，不重命名磁盘目录。
- 移除：从本地项目列表移除该项目，不删除目录，不删除已有会话。

## 输入框项目选择器显示规则

输入框底部项目选择器只在以下情况显示：

1. 当前没有 active conversation。
2. 当前 active conversation 没有项目。

以下情况隐藏：

1. 当前会话来自项目分组。
2. 当前会话已经有 `workspacePath` 或 `workspaceScope.project_path`。

隐藏不代表丢失项目上下文；发送消息时仍应使用当前会话的 `workspaceScope`。

## “不使用项目”行为

在无项目输入场景中，用户选择“不使用项目”：

- 清空 GUI 当前 draft project。
- 输入框回到 `Choose project` / `选择项目` 缺省状态。

在项目会话中：

- 第一版不显示“不使用项目”入口。
- 如果未来支持从项目中移除会话，需要明确同步到 nanobot session metadata，不能只改 GUI 状态。

## 项目选择器

输入框底部的项目选择器用于无项目草稿或无项目会话。

下拉结构：

```text
搜索项目

项目列表

新建项目 >
  新建空白项目
  使用现有文件夹

不使用项目
```

要求：

- 保留“新建项目”的二级菜单，不合并成单个入口。
- 鼠标从“新建项目”移动到右侧二级菜单时，子菜单不能因为 hover 间隙消失；右侧菜单应紧贴父菜单或有可 hover 的桥接区域。
- “使用现有文件夹”打开系统目录选择器，并将选中的目录加入项目列表。
- “不使用项目”清空当前 draft project，按钮回到 `Choose project` / `选择项目` 缺省状态。

### 新建空白项目

点击“新建空白项目”：

- 不打开系统目录选择器。
- 弹出应用内命名对话框，样式参考 Codex：
  - 标题：`为项目命名`
  - 副标题：`保持简短且易识别`
  - 输入框默认选中 `New project`
  - 按钮：取消 / 保存
- 保存后在默认项目根目录下创建文件夹，并自动选择该项目。

默认项目根目录：

```text
Documents/TPCowork Projects/
```

最终项目路径：

```text
Documents/TPCowork Projects/<项目名>
```

目录名中的非法路径字符需要做最小清理，例如替换 `/ \ : * ? " < > |`。

## nanobot 边界

GUI 仍然只负责组织和展示。

执行时：

- 会话绑定项目后，发送消息继续通过 WebSocket 的 `workspace_scope` 传给 nanobot。
- nanobot 仍是执行、安全策略、工具调用的 source of truth。
- GUI 不重新引入本地工具执行。

第一版可以继续使用已有 `workspaceScope` 字段，不新增 gateway API。

## 项目技能绑定

### 背景

技能分为两类：

- **内置技能**：系统自带的通用能力，数量较少，例如 PDF、文档、表格、演示文稿等。
- **我的技能**：用户安装或创建的技能，数量可能很多，且更偏项目或业务场景。

如果所有“我的技能”都默认参与 nanobot 自动触发，用户安装几十到上百个技能后，会增加误触发、重名冲突和上下文污染风险。

### 目标

1. 内置技能对所有项目、所有会话默认可用。
2. “我的技能”默认不全局参与自动触发。
3. 每个项目可以绑定一组“我的技能”。
4. 项目会话中，nanobot 默认只在“全部内置技能 + 当前项目绑定的我的技能”中触发。
5. 用户本轮从输入框 `+ -> 技能` 显式选择的技能，仍可临时参与本轮触发。

### 非目标

1. 不做复杂的技能权限系统。
2. 不做团队级技能分发。
3. 不把内置技能加入项目绑定列表；内置技能始终全局可用。
4. 不在第一版实现技能优先级编辑、技能分组编辑或项目模板。

### 触发范围

当前会话可触发技能集合：

```text
全部内置技能
+ 当前项目绑定的我的技能
+ 当前轮用户显式选择的技能
```

无项目会话：

```text
全部内置技能
+ 当前轮用户显式选择的技能
```

不应把所有“我的技能”无条件加入自动触发候选集合。

### 优先级

当同一个意图可能命中多个技能时：

```text
当前轮显式选择的技能 > 当前项目绑定的我的技能 > 内置技能
```

如果存在同名技能：

- UI 搜索结果必须显示来源，例如 `内置` / `我的`。
- nanobot 执行时应尽量使用稳定 skill id，而不是只使用 `/name`。
- 第一版如果 gateway 仍只支持 `/name`，至少在 GUI 侧提示同名风险，避免静默选错。

### 项目管理入口

项目技能绑定入口放在左侧项目行 `...` 菜单中：

```text
打开位置
管理技能
移除
```

点击“管理技能”：

- 弹出轻量对话框。
- 顶部显示项目名。
- 列出“我的技能”。
- 支持搜索。
- 使用 checkbox 多选。
- 点击保存后更新该项目绑定技能。

内置技能不显示在该对话框中。

### 数据模型

第一版保存在 GUI 本地 workspace store 中，按项目路径绑定：

```ts
projectSkillBindings: Record<string, string[]>
```

其中：

- key 是归一化后的项目路径。
- value 是绑定的“我的技能”稳定 id 列表。

如果当前 discovery 数据暂时没有稳定 id，可以短期使用技能名：

```ts
projectSkillBindings: Record<string, string[]>
```

但 gateway 支持后应迁移为稳定 id，避免重名技能触发错误。

### 发送消息

GUI 发送项目会话消息时，应把当前项目绑定技能传给 nanobot。

建议 payload 增加结构化字段：

```ts
selectedSkills?: Array<{
  id: string;
  name: string;
  source: 'builtin' | 'user';
  explicit?: boolean;
}>;
```

规则：

- 内置技能可以由 nanobot 默认注入，不需要 GUI 每次全量发送。
- 项目绑定的“我的技能”应作为项目上下文发送或由 gateway 根据项目读取。
- 本轮显式选择的技能标记 `explicit: true`。

短期兼容方案：

- 如果 gateway 仍只识别 `/skill-name`，GUI 可以继续在消息前拼接显式选择技能。
- 项目绑定技能不建议拼进用户文本；应优先走结构化字段或 gateway 项目配置，否则用户看不见的隐式 `/skill` 会污染 prompt。

### UI 验收标准

1. 项目 `...` 菜单出现“管理技能”。
2. “管理技能”只展示“我的技能”，不展示内置技能。
3. 支持搜索“我的技能”。
4. 支持多选绑定和取消绑定。
5. 保存后重新打开对话框，绑定状态保持。
6. 项目会话中，技能候选范围包含全部内置技能和该项目绑定的我的技能。
7. 无项目会话中，技能候选范围不自动包含所有我的技能。
8. 本轮显式选择的技能仍能触发。
9. 同名技能至少在 UI 中显示来源，不能让用户看不出选中的是哪个。

## 兼容旧会话

旧会话迁移规则：

- 有 `workspaceScope.project_path`：归入对应项目；如果该项目不在 `recentPaths`，也临时显示为项目。
- 没有 `workspaceScope.project_path` 但有 `workspacePath`：归入对应项目；如果该项目不在 `recentPaths`，也临时显示为项目。
- 两者都没有：归入“对话”。
- 如果路径是默认工作目录，例如 `workspace`：归入“对话”。

无需数据迁移脚本，边栏渲染时派生即可。

## i18n

新增文案：

```ts
sidebar.conversations = "对话" / "Conversations"
sidebar.projects = "项目" / "Projects"
sidebar.expandProjectConversations = "展开显示" / "Show more"
sidebar.collapseProject = "收起" / "Collapse"
sidebar.noSessionsYet = "暂无会话" / "No sessions yet"
sidebar.projectMore = "项目操作" / "Project actions"
sidebar.newProjectConversation = "在此项目中新建对话" / "New conversation in this project"
sidebar.openProjectLocation = "打开位置" / "Open location"
sidebar.renameProject = "重命名项目" / "Rename project"
sidebar.removeProject = "移除" / "Remove"
folder.nameProject = "为项目命名" / "Name project"
folder.nameProjectHint = "保持简短且易识别" / "Keep it short and easy to identify"
folder.defaultProjectName = "New project" / "New project"
```

原 `recents` 可以保留兼容，但新 UI 不再使用。

## 实现建议

新增一个纯派生 helper：

```ts
groupConversationsByProject(conversations): {
  unprojected: Conversation[];
  projects: Array<{
    path: string;
    name: string;
    conversations: Conversation[];
    latestUpdatedAt: number;
  }>;
}
```

放置建议：

```text
src/core/projectGrouping.ts
```

或如果只被 Sidebar 使用，也可以先放在：

```text
src/components/sidebar/projectGrouping.ts
```

优先少文件；项目列表仍复用 `workspaceStore.recentPaths`，只额外持久化 `projectNames` 用于本地展示名。

## 测试

最小测试覆盖：

1. 无项目会话进入 `unprojected`。
2. 同一路径的多个会话归入同一个项目。
3. 项目按最近更新时间排序。
4. 项目内会话按最近更新时间排序。
5. 超过 5 个会话时默认只显示 5 个，并计算剩余数量。
6. 项目会话打开后输入框不显示项目选择器。
7. 无项目会话打开后输入框显示项目选择器。
8. `recentPaths` 中的空项目仍显示，并在展开时显示“暂无对话”。
9. `workspace` 不进入项目列表。
10. “不使用项目”能清空 draft project。

## 验收标准

1. 左侧不再显示“最近”，改为“项目”和“对话”。
2. “项目”分组显示在“对话”分组上方。
3. 无项目会话显示在“对话”分组。
4. 有项目路径的会话显示在“项目”分组对应项目下。
5. 默认工作目录 `workspace` 下的会话显示在“对话”，不显示为项目。
6. 每个项目默认最多显示 5 个会话。
7. 超过 5 个的项目有展开/收起行为。
8. 打开项目会话后，输入框底部不显示选择项目控件。
9. 打开无项目会话或新建无项目对话时，输入框仍显示选择项目控件。
10. 删除某项目下最后一个会话后，只要项目仍在 `recentPaths`，项目仍显示，并在展开时显示“暂无对话”。
11. 项目行 hover 时显示展开/收起箭头、`...` 更多按钮和编辑按钮。
12. `...` 菜单支持打开位置、重命名项目、移除项目。
13. 点击项目行编辑按钮后回到首页，输入框默认选择该项目，首页标题显示“我们应该在 xxx 中构建什么？”。
14. 项目选择器保留“新建项目”的二级菜单。
15. “新建空白项目”弹出命名对话框，并在 `Documents/TPCowork Projects/<项目名>` 创建目录。
16. 鼠标从“新建项目”移动到右侧二级菜单时，菜单不应闪退。
17. `npm run build` 通过。
