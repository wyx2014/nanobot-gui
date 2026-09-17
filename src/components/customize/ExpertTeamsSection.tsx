import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Database,
  Loader2,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';

import ExpertTeamIcon from '@/components/common/ExpertTeamIcon';
import { fetchExpertTeamDetail, fetchExpertTeams } from '@/core/api';
import { getNanobotStatus, getNanobotToken, refreshNanobotAuth } from '@/core/nanobotClient';
import type { ExpertTeamDetail, ExpertTeamSummary } from '@/core/types';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import CenteredLoadingIndicator from '@/components/common/CenteredLoadingIndicator';
import { useI18n } from '@/i18n';

const teamEnglish: Record<string, { name: string; description: string }> = {
  'asset-research-team': { name: 'Asset Research Team · Stock Research', description: 'Four research specialists analyze business, financials, industry, and risks in parallel. A team lead cross-checks evidence and produces the final report.' },
  'supply-chain-bottleneck-team': { name: 'Asset Research Team · Supply Chain Bottleneck Hunter', description: 'Five specialists validate a supertrend, map the physical supply chain, test bottlenecks, screen listed companies, and challenge the thesis in two research waves.' },
};

function teamText(team: { id: string; name: string; description: string }, isEnglish: boolean) {
  return isEnglish ? teamEnglish[team.id] ?? { name: team.name, description: team.description } : team;
}

function workflowCountText(count: number, isEnglish: boolean) {
  if (!isEnglish) return `${count} 套固定工作流`;
  return `${count} fixed ${count === 1 ? 'workflow' : 'workflows'}`;
}

function runtimeWorkflowCount(team: ExpertTeamSummary) {
  // Older gateways returned the size of the bundled upstream Skill catalog.
  // Without an explicit entry field, only the first manifest entry was runnable.
  return team.entry_workflow ? team.workflow_count : Math.min(team.workflow_count, 1);
}

function runtimeWorkflows(detail: ExpertTeamDetail) {
  const entry = detail.entry_workflow
    ? detail.workflows.find((workflow) => workflow.id === detail.entry_workflow)
    : detail.workflows[0];
  return entry ? [entry] : [];
}

function mcpPresetText(
  preset: { name: string; display_name: string; description?: string },
  isEnglish: boolean,
) {
  if (!isEnglish) return { name: preset.display_name, description: preset.description };
  if (preset.name === 'juyuan' || /聚源|juyuan/i.test(preset.display_name)) {
    return {
      name: 'Juyuan Financial Data MCP',
      description: 'Structured market, financial, announcement, capital-flow, and institutional data provided through Juyuan Financial Data MCP.',
    };
  }
  return { name: preset.display_name, description: preset.description };
}

const expertTeamMemberEnglish: Record<string, { name: string; framework: string; description: string }> = {
  'business-analyst': {
    name: 'Business Analyst',
    framework: 'Duan Yongping Perspective',
    description: 'Analyzes the business model, business characteristics, and competitive moat, prioritizing iFinD company profiles, revenue composition, and announcements.',
  },
  'financial-analyst': {
    name: 'Financial Analyst',
    framework: 'Warren Buffett Perspective',
    description: 'Analyzes financial quality, free cash flow, margin of safety, and valuation, using iFinD financial data as the structured baseline.',
  },
  'industry-analyst': {
    name: 'Industry Analyst',
    framework: 'Charlie Munger Perspective',
    description: 'Analyzes industry structure, competitive advantage, and long-term change, prioritizing iFinD sector and comparable-company data.',
  },
  'risk-analyst': {
    name: 'Risk Analyst',
    framework: 'Li Lu Perspective',
    description: 'Analyzes management, governance, downside risks, and the probability of permanent loss, prioritizing iFinD announcements and risk news.',
  },
  'risk-assessor': {
    name: 'Risk Analyst',
    framework: 'Li Lu Perspective',
    description: 'Analyzes management, governance, downside risks, and the probability of permanent loss, prioritizing iFinD announcements and risk news.',
  },
  'trend-verifier': {
    name: 'Trend & Demand Verifier',
    framework: 'Supertrend Validation',
    description: 'Validates demand, physical capex, persistence, and the time window before deeper supply-chain work begins.',
  },
  'chain-mapper': {
    name: 'Supply Chain Architect',
    framework: 'Physical Chain Decomposition',
    description: 'Maps products, components, materials, equipment, infrastructure, suppliers, and geographic dependencies layer by layer.',
  },
  'bottleneck-validator': {
    name: 'Bottleneck Evidence Analyst',
    framework: 'Six-Dimension Bottleneck Score',
    description: 'Tests concentration, lead times, substitution, utilization, demand growth, qualification cycles, and the likely release window.',
  },
  'company-screener': {
    name: 'Company Mapping & Valuation Analyst',
    framework: 'Financial and Pricing Constraints',
    description: 'Maps validated bottlenecks to listed companies and verifies exposure, financial quality, liquidity, valuation, and implied returns.',
  },
  'counter-case-analyst': {
    name: 'Counter-Case & Risk Analyst',
    framework: 'Munger-Style Inversion',
    description: 'Looks for substitutes, capacity responses, demand downside, geopolitical exposure, dilution, and narrative overpricing.',
  },
};

