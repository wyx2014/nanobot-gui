# PDF 生成 Pipeline Spec

## 概述

PDF 生成必须作为确定的 artifact pipeline 处理，不能让模型在用户等待时临场探索工具链。

目标：

- 用户请求“生成 PDF”时，常规报告类任务应在可预期时间内产出文件。
- 缺少 PDF 依赖或渲染失败时，快速返回可用的 Markdown/HTML 中间产物和明确错误。
- 禁止在一次用户请求中执行 `brew install`、大型 `pip install`、`npm install` 等临时依赖安装。
- GUI 只负责发起请求、展示进度、预览文件；PDF 生成权威在 nanobot/gateway。

非目标：

- 不在 GUI 侧重新实现本地执行引擎。
- 不把 PDF 生成做成模型自由选择的任意 shell 流程。
- 不追求第一版支持复杂排版编辑器、Office 兼容转换或任意网页打印。

## 问题背景

当前慢任务的典型失败链路：

1. Agent 收集资料并写出 Markdown。
2. 发现 `pandoc` 不存在。
3. 尝试安装 `pandoc`，安装超时。
4. 尝试 `weasyprint` / `pango` 等额外依赖。
5. 尝试 Playwright HTML 转 PDF。
6. 生成异常小的 PDF，或页面为空白。
7. Agent 继续自我修复，长时间没有 `turn_end`。

这个问题的根因不是 GUI 慢，而是 PDF 生成缺少固定、可失败、可观测的 pipeline。

## 设计原则

- **固定路径**：报告类 PDF 只走内置 PDF 工具，不由模型临场选择。
- **内容与渲染分离**：先生成结构化内容，再渲染 PDF。
- **无临场安装**：运行中发现依赖缺失时直接失败并返回中间产物。
- **短超时**：PDF 渲染和校验必须有硬超时。
- **有限重试**：同一渲染错误最多重试 1 次。
- **可观测**：每个阶段都要通过 WebSocket progress 上报。
- **可降级**：PDF 失败不应丢失已生成内容。

## 用户行为

### 成功路径

用户请求：

```text
帮我写一篇青岛啤酒的研报，pdf就行
```

期望行为：

1. Agent 收集必要资料。
2. Agent 写出中间 Markdown。
3. Gateway 调用固定 PDF 生成工具。
4. Gateway 校验 PDF 非空、可读取、有页数。
5. GUI 展示最终 PDF 文件。

### 失败路径

如果 PDF 渲染失败：

1. GUI 不应无限显示运行中。
2. Assistant 应返回：
   - 已完成的 Markdown/HTML 文件路径。
   - PDF 失败原因。
   - 下一步建议。
3. 会话必须收到 `turn_end`。

示例回复：

```text
研报内容已完成，但 PDF 渲染失败：缺少 reportlab。

已保存 Markdown：
/Users/wyx/ai/wyb/output/青岛啤酒深度研究报告.md

安装 PDF 运行时后可重新生成 PDF。
```

## 架构边界

### GUI

GUI 负责：

- 发送用户请求。
- 展示阶段进度。
- 展示生成文件。
- 预览 PDF。
- 在失败时展示错误和可用中间产物。

GUI 不负责：

- 调用 pandoc/weasyprint/reportlab。
- 选择 PDF 后端。
- 执行 shell 转换。
- 管理 PDF 依赖安装。

### nanobot/gateway

nanobot 负责：

- 决定是否需要生成 PDF。
- 调用 PDF artifact tool。
- 控制超时和重试。
- 校验 PDF。
- 持久化中间产物和最终产物。
- 通过 WebSocket 上报 progress/file_edit/turn_end。

## Pipeline

### 阶段 1：内容生成

输出稳定中间文件：

```text
output/<slug>.md
```

要求：

- Markdown 必须完整可读。
- 表格使用标准 Markdown 表格。
- 图片和图表可选；第一版不阻塞 PDF。
- 文件写入后立即发送 `file_edit` 或 progress。

阶段超时建议：

```text
资料收集：120s
正文生成：120s
```

### 阶段 2：渲染输入规范化

将 Markdown 转为内部结构或 HTML。

当前实现路径：

- Markdown 文本直接喂给 `reportlab` 渲染器。
- 支持标题、段落、无序列表、简单表格、分页。
- 支持基础 inline Markdown：
  - `**bold**` 转为粗体显示，不保留 `**`。
  - `*italic*` 转为斜体显示，不保留 `*`。
  - `` `code` `` 去掉反引号，按普通文本显示。
