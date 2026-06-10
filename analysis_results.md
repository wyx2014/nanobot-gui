# Ruyi-Cowork 与 OpenClaw 浏览器搜索与交互能力对比分析

经过对 `Ruyi-Cowork` 项目代码库的深入分析（包括 [src/core/search/providers.ts](file:///Users/wyx/ai/Ruyi-Cowork/src/core/search/providers.ts) 和 `ruyi-chrome-extension` 等核心模块），我们发现了它在浏览器操作和网页检索方面与像 OpenClaw 这类专业 Agent 存在明显差距的原因。

以下是具体的对比分析和最亟待添加的功能建议：

## 一、 当前能力差距分析

### 1. 架构模式差异（被动插件 vs 主动控制）
- **Ruyi-Cowork**：采用 **Chrome 浏览器插件 (ruyi-chrome-extension)** + **WebSocket 通信桥 (ruyi-browser-bridge)** 的架构。这意味着 AI 必须依赖用户当前正打开的浏览器，受到极大的限制（如会干扰用户正在浏览的页面，无法在后台隔离运行）。
- **OpenClaw**：通常采用直接集成 **Playwright / Puppeteer** （或通过 CDP 协议通信）的 headless 浏览器模式。它可以自主开启隐身窗口、管理独立 Session，完全在后台静默完成多步复杂任务，不受用户当前浏览器状态的干扰。

### 2. 网页解析与 DOM 树理解深度
- **Ruyi-Cowork**：目前在 [content/index.ts](file:///Users/wyx/ai/Ruyi-Cowork/ruyi-chrome-extension/src/content/index.ts) 中的 [takeSnapshot](file:///Users/wyx/ai/Ruyi-Cowork/ruyi-chrome-extension/src/content/index.ts#63-158) 采用基础的 DOM 遍历（TreeWalker），提取前 200 个被认为是“可交互”的元素（button, input 等）。这种方式容易受现代前端框架（如虚拟 DOM、Shadow DOM）的影响，且提供给大模型的信息缺乏空间语义。
- **OpenClaw**：利用成熟的**无障碍树 (Accessibility Tree/AXTree)** 技术结合空间坐标转换，能够将网页还原为高度结构化、适合 LLM 理解的标记格式。

### 3. 直接内容提取能力 (Fast HTML-to-Markdown)
- **Ruyi-Cowork**：主要依赖插件在页面中执行 `extract_text`（获取 `innerText`），这种方式对于需要快速阅读大量文档（如长篇 API 文档）的场景效率较低，且包含大量无关导航文本（噪音大）。
- **OpenClaw**：内置诸如 `web_fetch` 等工具，通常集成了 `@mozilla/readability` 和 `turndown`，或者直接调用 Firecrawl / Jina Reader 这类服务。能够在几秒内将任何 URL 的主要正文提取为极其干净的 Markdown，这直接决定了其“查东西”时的信息信噪比和回答质量。

### 4. 视觉能力 (Vision-based Navigation)
- **Ruyi-Cowork**：目前实现了基础的 `screenshot` 功能，但主要是截图保存。
- **OpenClaw**：通常支持将截图配合带有数字编号的“边界框 (Bounding Box)”叠加层发给支持视觉的模型（如 GPT-4o 或 Claude 3.5 Sonnet），让模型通过“看”来决定点击哪个坐标。这在处理复杂、非标准 DOM 结构的网站时降维打击了纯基于 DOM 的方法。

---

## 二、 最需要补充的核心功能 (Top Priority Features)

如果想要让 Ruyi-Cowork 在“查资料”和“网页交互”上达到甚至超越 OpenClaw 的体验，最需要优先加入以下几个功能：

### 1. 引入极速网页正文提取工具 (Jina/Firecrawl/Readability)
**为什么需要**：搜索资料时，**90% 的场景只需要阅读内容**，不需要复杂的 DOM 点击。
**实现方案**：在 [src/core/tools/builtins.ts](file:///Users/wyx/ai/Ruyi-Cowork/src/core/tools/builtins.ts) 中新增一个独立的 `web_fetch` 工具，通过调用 Jina Reader API（如 `https://r.jina.ai/URL`）或在本地使用 Readability.js 剔除页面侧边栏和广告，直接返回纯 Markdown。这会让 AI 查资料的总结能力瞬间提升一个档次。

### 2. 将 DOM Snapshot 升级为 Accessibility Tree 解析
**为什么需要**：提升 AI 在页面中找按钮、填表单的准确率。
**实现方案**：优化 [ruyi-chrome-extension/src/content/index.ts](file:///Users/wyx/ai/Ruyi-Cowork/ruyi-chrome-extension/src/content/index.ts)，不要简单粗暴地遍历 DOM，而是构建一颗精简的交互树，甚至可以在每个交互元素旁标注一个唯一的短字母（如 `[A] 登录`, `[B] 忘记密码`），LLM 直接输出对应的字母指令进行点击。

### 3. （进阶）脱离插件依赖的后台浏览器控制
**为什么需要**：提供真正“全自动”的后台代办体验。
**实现方案**：在基于 Tauri 的 Rust 后端集成基础的 WebDriver/CDP（Chrome DevTools Protocol）控制能力，允许 AI 后台启动一个隔离的无头浏览器进程去做抓取和操作，完成后直接返回结果，完全不影响用户当前的 Chrome。

### 总结
您当前感觉到“查东西效果弱”，最大的瓶颈在于：**缺乏一个将网页杂乱 HTML 转化为高纯度 Markdown （正文提取）的专属工具**。目前 AI 看到的要么是纯文本堆砌（噪音太大），要么搜索结果只有 Snippet（信息太少）。优先解决 **“网页正文静默提取”**，效果会有立竿见影的提升！
