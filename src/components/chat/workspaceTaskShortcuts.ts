export interface WorkspaceTaskBinding {
  workspaceName: string;
  skillNames: string[];
  financialData?: boolean;
  subjectZh?: string;
  subjectEn?: string;
}

const DATA_WORKSPACE: WorkspaceTaskBinding = {
  workspaceName: '我的数据分析',
  skillNames: ['portfolio-analysis'],
  financialData: true,
};

const OFFICE_WORKSPACE: WorkspaceTaskBinding = {
  workspaceName: '我的综合办公',
  skillNames: ['office-documents', 'image-extract'],
};

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
    key: 'portfolio_structure_review',
    labelZh: '持仓结构体检',
    labelEn: 'Portfolio structure review',
    promptZh: `请体检我提供的持仓表；未提供时提醒我上传 Excel/CSV。核对产品、日期、币种及权重口径，分析资产分布、集中度与到期结构，按已提供的限额检查偏离。
补充数据仅用已选聚源、财汇；缺失字段如实说明。将报告、汇总 CSV 和计算脚本保存到当前工作空间，保留原件并返回摘要与路径。`,
    promptEn: `Review my holdings structure; ask for Excel/CSV files if missing. Verify product, date, currency, and weight basis. Analyze allocation, concentration, and maturities; check against supplied limits.
Supplement data through selected Juyuan and Caihui connectors; report missing fields. Save reports, CSV summaries, and calculation scripts in the workspace, preserve originals, and return a summary and paths.`,
    workspaceTask: DATA_WORKSPACE,
  },
  {
    key: 'portfolio_changes_review',
    labelZh: '持仓变动复盘',
    labelEn: 'Holdings change review',
    promptZh: `请复盘前后两期持仓，资料不齐先提醒我补充。统一产品、证券标识和估值口径，列出新增、退出及数量、市值、权重变化；区分交易与估值影响，不将市值差当成损益。
补充数据仅用已选聚源、财汇。将报告、差异 CSV 和计算脚本保存到当前工作空间，保留原件，说明数据缺口并返回摘要与路径。`,
    promptEn: `Compare two holdings snapshots; ask for missing inputs. Align products, security identifiers, and valuation bases. Show additions, exits, and quantity, value, and weight changes. Separate trading from valuation effects; value differences alone are not profit or loss.
Supplement data through selected Juyuan and Caihui connectors. Save reports, CSV differences, and calculation scripts in the workspace, preserve originals, and return a summary, gaps, and paths.`,
    workspaceTask: DATA_WORKSPACE,
  },
];

export const OFFICE_SHORTCUTS = [
  {
    key: 'draft_material',
    labelZh: '撰写与润色材料',
    labelEn: 'Draft and polish materials',
    promptZh: `请根据我提供的主题、要点或原稿，撰写或润色工作材料，可用于部门汇报、专项说明、业务邮件或对外沟通。
结合用途、读者、篇幅和模板组织内容；新写时梳理重点、形成完整正文，润色时保留原意、事实和数字，优化结构、逻辑与措辞。默认采用资产管理公司的正式、简洁风格，结论先行、层次清楚。
支持文档、表格和截图资料，图片先识别文字；只询问影响成稿的关键信息，其余缺项标注待补充，不编造数据、业绩或承诺。
将可编辑 Word 和 Markdown 保存到当前工作空间，保留原件，返回文件路径，并简要说明主要改动及待确认事项。`,
    promptEn: `Draft or polish work materials from my topic, notes, or existing draft, such as department reports, special briefings, business emails, or external communications.
Adapt to the purpose, audience, length, and template. For new writing, organize the key points into a complete draft; when polishing, preserve meaning, facts, and figures while improving structure, logic, and wording. Default to a formal, concise asset-management style with conclusions first and clear sections.
Use supplied documents, spreadsheets, and screenshots, extracting text from images first. Ask only for information essential to drafting; flag other gaps and never invent data, performance figures, or commitments.
Save editable Word and Markdown files in the current workspace, preserve originals, and return file paths with a brief account of key changes and items to confirm.`,
    workspaceTask: OFFICE_WORKSPACE,
  },
  {
    key: 'meeting_minutes_actions',
    labelZh: '会议纪要与待办',
    labelEn: 'Meeting minutes and action items',
    promptZh: '请将会议记录整理为纪要和待办，区分讨论、决策与待确认事项；待办列明负责人和期限，未知项不补写，图片记录先识别文字。将 Word/Markdown 纪要及待办 CSV 保存到当前工作空间，保留原件并返回路径，不自动发通知或建日程。',
    promptEn: 'Turn meeting notes into minutes and actions, separating discussion, decisions, and open questions. List owners and deadlines without inventing them; extract text from image notes. Save Word/Markdown minutes and an action CSV in the workspace, preserve originals, and return paths. Do not send notifications or create calendar events automatically.',
    workspaceTask: OFFICE_WORKSPACE,
  },
  {
    key: 'weekly_work_report',
    labelZh: '工作周报自动汇总',
    labelEn: 'Automated weekly work report',
    promptZh: '请创建每周五 17:00（北京时间）自动执行的工作周报任务：汇总当前工作空间中当周的工作记录、会议纪要和项目资料，整理本周完成、重点进展、问题风险及下周计划，缺失内容标注待补充。将 Word 和 Markdown 周报按执行日期保存到当前工作空间的“周报”目录，返回摘要与文件路径。',
    promptEn: 'Create a recurring weekly work report task for Fridays at 17:00 Asia/Shanghai. On each run, summarize that week’s work records, meeting notes, and project materials in the current workspace into completed work, key progress, issues and risks, and next week’s plans. Flag missing information. Save Word and Markdown reports dated by execution in a “周报” folder in the workspace, and return a summary and file paths.',
    workspaceTask: {
      ...OFFICE_WORKSPACE,
      skillNames: [...OFFICE_WORKSPACE.skillNames, 'cron'],
    },
  },
];
