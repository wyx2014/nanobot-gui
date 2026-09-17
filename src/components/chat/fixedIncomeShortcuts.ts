export const FIXED_INCOME_WORKSPACE_NAME = '我的固收业务';

// These are gateway preset IDs, not display-only prompt mentions.
export const FIXED_INCOME_CONNECTORS = [
  { name: 'juyuan', labelZh: '聚源', labelEn: 'Juyuan' },
  { name: 'caihui_mcp', labelZh: '财汇', labelEn: 'Caihui' },
];

export interface FixedIncomeShortcutBinding {
  subjectZh: string;
  subjectEn: string;
}

export const FIXED_INCOME_SHORTCUTS = [
  {
    key: 'credit_issuer_research',
    labelZh: '信用债主体研究',
    labelEn: 'Credit issuer research',
    promptZh: `请对【发行人名称或债券代码】做信用债主体研究，判断还本付息能力、偿债来源及风险变化。重点分析现金流、未来一年到期债务、再融资与关键条款；区分实际偿债主体，股东背景不等于担保，对象有歧义时先确认。
外部数据仅用已选聚源、财汇；注明来源、数据截止时间和报告期，缺口如实说明。
输出信用结论、偿债对照表及跟踪事项，将 Markdown、HTML 报告按主体和日期保存到当前工作空间，保留已有文件并返回摘要与路径。`,
    promptEn: `Assess [issuer name or bond code] for repayment capacity, funding sources, and changing credit risks. Focus on cash flow, debt due within one year, refinancing, and key bond terms. Identify the actual obligor, clarify ambiguous identities, and do not treat shareholder backing as a guarantee.
Use selected Juyuan and Caihui connectors for external data. Cite sources, data cutoffs, reporting periods, and gaps.
Deliver a credit conclusion, repayment table, and monitoring priorities. Save dated Markdown and HTML reports in the workspace, preserve existing files, and return a summary and paths.`,
    fixedIncome: {
      subjectZh: '【发行人名称或债券代码】',
      subjectEn: '[issuer name or bond code]',
    },
  },
  {
    key: 'bond_relative_value',
    labelZh: '债券相对价值分析',
    labelEn: 'Bond relative value',
    promptZh: `请分析【债券代码或筛选条件】的相对价值，选取同市场、币种及相近资质、期限和条款的可比债。统一时点与口径，比较收益率、利差、久期和流动性，区分估值、报价与成交，说明风险及配置条件。
外部数据仅用已选聚源、财汇；注明来源、日期与利差基准，歧义先确认，缺口如实说明。
输出候选债对比、价值判断和不利情景，将 Markdown、HTML 报告及 CSV 对比表按日期保存到当前工作空间，保留已有文件并返回摘要与路径。`,
    promptEn: `Assess the relative value of [bond code or screening criteria] against peers with comparable markets, currencies, credit quality, maturities, and terms. Align timestamps and conventions; compare yields, spreads, duration, and liquidity. Distinguish valuations, quotes, and trades, and explain risks and allocation conditions.
Use selected Juyuan and Caihui connectors. Cite sources, dates, and spread benchmarks; clarify ambiguity and report gaps.
Deliver peer comparisons, value judgments, and adverse scenarios. Save dated Markdown and HTML reports plus a CSV comparison in the workspace, preserve existing files, and return a summary and paths.`,
    fixedIncome: {
      subjectZh: '【债券代码或筛选条件】',
      subjectEn: '[bond code or screening criteria]',
    },
  },
];
