export const INVESTMENT_WORKSPACE_NAME = '我的投研分析';

export interface ResearchShortcutBinding {
  teamId: string;
  subjectZh: string;
  subjectEn: string;
}

// Each team owns its entry workflow and configured data connectors in nanobot.
export const RESEARCH_SHORTCUTS = [
  {
    key: 'stock_research',
    labelZh: '个股深度研究',
    labelEn: 'In-depth stock research',
    promptZh: '请深度研究【公司名称或股票代码】，围绕商业模式、竞争优势、财务现金流、估值与安全边际，给出核心判断、正反证据、风险和跟踪指标。注明数据来源与日期，标明证据缺口，将 Markdown、HTML 报告保存到当前工作空间并返回摘要与路径。',
    promptEn: 'Research [company name or ticker]: business model, competitive advantages, financials, cash flow, valuation, and margin of safety. Present the thesis, evidence for and against it, risks, and monitoring indicators. Cite sources and dates, flag gaps, and save Markdown and HTML reports in the workspace with a summary and paths.',
    research: {
      teamId: 'asset-research-team',
      subjectZh: '【公司名称或股票代码】',
      subjectEn: '[company name or ticker]',
    },
  },
  {
    key: 'supply_chain_opportunities',
    labelZh: '产业链机会挖掘',
    labelEn: 'Supply chain opportunities',
    promptZh: '请围绕【产业主题或趋势】挖掘产业链机会：验证需求、梳理供需瓶颈及持续时间，比较受益公司及估值风险，给出机会地图、候选名单和跟踪指标。注明来源与日期，标明证据缺口，将 Markdown、HTML 报告保存到当前工作空间并返回摘要与路径。',
    promptEn: 'Explore opportunities around [industry theme or trend]: validate demand, map supply-chain bottlenecks and their duration, and compare beneficiaries and valuation risks. Deliver an opportunity map, candidate shortlist, and monitoring indicators. Cite sources and dates, flag evidence gaps, and save Markdown and HTML reports in the workspace with a summary and paths.',
    research: {
      teamId: 'supply-chain-bottleneck-team',
      subjectZh: '【产业主题或趋势】',
      subjectEn: '[industry theme or trend]',
    },
  },
];
