export interface WorkspaceTaskBinding {
  workspaceName: string;
  skillNames: string[];
  /** Personal skills explicitly granted by selecting this task. */
  userSkillNames?: string[];
  financialData?: boolean;
  subjectZh?: string;
  subjectEn?: string;
}

export const DATA_CHART_SKILL_NAME = 'smart-charts-8.4.0';
export const OFFICE_WRITING_SKILL_NAME = 'reduce-ai-perception-1.0.5';

const DATA_WORKSPACE: WorkspaceTaskBinding = {
  workspaceName: '我的数据分析',
  skillNames: [DATA_CHART_SKILL_NAME],
  userSkillNames: [DATA_CHART_SKILL_NAME],
};

const OFFICE_WORKSPACE: WorkspaceTaskBinding = {
  workspaceName: '我的综合办公',
  skillNames: [OFFICE_WRITING_SKILL_NAME, 'image-extract'],
  userSkillNames: [OFFICE_WRITING_SKILL_NAME],
};

const OFFICE_STYLE_ZH = '使用已选润色技能去除套话、重复和机械表达。本任务以正式办公规范为准：保留事实数字、专业术语、责任主体、结论强度和必要的标题、列表与标点，不强行口语化、自嘲或添加原文没有的细节。';
const OFFICE_STYLE_EN = 'Use the selected editing skill to remove boilerplate, repetition, and mechanical wording. Formal business conventions take priority: preserve facts, figures, terminology, responsible parties, the strength of conclusions, and useful headings, lists, and punctuation. Do not force colloquialisms, self-deprecation, or invented details.';

export const OFFICE_WRITING_EXAMPLES = [
  {
    key: 'department_report',
    labelZh: '部门工作汇报',
    labelEn: 'Department report',
    promptZh: '试写一份面向部门负责人的工作进展汇报，约 600 字。以下仅为练习素材，请在文档中标注“示例”：本周完成季度持仓数据核对，整理了 3 家发行人的跟踪材料；一份外部审计资料仍待补齐；下周计划完成风险台账更新并组织一次项目复盘。按“本周进展、待解决事项、下周计划”组织内容，涉及负责人和具体日期的缺项标注待补充。',
    promptEn: 'Draft a work progress report of about 400 words for a department head. These are practice materials only; label the document “Example”: this week we reconciled quarterly holdings data and compiled monitoring materials for three issuers; one external audit document is still missing; next week we plan to update the risk register and hold a project review. Organize it into progress, open issues, and next week’s plans. Flag missing owners and dates.',
  },
  {
    key: 'business_email',
    labelZh: '业务沟通邮件',
    labelEn: 'Business email',
    promptZh: '试写一封给项目合作方的资料补充邮件，约 300 字，语气专业、礼貌。以下仅为练习素材，请在文档中标注“示例”：已收到项目基本资料，仍缺最新财务报表和存量债务明细，希望对方本周五前反馈；如有困难，请对方说明可提供时间。给出邮件主题、正文和附件清单，姓名与联系方式用待补充占位。',
    promptEn: 'Draft a professional, polite email of about 200 words asking a project partner for additional documents. These are practice materials only; label the document “Example”: the basic project documents have arrived, but the latest financial statements and outstanding debt details are missing. Request a response by Friday, or an alternative delivery date if needed. Include a subject, body, and attachment checklist; leave names and contact details as placeholders.',
  },
];

export const DATA_ANALYSIS_SHORTCUTS = [
  {
    key: 'table_quick_insights',
    labelZh: '表格快速洞察',
    labelEn: 'Quick spreadsheet insights',
    promptZh: `请从我上传或用 @ 指定的 Excel/CSV 等表格中找出值得关注的发现；未提供时提醒我添加文件。
使用已选智能图表技能检查字段、缺失值、单位和统计口径，自动选择 1～3 张最能说明问题的图，不必让我先选图型。每张图附上关键发现、数据依据和口径说明，区分事实与推测。
将可离线打开的交互式 HTML 图表保存到当前工作空间的“图表”目录，保留原件，返回简要发现与文件路径。`,
    promptEn: `Find useful insights in the Excel/CSV or other table files I attach or reference with @; ask me to add a file if none is supplied.
Use the selected chart skill to inspect fields, missing values, units, and aggregation bases. Choose 1–3 informative charts without asking me to choose chart types. Include a finding, supporting figures, and scope for each chart; distinguish facts from hypotheses.
Save standalone offline interactive HTML charts in the workspace's “图表” folder, preserve originals, and return brief findings and file paths.`,
    workspaceTask: DATA_WORKSPACE,
  },
  {
    key: 'metric_trend_comparison',
    labelZh: '指标趋势对比',
    labelEn: 'Metric trends and comparisons',
    promptZh: `请根据我提供的表格，对关注的指标做趋势或横向对比，例如产品规模、净流入、收入费用。缺少文件或无法确定指标、比较对象时，仅询问必要信息。
使用已选智能图表技能统一时间范围、单位和统计口径，按时间、产品或部门比较，突出明显变化与差异。收益率等比例不直接累加，缺失值不当作零；缺少时间数据时只做有依据的横向对比。
将带有数据解读和口径说明的离线交互式 HTML 图表保存到当前工作空间的“图表”目录，保留原件，返回主要差异与文件路径。`,
    promptEn: `Use my table files to show trends or comparisons for the metrics I care about, such as product assets, net inflows, revenue, or expenses. Ask only for missing files or essential clarification of metrics and comparison groups.
Use the selected chart skill to align periods, units, and aggregation bases, then compare over time or across products or departments. Highlight material changes and differences. Do not sum rates or treat missing values as zero; without time data, make only supported cross-sectional comparisons.
Save offline interactive HTML charts with interpretations and scope notes in the workspace's “图表” folder, preserve originals, and return the main differences and file paths.`,
    workspaceTask: DATA_WORKSPACE,
  },
];

