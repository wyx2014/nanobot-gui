// These are gateway preset IDs, not display-only prompt mentions.
export const FIXED_INCOME_CONNECTORS = [
  { name: 'juyuan', labelZh: '聚源', labelEn: 'Juyuan' },
  { name: 'caihui_mcp', labelZh: '财汇', labelEn: 'Caihui' },
];

export interface FixedIncomeShortcutBinding {
  subjectZh: string;
  subjectEn: string;
}

export const CREDIT_ISSUER_SHORTCUT = {
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
};