- 忽略 Markdown 水平线：
  - `---`
  - `***`
  - `___`
- Markdown 表格分隔行不会渲染为正文。
- 无序列表使用稳定的 `•` 符号，避免异常控制字符。
- 不支持复杂 CSS。
- 不支持完整 CommonMark、嵌套列表、代码块、图片、链接样式、脚注。

避免第一版引入：

- pandoc
- weasyprint
- wkhtmltopdf
- 临时 Chromium 安装

### 阶段 3：PDF 渲染

首选后端：

```text
Python reportlab
```

字体策略：

- 优先注册可嵌入的本机中文字体：
  - macOS: `/System/Library/Fonts/STHeiti Light.ttc`
  - macOS bold: `/System/Library/Fonts/STHeiti Medium.ttc`
- 如果本机字体不可用，降级到 ReportLab 内置 `STSong-Light`。
- 当前实现不使用 `PingFang.ttc`，因为 ReportLab 对该 TTC 的 PostScript outlines 支持不稳定。
- 标题样式使用 bold 字体；正文、表格、列表使用 regular 字体。

输入：

```json
{
  "source_path": "output/青岛啤酒深度研究报告.md",
  "output_path": "output/青岛啤酒深度研究报告.pdf",
  "title": "青岛啤酒深度研究报告",
  "template": "research_report"
}
```

输出：

```json
{
  "ok": true,
  "pdf_path": "output/青岛啤酒深度研究报告.pdf",
  "page_count": 8,
  "file_size": 245120
}
```

渲染超时：

```text
30s
```

重试规则：

- 渲染异常：最多重试 1 次。
- 校验失败：最多重试 1 次。
- 依赖缺失：不重试。
- 权限错误：不重试。

### 阶段 4：PDF 校验

最低校验：

- 文件存在。
- 文件大小大于 1KB。
- 页数大于 0。
- 能通过 `pypdf` 打开。
- 至少能从第一页提取少量文本。
- 提取文本不应包含未清理的 Markdown 标记：
  - `**`
  - `---`
  - 异常控制字符。

推荐校验：

- `pdfinfo` 读取页数。
- `pdftoppm` 渲染第一页 PNG。
- 检查第一页 PNG 不是空白。

第一版如果没有 Poppler：

- 不安装 Poppler。
- 只做 `pypdf` 校验。
- progress 中标记 `visual_check: skipped`。

## PDF Tool Contract

建议在 nanobot 中提供一个固定工具：

```text
create_pdf
```

### 输入

```ts
interface CreatePdfInput {
  sourcePath: string;
  outputPath?: string;
  title?: string;
  template?: "research_report" | "simple";
  timeoutSeconds?: number;
}
```

### 输出

```ts
interface CreatePdfOutput {
  ok: boolean;
  pdfPath?: string;
  sourcePath: string;
  pageCount?: number;
  fileSize?: number;
  error?: {
    code:
      | "dependency_missing"
      | "render_timeout"
      | "render_failed"
      | "validation_failed"
      | "permission_denied";
    message: string;
  };
}
```

### 错误语义

`dependency_missing`

- 缺少 `reportlab`、`pypdf` 等内置运行时依赖。
- 不尝试安装。
- 返回 sourcePath。

`render_timeout`

- 渲染超过 30 秒。
- 杀掉子进程。
- 返回 sourcePath。

`validation_failed`

- PDF 存在但为空、页数为 0、文件过小或无法打开。
- 最多重试 1 次。

`permission_denied`

- 输出路径不在允许目录。
- 不重试。

## WebSocket Progress

PDF pipeline 应上报明确阶段。

示例：

```json
{
  "event": "message",
  "kind": "progress",
  "text": "正在生成 Markdown 报告..."
}
```

```json
{
  "event": "message",
  "kind": "progress",
  "text": "正在渲染 PDF..."
}
```

```json
{
  "event": "message",
  "kind": "progress",
  "text": "正在校验 PDF..."
}
```

失败示例：

```json
{
  "event": "message",
  "kind": "progress",
  "text": "PDF 渲染失败，已保留 Markdown 文件。"
}
```

最终无论成功失败都必须发送 `turn_end`。

## Agent Policy

当用户要求 PDF 时，Agent 必须遵守：

