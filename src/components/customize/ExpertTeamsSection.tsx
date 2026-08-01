import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Database,
  Loader2,
  Play,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

import ExpertTeamIcon from '@/components/common/ExpertTeamIcon';
import { fetchExpertTeamDetail, fetchExpertTeams } from '@/core/api';
import { getNanobotStatus, getNanobotToken, refreshNanobotAuth } from '@/core/nanobotClient';
import type { ExpertTeamDetail, ExpertTeamSummary } from '@/core/types';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useI18n } from '@/i18n';

const teamEnglish: Record<string, { name: string; description: string }> = {
  'asset-research-team': { name: 'Asset Research Team', description: 'Four research specialists analyze business, financials, industry, and risks in parallel. A team lead cross-checks evidence and produces the final report.' },
  'trading-analysis-team': { name: 'Trading Analysis Team', description: 'Twelve research roles evaluate technicals, fundamentals, events, sentiment, debate, execution, and risk to produce a traceable trading plan.' },
};

function teamText(team: { id: string; name: string; description: string }, isEnglish: boolean) {
  return isEnglish ? teamEnglish[team.id] ?? { name: team.name, description: team.description } : team;
}

function dataSourceText(
  source: { id: string; name: string; description?: string },
  isEnglish: boolean,
) {
  if (!isEnglish) return source;
  if (source.id === 'ifind-finance-data' || /ifind|同花顺/i.test(source.name)) {
    return {
      name: 'iFinD Financial Data',
      description: 'Structured data for A-shares, Hong Kong and U.S. companies, including company profiles, financial metrics, market quotes, announcements, news, and industry sectors.',
    };
  }
  return source;
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

const assetResearchMemberEnglish: Record<string, { name: string; framework: string; description: string }> = {
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
  const aliases: Record<string, keyof typeof assetResearchMemberEnglish> = {
    '商业分析师': 'business-analyst',
    '财务分析师': 'financial-analyst',
    '行业研究员': 'industry-analyst',
    '风险评估师': 'risk-analyst',
  };
  return assetResearchMemberEnglish[member.id] ?? assetResearchMemberEnglish[aliases[member.name]] ?? member;
}

async function getAuth(): Promise<{ token: string; baseUrl: string }> {
  const status = await getNanobotStatus();
  if (!status.ready) throw new Error('nanobot 服务尚未就绪');
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
      'flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#29261b] to-[#5a5141] text-[#fff8ee] shadow-sm',
      compact ? 'h-12 w-12' : 'h-16 w-16',
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
  const createConversation = useChatStore((state) => state.createConversation);
  const [teams, setTeams] = useState<ExpertTeamSummary[]>([]);
  const [detail, setDetail] = useState<ExpertTeamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dataSources = detail?.data_sources ?? [];
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

  const startTeam = (team: ExpertTeamSummary | ExpertTeamDetail) => {
    createConversation(null, {
      title: team.name,
      expertTeam: {
        id: team.id,
        name: team.name,
        version: team.version,
        member_count: team.member_count,
      },
    });
    closeToolbox();
  };

  if (detail) {
    const display = teamText(detail, isEnglish);
    return (
      <div data-expert-team-detail className="h-full overflow-y-auto px-5 py-5">
        <button
          onClick={() => setDetail(null)}
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-[#656358] hover:text-[#29261b]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {isEnglish ? 'Back to Expert Teams' : '返回专家团队'}
        </button>

        <div className="rounded-2xl border border-[#e6e0d7] bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <TeamAvatar teamId={detail.id} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold text-[#29261b]">{display.name}</h2>
                <span className="rounded-full bg-[#fff1e8] px-2 py-0.5 text-[10px] font-medium text-[#b85c3d]">{isEnglish ? 'Built-in' : '内置'}</span>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">{isEnglish ? 'Enabled' : '已启用'}</span>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#656358]">{display.description}</p>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-[#777368]">
                <span>{detail.member_count} {isEnglish ? 'specialists' : '位专家'}</span>
                <span>{detail.workflow_count} {isEnglish ? 'workflows' : '个工作流'}</span>
                <span>{dataSources.length + mcpPresets.length} {isEnglish ? 'connected data sources' : '个绑定数据源'}</span>
                <span>{isEnglish ? 'Version' : '版本'} {detail.version}</span>
              </div>
            </div>
            <button
              onClick={() => startTeam(detail)}
              disabled={!detail.available}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#d97757] px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#c96747] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play className="h-4 w-4 fill-current" />
              {isEnglish ? 'Start Team' : '启动团队'}
            </button>
          </div>
        </div>

        <section className="mt-5">
          <h3 className="mb-3 text-sm font-semibold text-[#29261b]">{isEnglish ? 'Team Members' : '团队成员'}</h3>
          <div className="grid grid-cols-2 gap-3">
            {detail.members.map((member, index) => {
              const display = memberText(member, isEnglish);
              return (
                <div key={member.id} className="rounded-xl border border-[#e8e4dd] bg-white p-4">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white',
                      ['bg-[#5778a5]', 'bg-[#4f9576]', 'bg-[#c18a3d]', 'bg-[#647b50]'][index % 4],
                    )}>
                      {index + 1}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-[#29261b]">{display.name}</div>
                      <div className="mt-0.5 text-[11px] text-[#a06b52]">{display.framework}</div>
                    </div>
                    {member.phase_label && (
                      <span className="ml-auto rounded-full bg-[#f5f2ed] px-2 py-0.5 text-[10px] text-[#777368]">
                        {member.phase_label}
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-[#777368]">{display.description}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-5">
          <h3 className="mb-3 text-sm font-semibold text-[#29261b]">{isEnglish ? 'Featured Workflows' : '常用工作流'}</h3>
          <div className="rounded-xl border border-[#e8e4dd] bg-white p-2">
            {detail.workflows.filter((workflow) => workflow.featured).map((workflow) => (
              <div key={workflow.id} data-expert-workflow className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[#faf8f5]">
                <Sparkles className="h-4 w-4 shrink-0 text-[#d97757]" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[#29261b]">{workflow.name}</div>
                  <div className="mt-0.5 text-[11px] text-[#888579]">{workflow.mode === 'team' ? (isEnglish ? 'Multi-specialist parallel execution' : '多专家并行') : (isEnglish ? 'Team Lead focused execution' : 'Team Lead 专项执行')}</div>
                </div>
                {workflow.mode === 'team' && <span className="rounded bg-[#f3eee8] px-1.5 py-0.5 text-[10px] text-[#7a6658]">{isEnglish ? 'Team' : '团队'}</span>}
              </div>
            ))}
          </div>
        </section>

        {dataSources.length > 0 && (
          <section className="mt-5">
            <h3 className="mb-3 text-sm font-semibold text-[#29261b]">{isEnglish ? 'Built-in Data Sources' : '内置数据源'}</h3>
            <div data-expert-data-source-group className="space-y-2 rounded-xl border border-[#dce9df] bg-[#f7fbf8] p-3">
              {dataSources.map((source) => {
                const display = dataSourceText(source, isEnglish);
                return (
                  <div key={source.id} data-expert-data-source className="flex items-start gap-3 rounded-lg bg-white/75 px-3 py-2.5">
                    <Database className="mt-0.5 h-4 w-4 shrink-0 text-[#4f9576]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium text-[#294f35]">
                        {display.name}
                        {source.priority === 'primary' && (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">{isEnglish ? 'Primary source' : '优先数据源'}</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-[#5f7565]">{display.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {mcpPresets.length > 0 && (
          <section className="mt-5">
            <h3 className="mb-3 text-sm font-semibold text-[#29261b]">{isEnglish ? 'Team MCP Bindings' : '团队绑定 MCP'}</h3>
            <div data-expert-mcp-group className="space-y-2 rounded-xl border border-[#e2e0ec] bg-[#faf9fd] p-3">
              {mcpPresets.map((preset) => {
                const display = mcpPresetText(preset, isEnglish);
                return (
                  <div key={preset.name} data-expert-mcp className="flex items-start gap-3 rounded-lg bg-white/80 px-3 py-2.5">
                    <Database className="mt-0.5 h-4 w-4 shrink-0 text-[#6f67a8]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-[#454064]">
                        {display.name}
                        <span className={cn(
                          'rounded px-1.5 py-0.5 text-[10px]',
                          preset.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700',
                        )}>
                          {preset.configured
                            ? (isEnglish ? 'Configured · enabled when the team starts' : '已配置 · 启动团队时自动启用')
                            : (isEnglish ? 'Not configured · enabled after setup' : '未配置 · 配置后自动启用')}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-[#6b6780]">{display.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="mt-5 grid grid-cols-2 gap-3">
          <div data-expert-quality className="rounded-xl border border-[#dce9df] bg-[#f7fbf8] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[#345c40]">
              <ShieldCheck className="h-4 w-4" />
              {isEnglish ? 'Quality Control' : '质量控制'}
            </div>
            <p className="mt-2 text-xs leading-5 text-[#5f7565]">{isEnglish ? 'Key conclusions retain their sources, periods, units, and definitions. The team cross-checks evidence and identifies gaps before publishing a report.' : '关键结论保留来源、期间、单位与口径；团队在报告发布前交叉验证并标注证据缺口。'}</p>
          </div>
          <div data-expert-dependency className="rounded-xl border border-[#e8e4dd] bg-[#faf9f6] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[#514d43]">
              <CheckCircle2 className="h-4 w-4" />
              {isEnglish ? 'Runtime Dependencies' : '运行依赖'}
            </div>
            <p className="mt-2 text-xs leading-5 text-[#777368]">{isEnglish ? 'Teams reuse the current TPACowork model, web search, built-in iFinD skill, and configured MCP services; an alternative bound source is used when one is unavailable.' : '团队复用当前 Cowork 的模型、联网搜索、内置 iFinD Skill 和已配置的聚源 MCP；单一来源不可用时自动换用另一绑定来源。'}</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div data-expert-team-list className="h-full overflow-y-auto px-5 py-5">
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#888579]">
          <Loader2 className="h-4 w-4 animate-spin" />
          {isEnglish ? 'Loading expert teams' : '正在读取专家团队'}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-[#888579]">{isEnglish ? 'No expert teams found' : '没有找到专家团队'}</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {filtered.map((team) => {
            const display = teamText(team, isEnglish);
            return (
            <article
              key={team.id}
              className="group rounded-2xl border border-[#e5ded4] bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#d8c9bd] hover:shadow-md"
            >
              <div className="flex items-start gap-4">
                <TeamAvatar teamId={team.id} compact />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-base font-semibold text-[#29261b]">{display.name}</h3>
                    <span className="rounded-full bg-[#fff1e8] px-2 py-0.5 text-[10px] font-medium text-[#b85c3d]">{isEnglish ? 'Built-in' : '内置'}</span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[#656358]">{display.description}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="rounded-lg bg-[#f5f2ed] px-2 py-1 text-[11px] text-[#6d695f]">{team.member_count} {isEnglish ? 'specialists' : '位专家'}</span>
                <span className="rounded-lg bg-[#f5f2ed] px-2 py-1 text-[11px] text-[#6d695f]">{team.workflow_count} {isEnglish ? 'workflows' : '个工作流'}</span>
                <span className={cn(
                  'ml-auto inline-flex items-center gap-1 text-[11px]',
                  team.available ? 'text-emerald-700' : 'text-amber-700',
                )}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', team.available ? 'bg-emerald-500' : 'bg-amber-500')} />
                  {team.available ? (isEnglish ? 'Available' : '可用') : (isEnglish ? 'Needs attention' : '需要检查')}
                </span>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-[#eee9e2] pt-3">
                <button
                  onClick={() => void openDetail(team)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#656358] hover:text-[#29261b]"
                >
                  {isEnglish ? 'View Team' : '查看团队'}
                  {detailLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => startTeam(team)}
                  disabled={!team.available}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#29261b] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#423e31] disabled:opacity-40"
                >
                  <Play className="h-3 w-3 fill-current" />
                  {isEnglish ? 'Start Team' : '启动团队'}
                </button>
              </div>
            </article>
          );})}
        </div>
      )}
    </div>
  );
}
