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
    return (
      <div className="h-full overflow-y-auto px-5 py-5">
        <button
          onClick={() => setDetail(null)}
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-[#656358] hover:text-[#29261b]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回专家团队
        </button>

        <div className="rounded-2xl border border-[#e6e0d7] bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <TeamAvatar teamId={detail.id} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold text-[#29261b]">{detail.name}</h2>
                <span className="rounded-full bg-[#fff1e8] px-2 py-0.5 text-[10px] font-medium text-[#b85c3d]">内置</span>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">已启用</span>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#656358]">{detail.description}</p>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-[#777368]">
                <span>{detail.member_count} 位专家</span>
                <span>{detail.workflow_count} 个工作流</span>
                <span>{dataSources.length + mcpPresets.length} 个绑定数据源</span>
                <span>版本 {detail.version}</span>
              </div>
            </div>
            <button
              onClick={() => startTeam(detail)}
              disabled={!detail.available}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#d97757] px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#c96747] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play className="h-4 w-4 fill-current" />
              启动团队
            </button>
          </div>
        </div>

        <section className="mt-5">
          <h3 className="mb-3 text-sm font-semibold text-[#29261b]">团队成员</h3>
          <div className="grid grid-cols-2 gap-3">
            {detail.members.map((member, index) => (
              <div key={member.id} className="rounded-xl border border-[#e8e4dd] bg-white p-4">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white',
                    ['bg-[#5778a5]', 'bg-[#4f9576]', 'bg-[#c18a3d]', 'bg-[#647b50]'][index % 4],
                  )}>
                    {index + 1}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-[#29261b]">{member.name}</div>
                    <div className="mt-0.5 text-[11px] text-[#a06b52]">{member.framework}</div>
                  </div>
                  {member.phase_label && (
                    <span className="ml-auto rounded-full bg-[#f5f2ed] px-2 py-0.5 text-[10px] text-[#777368]">
                      {member.phase_label}
                    </span>
                  )}
                </div>
                <p className="mt-3 text-xs leading-5 text-[#777368]">{member.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-5">
          <h3 className="mb-3 text-sm font-semibold text-[#29261b]">常用工作流</h3>
          <div className="rounded-xl border border-[#e8e4dd] bg-white p-2">
            {detail.workflows.filter((workflow) => workflow.featured).map((workflow) => (
              <div key={workflow.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[#faf8f5]">
                <Sparkles className="h-4 w-4 shrink-0 text-[#d97757]" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[#29261b]">{workflow.name}</div>
                  <div className="mt-0.5 text-[11px] text-[#888579]">{workflow.mode === 'team' ? '多专家并行' : 'Team Lead 专项执行'}</div>
                </div>
                {workflow.mode === 'team' && <span className="rounded bg-[#f3eee8] px-1.5 py-0.5 text-[10px] text-[#7a6658]">团队</span>}
              </div>
            ))}
          </div>
        </section>

        {dataSources.length > 0 && (
          <section className="mt-5">
            <h3 className="mb-3 text-sm font-semibold text-[#29261b]">内置数据源</h3>
            <div className="space-y-2 rounded-xl border border-[#dce9df] bg-[#f7fbf8] p-3">
              {dataSources.map((source) => (
                <div key={source.id} className="flex items-start gap-3 rounded-lg bg-white/75 px-3 py-2.5">
                  <Database className="mt-0.5 h-4 w-4 shrink-0 text-[#4f9576]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-[#294f35]">
                      {source.name}
                      {source.priority === 'primary' && (
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">优先数据源</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[#5f7565]">{source.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {mcpPresets.length > 0 && (
          <section className="mt-5">
            <h3 className="mb-3 text-sm font-semibold text-[#29261b]">团队绑定 MCP</h3>
            <div className="space-y-2 rounded-xl border border-[#e2e0ec] bg-[#faf9fd] p-3">
              {mcpPresets.map((preset) => (
                <div key={preset.name} className="flex items-start gap-3 rounded-lg bg-white/80 px-3 py-2.5">
                  <Database className="mt-0.5 h-4 w-4 shrink-0 text-[#6f67a8]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-[#454064]">
                      {preset.display_name}
                      <span className={cn(
                        'rounded px-1.5 py-0.5 text-[10px]',
                        preset.configured
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-700',
                      )}>
                        {preset.configured ? '已配置 · 启动团队时自动启用' : '未配置 · 配置后自动启用'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[#6b6780]">{preset.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-[#dce9df] bg-[#f7fbf8] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[#345c40]">
              <ShieldCheck className="h-4 w-4" />
              质量控制
            </div>
            <p className="mt-2 text-xs leading-5 text-[#5f7565]">关键结论保留来源、期间、单位与口径；团队在报告发布前交叉验证并标注证据缺口。</p>
          </div>
          <div className="rounded-xl border border-[#e8e4dd] bg-[#faf9f6] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[#514d43]">
              <CheckCircle2 className="h-4 w-4" />
              运行依赖
            </div>
            <p className="mt-2 text-xs leading-5 text-[#777368]">团队复用当前 Cowork 的模型、联网搜索、内置 iFinD Skill 和已配置的聚源 MCP；单一来源不可用时自动换用另一绑定来源。</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-5 py-5">
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#888579]">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在读取专家团队
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-[#888579]">没有找到专家团队</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {filtered.map((team) => (
            <article
              key={team.id}
              className="group rounded-2xl border border-[#e5ded4] bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#d8c9bd] hover:shadow-md"
            >
              <div className="flex items-start gap-4">
                <TeamAvatar teamId={team.id} compact />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-base font-semibold text-[#29261b]">{team.name}</h3>
                    <span className="rounded-full bg-[#fff1e8] px-2 py-0.5 text-[10px] font-medium text-[#b85c3d]">内置</span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[#656358]">{team.description}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="rounded-lg bg-[#f5f2ed] px-2 py-1 text-[11px] text-[#6d695f]">{team.member_count} 位专家</span>
                <span className="rounded-lg bg-[#f5f2ed] px-2 py-1 text-[11px] text-[#6d695f]">{team.workflow_count} 个工作流</span>
                <span className={cn(
                  'ml-auto inline-flex items-center gap-1 text-[11px]',
                  team.available ? 'text-emerald-700' : 'text-amber-700',
                )}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', team.available ? 'bg-emerald-500' : 'bg-amber-500')} />
                  {team.available ? '可用' : '需要检查'}
                </span>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-[#eee9e2] pt-3">
                <button
                  onClick={() => void openDetail(team)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#656358] hover:text-[#29261b]"
                >
                  查看团队
                  {detailLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => startTeam(team)}
                  disabled={!team.available}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#29261b] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#423e31] disabled:opacity-40"
                >
                  <Play className="h-3 w-3 fill-current" />
                  启动团队
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