- 可以生成 Markdown。
- 可以调用 `create_pdf`。
- 不可以调用 `brew install pandoc`。
- 不可以调用 `pip install weasyprint`。
- 不可以反复尝试多个 PDF 转换器。
- 不可以因为 PDF 失败而丢弃已完成内容。
- 不可以在 PDF 校验失败后无限自我修复。

推荐系统提示规则：

```text
For PDF generation, use the create_pdf tool. Do not install PDF conversion
dependencies during a user turn. If create_pdf fails, return the source
document path and the error instead of trying unrelated converters.
```

## 默认模板

### `simple`

支持：

- 标题
- 一级/二级标题
- 段落
- 无序列表
- 简单表格
- 基础 inline bold/italic/code 清理
- Markdown 水平线清理
- 中文字体 fallback

### `research_report`

当前第一版行为：

- 不强制插入封面分页，避免生成接近空白的尾页或中间页。
- 暂时与 `simple` 共享同一套渲染器。

后续可增强：

- 封面标题
- 报告日期样式
- 目录
- 页眉
- 页脚页码
- 风险提示区块

## 路径规则

默认输出目录：

```text
<workspace>/output/
```

文件命名：

```text
<title>.md
<title>.pdf
```

如果标题含非法字符：

- 保留中文。
- 替换 `/ : * ? " < > |` 为 `_`。
- 限制文件名长度。

禁止输出到：

- 系统目录。
- 用户 home 根目录。
- MCP 自己的临时 allowed root 之外但未授权目录。

## 超时预算

建议默认：

| 阶段 | 超时 |
| --- | ---: |
| 资料收集 | 120s |
| 正文生成 | 120s |
| Markdown 写入 | 5s |
| PDF 渲染 | 30s |
| PDF 校验 | 10s |
| 总任务软上限 | 300s |

超过总任务软上限：

- 停止继续工具探索。
- 返回已完成文件。
- 发送 `turn_end`。

## 验收标准

### 成功场景

给定一个 3-8 页 Markdown 研报：

- 30 秒内生成 PDF。
- PDF 文件大于 1KB。
- 页数大于 0。
- `pypdf` 可以打开。
- 第一页可以提取文本。
- 提取文本不包含 `**`、`---` 或异常控制字符。
- 中文正文可读，不能显示为方框、问号或乱码。
- GUI 能预览 PDF。
- 会话收到 `turn_end`。

### 缺依赖场景

当 `reportlab` 不可用：

- 不执行安装命令。
- 10 秒内返回 `dependency_missing`。
- 返回 Markdown 路径。
- 会话收到 `turn_end`。

### 空白 PDF 场景

当 PDF 文件小于 1KB、页数为 0 或第一页无可提取文本：

- 标记 `validation_failed`。
- 最多重试 1 次。
- 仍失败则返回 Markdown 路径。
- 会话收到 `turn_end`。

### 权限场景

当输出路径被拒绝：

- 不换多个无关路径试探。
- 返回 `permission_denied`。
- 建议用户选择工作区内路径。
- 会话收到 `turn_end`。

## 实现建议

最小实现：

1. 在 nanobot 增加 `create_pdf` 工具。
2. 使用 `reportlab` 直接渲染 Markdown 子集。
3. 使用 `pypdf` 做基础校验。
4. 固定 30 秒渲染超时。
5. 禁止 agent 在 PDF 任务中安装依赖。
6. GUI 只消费现有 file/progress/turn_end 事件。

后续增强：

- 加 Poppler 页面渲染校验。
- 加图表嵌入。
- 加目录。
- 加 PDF 模板主题。
- 加页眉、页脚、页码。
- 加完整 Markdown parser，替代当前轻量解析器。
- 加 HTML 转 PDF 后端，但必须作为预装后端，不允许临场安装。

## 明确禁止

以下行为不允许出现在 PDF 生成任务中：

```bash
brew install pandoc
pip install weasyprint
pip install pango
npm install puppeteer
```

除非用户明确要求“帮我安装 PDF 依赖”，否则 agent 不应执行安装。

## 当前事故映射

这次慢任务对应的应处理方式：

- `pandoc` 不存在：直接跳过，不安装。
- `brew install pandoc`：禁止。
- `weasyprint/pango`：禁止临场安装。
- Playwright PDF 生成 865 bytes：`validation_failed`。
- 页面是 `about:blank`：不继续无限重试。
- 返回 `/Users/wyx/ai/wyb/output/青岛啤酒深度研究报告.md`。
- 明确告诉用户 PDF 失败原因。
- 发送 `turn_end`。