export const OFFICE_SHORTCUTS = [
  {
    key: 'draft_material',
    labelZh: '撰写与润色材料',
    labelEn: 'Draft and polish materials',
    promptZh: `请根据我提供的主题、要点或原稿，撰写或润色工作材料，可用于部门汇报、专项说明、业务邮件或对外沟通。
结合用途、读者、篇幅和模板组织内容；新写时先形成完整正文，再润色；修改原稿时保留原意，优化结构、逻辑与措辞。默认采用资产管理公司的正式、简洁风格。
${OFFICE_STYLE_ZH}
支持文档、表格和截图资料，图片先识别文字；只询问影响成稿的关键信息，其余缺项标注待补充，不编造数据、业绩或承诺。
将可编辑 Word 和 Markdown 保存到当前工作空间，保留原件，返回文件路径，并简要说明主要改动及待确认事项。`,
    promptEn: `Draft or polish work materials from my topic, notes, or existing draft, such as department reports, special briefings, business emails, or external communications.
Adapt to the purpose, audience, length, and template. For new writing, produce a complete draft before editing; when polishing, preserve meaning while improving structure, logic, and wording. Default to a formal, concise asset-management style.
${OFFICE_STYLE_EN}
Use supplied documents, spreadsheets, and screenshots, extracting text from images first. Ask only for information essential to drafting; flag other gaps and never invent data, performance figures, or commitments.
Save editable Word and Markdown files in the current workspace, preserve originals, and return file paths with a brief account of key changes and items to confirm.`,
    workspaceTask: OFFICE_WORKSPACE,
  },
  {
    key: 'meeting_minutes_actions',
    labelZh: '会议纪要与待办',
    labelEn: 'Meeting minutes and action items',
    promptZh: `请将会议记录整理为纪要和待办，区分讨论、决策与待确认事项；待办列明负责人和期限，未知项不补写，图片记录先识别文字。
成稿后精简措辞。${OFFICE_STYLE_ZH}
将 Word/Markdown 纪要及待办 CSV 保存到当前工作空间，保留原件并返回路径，不自动发通知或建日程。`,
    promptEn: `Turn meeting notes into minutes and actions, separating discussion, decisions, and open questions. List owners and deadlines without inventing them; extract text from image notes.
Polish the completed draft. ${OFFICE_STYLE_EN}
Save Word/Markdown minutes and an action CSV in the workspace, preserve originals, and return paths. Do not send notifications or create calendar events automatically.`,
    workspaceTask: OFFICE_WORKSPACE,
  },
  {
    key: 'weekly_work_report',
    labelZh: '工作周报自动汇总',
    labelEn: 'Automated weekly work report',
    promptZh: `请创建每周五 17:00（北京时间）自动执行的工作周报任务：汇总当前工作空间中当周的工作记录、会议纪要和项目资料，整理本周完成、重点进展、问题风险及下周计划，缺失内容标注待补充。
每次成稿后精简措辞。${OFFICE_STYLE_ZH}
将 Word 和 Markdown 周报按执行日期保存到当前工作空间的“周报”目录，返回摘要与文件路径。`,
    promptEn: `Create a recurring weekly work report task for Fridays at 17:00 Asia/Shanghai. On each run, summarize that week’s work records, meeting notes, and project materials in the current workspace into completed work, key progress, issues and risks, and next week’s plans. Flag missing information.
Polish each completed draft. ${OFFICE_STYLE_EN}
Save Word and Markdown reports dated by execution in a “周报” folder in the workspace, and return a summary and file paths.`,
    workspaceTask: {
      ...OFFICE_WORKSPACE,
      skillNames: [...OFFICE_WORKSPACE.skillNames, 'cron'],
    },
  },
];
