# 演示文稿模板

聊天输入框的「+ → 制作演示文稿」打开模板库。用户先选视觉风格与交付格式，再发送主题或资料。
默认先做 3 页样稿；确认风格后，从「本会话文稿」选择原文稿继续完善，也可指定修改页码。

| 模板 | 交付格式 | 生成方式 |
| --- | --- | --- |
| 中国太平标准 | 可编辑 PPTX，可选 PDF 预览 | 公司母版 + CorporateDeck YAML |
| 归藏电子杂志 | HTML 网页演示 | 归藏原生 HTML 样式与播放脚本 |
| 归藏瑞士极简 | HTML 网页演示 | Swiss 固定版式，导出前执行版式校验 |
| Kimi 海蓝研究、湖蓝备忘录、蓝焰品牌、银灰杂志 | 可编辑 PPTX，可选 PDF 预览，保留 PPTD 源文件 | 内置设计规范 + 本地 python-pptx 渲染 |

Kimi 主题是设计规范，由 Agent 据此编写页面；它与中国太平的固定公司母版不是同一种模板。
样稿用于确认实际排版效果。归藏目前不承诺输出可编辑 PPTX。

## 数据与执行

- GUI 只维护选择、输入草稿、待发送队列和界面预览，执行与文稿索引由 Python gateway 持有。
- WebSocket `presentation` 参数包含 `template_id`、`document_id`、`sample_first` 和可选 `page`。
- gateway 验证会话所有权，在当前项目 `presentations/<document_id>/` 建立文稿。
- 模板脚本、设计规范与资源复制到 `.source/`，并记录内容摘要。后续导出使用该快照。
- 更换模板需创建新的文稿 ID，原文稿继续保留。
- `export_presentation` 根据文稿绑定选择导出流程；输出验证成功后才替换最终文件并登记附件。
- 失败的重新导出保留上一份成功结果。源文件的页面修改由 Agent 完成，页码要求进入当前轮指令。
- 消息重试、历史回放和输入草稿都保留选择；文稿列表从 gateway 读取。

gateway 接口：

```text
GET /api/presentations/templates
GET /api/presentations/previews?template_id=...
GET /api/presentations/documents?chat_id=...
```

这些接口需要 gateway token。
模板列表只包含封面缩略图，进入详情后才读取完整预览。内置太平与 Kimi 使用预制缩略图，
外部模板预览按文件路径、修改时间和大小缓存；太平预制图还校验母版内容摘要。
归藏预览在后台生成并缓存，`previews_pending` 表示界面需要稍后刷新。
GUI 缓存上次模板列表，重开立即显示并后台更新；文稿列表仅在切换到对应视图时读取。
后台刷新不禁用模板选择，实际提交仍由 gateway 验证模板可用性和文稿绑定。

## 外部技能与依赖

中国太平和四套 Kimi 主题随 nanobot 内置，安装后即可选择。归藏从工作区或内置技能目录自动发现，
模板库不提供手动选择技能目录的入口。支持通过环境变量配置归藏目录或覆盖 Kimi 设计规范：

```text
NANOBOT_PRESENTATION_GUIZANG_DIR
NANOBOT_PRESENTATION_KIMI_DIR
```

开发仓库还会发现同级的 `guizang-ppt-skill` 和 `open-kimi-ppt-skill`；打包应用不依赖此回退。
兼容读取 gateway 工作区已有的 `.nanobot/presentations/sources.json`，不再通过模板库写入目录配置。
归藏是 AGPL-3.0 外部技能，当前通过用户安装目录使用，不直接复制进应用发行包。
文稿快照保留原技能许可文件。内置 Kimi 资源来自 MIT 许可的 open-kimi-ppt-skill，
保留设计规范、示例预览和 LICENSE；不包含 Kimi 网页编辑器或在线导出脚本。

Swiss 校验需要 Node.js。预览样例使用现有 Chrome/Chromium；缺少浏览器时显示暂无预览。
Kimi 的模板读取和 PPTX 导出都在本地完成，不依赖 Node.js、agent-browser 或 Kimi 网站，
也不受外网阻断策略影响。模型生成内容仍使用用户配置的模型服务。
渲染使用项目已有的 python-pptx、Pillow 和 PyYAML；生成过程不会自动安装依赖。
图片必须位于文稿目录内并嵌入 PPTX，不读取远程图片或字体。目标电脑字体仍会影响显示。
PDF 预览使用本地 LibreOffice 或 macOS Quick Look；预览失败不影响 PPTX 交付。

本地格式以文稿 `.source/LOCAL_EXPORT.md` 为准，支持文字与富文本、预设形状、线条、
本地图片、原生表格及柱状/条形/折线/面积/饼图/环形图。它不是完整 Kimi 网页编辑器：
动画、复杂 SVG、混合图表、合并单元格等未支持字段会明确报错，不会静默丢弃。
模型应使用支持的原生元素或本地图片表达复杂图形。

## 验证

```bash
# GUI
npm run test -- src/components/chat/PresentationPicker.test.tsx src/components/chat/ChatInput.test.tsx src/core/nanobot-client.connection.test.ts
npm run build

# nanobot
venv/bin/pytest tests/tools/test_presentation_documents.py tests/tools/test_presentation_tool.py tests/security/test_protection.py tests/utils/test_webui_transcript.py
venv/bin/pytest tests/channels/test_websocket_channel.py tests/channels/test_websocket_http_routes.py -k presentation
```

实际排版由模型依据主题规范和用户资料生成，模板预览是风格参考，不保证逐像素复刻。
先做 3 页样稿确认设计；导出失败会返回具体页面和元素错误，不会切换模板或宣称成功。