function memberText(
  member: {
    id: string;
    name: string;
    framework?: string;
    description?: string;
  },
  isEnglish: boolean,
) {
  if (!isEnglish) return member;
  const aliases: Record<string, keyof typeof expertTeamMemberEnglish> = {
    '商业分析师': 'business-analyst',
    '财务分析师': 'financial-analyst',
    '行业研究员': 'industry-analyst',
    '风险评估师': 'risk-analyst',
  };
  return expertTeamMemberEnglish[member.id] ?? expertTeamMemberEnglish[aliases[member.name]] ?? member;
}

async function getAuth(): Promise<{ token: string; baseUrl: string }> {
  const status = await getNanobotStatus();
  if (!status.ready) throw new Error('TP Cowork 服务尚未就绪');
  const baseUrl = `http://127.0.0.1:${status.port}`;
  const token = getNanobotToken();
  if (token) return { token, baseUrl };
  const refreshed = await refreshNanobotAuth();
  return { token: refreshed.token, baseUrl: refreshed.baseUrl };
}

function TeamAvatar({
  teamId,
  compact = false,
}: {
  teamId: string;
  compact?: boolean;
}) {
  return (
    <div className={cn(
      'cowork-team-avatar flex shrink-0 items-center justify-center',
      compact ? 'h-10 w-10 rounded-xl' : 'h-14 w-14 rounded-2xl',
    )}>
      <ExpertTeamIcon
        teamId={teamId}
        className={compact ? 'h-5 w-5' : 'h-7 w-7'}
      />
    </div>
  );
}

export default function ExpertTeamsSection() {
  const { locale } = useI18n();
  const isEnglish = locale === 'en-US';
  const query = useSettingsStore((state) => state.toolboxSearchQuery.trim().toLowerCase());
  const closeToolbox = useSettingsStore((state) => state.closeToolbox);
  const startNewConversation = useChatStore((state) => state.startNewConversation);
  const [teams, setTeams] = useState<ExpertTeamSummary[]>([]);
  const [detail, setDetail] = useState<ExpertTeamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mcpPresets = detail?.mcp_presets ?? [];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const auth = await getAuth();
      const payload = await fetchExpertTeams(auth.token, auth.baseUrl);
      setTeams(payload.teams);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => teams.filter((team) => {
    if (!query) return true;
    return [team.name, team.description, ...team.tags]
      .some((value) => value.toLowerCase().includes(query));
  }), [query, teams]);

  const openDetail = async (team: ExpertTeamSummary) => {
    setDetailLoading(true);
    setError(null);
    try {
      const auth = await getAuth();
      setDetail(await fetchExpertTeamDetail(auth.token, team.id, auth.baseUrl));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  };

  const startChatWithTeam = (team: ExpertTeamSummary | ExpertTeamDetail) => {
    startNewConversation({
      expertTeam: {
        id: team.id,
        name: team.name,
        version: team.version,
        member_count: team.member_count,
      },
    });
    closeToolbox();
    window.dispatchEvent(new CustomEvent('nanobot-gui:new-chat'));
  };

  if (detail) {
    const display = teamText(detail, isEnglish);
    const workflows = runtimeWorkflows(detail);
    return (
      <div data-expert-team-detail className="cowork-expert-page h-full overflow-y-auto">
        <div className="cowork-expert-content">
          <button
            onClick={() => setDetail(null)}
            className="cowork-expert-secondary-action mb-4 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {isEnglish ? 'Back to Expert Teams' : '返回专家团队'}
          </button>

          <div data-expert-team-summary className="rounded-2xl border p-5">
            <div className="flex flex-wrap items-start gap-4">
              <TeamAvatar teamId={detail.id} />
              <div className="min-w-0 flex-1 basis-56">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[17px] font-semibold leading-6">{display.name}</h2>
                  <span className="cowork-expert-badge rounded-full px-2 py-0.5 text-[10px] font-medium">{isEnglish ? 'Built-in' : '内置'}</span>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">{isEnglish ? 'Enabled' : '已启用'}</span>
                </div>
                <p className="cowork-expert-secondary mt-2 max-w-2xl text-[12px] leading-5">{display.description}</p>
                <div className="cowork-expert-muted mt-3 flex flex-wrap gap-3 text-xs">
                  <span>{detail.member_count} {isEnglish ? 'specialists' : '位专家'}</span>
                  <span>{workflowCountText(runtimeWorkflowCount(detail), isEnglish)}</span>
                  <span>{mcpPresets.length} {isEnglish ? 'MCP bindings' : '个 MCP 绑定'}</span>
                  <span>{isEnglish ? 'Version' : '版本'} {detail.version}</span>
                </div>
              </div>
              <button
                onClick={() => startChatWithTeam(detail)}
                disabled={!detail.available}
                className="cowork-expert-primary-action inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-4 text-[12px] font-medium"
              >
                <ArrowRight className="h-4 w-4" />
                {isEnglish ? 'Use Team' : '使用团队'}
              </button>
            </div>
          </div>

          <section className="mt-5">
            <h3 className="mb-3 text-sm font-semibold text-[#29261b]">{isEnglish ? 'Team Members' : '团队成员'}</h3>
            <div className="cowork-expert-grid">
              {detail.members.map((member, index) => {
                const display = memberText(member, isEnglish);
                return (
                  <div key={member.id} data-expert-member-card className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="cowork-team-avatar flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-semibold">
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{display.name}</div>
                        <div className="cowork-expert-accent mt-0.5 text-[11px]">{display.framework}</div>
                      </div>
                      {member.phase_label && (
                        <span className="cowork-expert-badge ml-auto rounded-full px-2 py-0.5 text-[10px]">
                          {member.phase_label}
                        </span>
                      )}
                    </div>
                    <p className="cowork-expert-secondary mt-3 text-xs leading-5">{display.description}</p>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mt-5">
            <h3 className="mb-3 text-sm font-semibold text-[#29261b]">{isEnglish ? 'Fixed Workflow' : '固定工作流'}</h3>
            <div data-expert-workflow-group className="rounded-xl border p-2">
              {workflows.map((workflow) => (
                <div key={workflow.id} data-expert-workflow className="flex items-center gap-3 rounded-lg px-3 py-2.5">
                  <Sparkles className="cowork-expert-accent h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{workflow.name}</div>
                    <div className="cowork-expert-muted mt-0.5 text-[11px]">{workflow.mode === 'team' ? (isEnglish ? 'Multi-specialist parallel execution' : '多专家并行') : (isEnglish ? 'Team Lead focused execution' : 'Team Lead 专项执行')}</div>
                  </div>
                  {workflow.mode === 'team' && <span className="cowork-expert-badge rounded px-1.5 py-0.5 text-[10px]">{isEnglish ? 'Team' : '团队'}</span>}
                </div>
              ))}
            </div>
          </section>

          {mcpPresets.length > 0 && (
            <section className="mt-5">
              <h3 className="mb-3 text-sm font-semibold text-[#29261b]">{isEnglish ? 'Team MCP Bindings' : '团队绑定 MCP'}</h3>
              <div data-expert-mcp-group className="space-y-2 rounded-xl border p-3">
                {mcpPresets.map((preset) => {
                  const display = mcpPresetText(preset, isEnglish);
                  return (
                    <div key={preset.name} data-expert-mcp className="flex items-start gap-3 rounded-lg px-3 py-2.5">
                      <Database className="cowork-expert-accent mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {display.name}
                          <span className={cn(
                            'rounded px-1.5 py-0.5 text-[10px]',
                            preset.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700',
                          )}>
                            {preset.configured
                              ? (isEnglish ? 'Configured · enabled when the request is sent' : '已配置 · 发送任务时自动启用')
                              : (isEnglish ? 'Not configured · enabled after setup' : '未配置 · 配置后自动启用')}
                          </span>
                        </div>
                        <p className="cowork-expert-secondary mt-1 text-xs leading-5">{display.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="cowork-expert-grid mt-5">
            <div data-expert-quality className="rounded-xl border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="cowork-expert-accent h-4 w-4" />
                {isEnglish ? 'Quality Control' : '质量控制'}
              </div>
              <p className="cowork-expert-secondary mt-2 text-xs leading-5">{isEnglish ? 'Key conclusions retain their sources, periods, units, and definitions. The team cross-checks evidence and identifies gaps before publishing a report.' : '关键结论保留来源、期间、单位与口径；团队在报告发布前交叉验证并标注证据缺口。'}</p>
            </div>
            <div data-expert-dependency className="rounded-xl border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="cowork-expert-accent h-4 w-4" />
                {isEnglish ? 'Runtime Dependencies' : '运行依赖'}
              </div>
              <p className="cowork-expert-secondary mt-2 text-xs leading-5">{isEnglish ? 'Teams reuse the current TP Cowork model, web search, built-in iFinD skill, and configured MCP services; an alternative bound source is used when one is unavailable.' : '团队复用当前 TP Cowork 的模型、联网搜索、内置 聚源、同花顺、财汇MCP；单一来源不可用时自动换用另一绑定来源。'}</p>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div data-expert-team-list className="cowork-expert-page h-full overflow-y-auto">
      <div className="cowork-expert-content">
        <section aria-labelledby="expert-team-list-title">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="expert-team-list-title" className="text-[17px] font-semibold tracking-[-0.01em]">
                {isEnglish ? 'Expert Teams' : '专家团队'}
              </h2>
              <p className="cowork-expert-secondary mt-0.5 text-[12px]">
                {isEnglish ? 'Choose a team for your task, or explore how its specialists work together.' : '按研究目标选择团队，也可以先查看成员分工与工作流。'}
              </p>
            </div>
            {!loading && !error && (
              <span className="cowork-expert-muted shrink-0 text-[11px]">
                {isEnglish ? `${filtered.length} ${filtered.length === 1 ? 'team' : 'teams'}` : `${filtered.length} 个团队`}
              </span>
            )}
          </div>
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          {loading ? (
            <CenteredLoadingIndicator
              label={isEnglish ? 'Loading expert teams' : '正在读取专家团队'}
              className="min-h-[240px]"
            />
          ) : filtered.length === 0 ? (
            <div className="cowork-expert-secondary py-16 text-center text-[13px]">{isEnglish ? 'No expert teams found' : '没有找到专家团队'}</div>
          ) : (
            <div className="cowork-expert-grid">
              {filtered.map((team) => {
                const display = teamText(team, isEnglish);
                return (
                  <article
                    key={team.id}
                    data-expert-team-card
                    className="group flex min-w-0 flex-col rounded-2xl border px-5 py-4 transition-all hover:-translate-y-0.5"
                  >
                    <div className="flex items-start gap-4">
                      <TeamAvatar teamId={team.id} compact />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[14px] font-semibold leading-5">{display.name}</h3>
                        <p className="cowork-expert-secondary mt-1.5 text-[12px] leading-5">{display.description}</p>
                      </div>
                    </div>
                    <div className="cowork-expert-muted mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-4 text-[11px]">
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" aria-hidden="true" />
                        {team.member_count} {isEnglish ? 'specialists' : '位专家'}
                      </span>
                      <span>{workflowCountText(runtimeWorkflowCount(team), isEnglish)}</span>
                      <span className="cowork-expert-badge rounded px-1.5 py-0.5 text-[10px]">{isEnglish ? 'Built-in' : '内置'}</span>
                      <span className={cn(
                        'ml-auto inline-flex items-center gap-1 text-[11px]',
                        team.available ? 'text-emerald-700' : 'text-amber-700',
                      )}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', team.available ? 'bg-emerald-500' : 'bg-amber-500')} />
                        {team.available ? (isEnglish ? 'Available' : '可用') : (isEnglish ? 'Needs attention' : '需要检查')}
                      </span>
                    </div>
                    <div className="cowork-expert-card-actions mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                      <button
                        onClick={() => void openDetail(team)}
                        className="cowork-expert-secondary-action inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-medium"
                      >
                        {isEnglish ? 'View Team' : '查看团队'}
                        {detailLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => startChatWithTeam(team)}
                        disabled={!team.available}
                        className="cowork-expert-primary-action inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[12px] font-medium"
                      >
                        <ArrowRight className="h-3 w-3" />
                        {isEnglish ? 'Use Team' : '使用团队'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
