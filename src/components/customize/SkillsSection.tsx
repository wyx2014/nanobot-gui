import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { fetchSkillDetail, fetchSkills, runSkillAction } from '@/core/api';
import { getNanobotStatus, getNanobotToken, refreshNanobotAuth } from '@/core/nanobotClient';
import type { NanobotSkillInfo, SkillsPayload } from '@/core/types';
import SubTabBar from './SubTabBar';
import { Toggle } from '@/components/ui/toggle';
import {
  AlertCircle,
  FileText,
  Loader2,
  Trash2,
  X,
  Clock,
  Github,
  Target,
  User,
  Terminal,
  CloudSun,
  Image,
  BookOpen,
  Cpu,
  Code,
  Download,
  Brain
} from 'lucide-react';

type SkillTab = 'builtin' | 'workspace';

function getSkillIcon(name: string) {
  const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    'cron': Clock,
    'github': Github,
    'long-goal': Target,
    'my': User,
    'tmux': Terminal,
    'weather': CloudSun,
    'image-generation': Image,
    'summarize': BookOpen,
    'update-setup': Cpu,
    'skill-creator': Code,
    'clawhub': Download,
    'memory': Brain,
  };
  const IconComponent = iconMap[name.toLowerCase()] || FileText;
  return <IconComponent className="h-4 w-4" />;
}

async function getSkillsAuth(): Promise<{ token: string; baseUrl: string }> {
  const status = await getNanobotStatus();
  if (!status.ready) {
    throw new Error('nanobot 服务尚未就绪');
  }
  const baseUrl = `http://127.0.0.1:${status.port}`;
  const token = getNanobotToken();
  if (token) return { token, baseUrl };
  const refreshed = await refreshNanobotAuth();
  return { token: refreshed.token, baseUrl: refreshed.baseUrl };
}

function sourceLabel(source: string): string {
  if (source === 'builtin') return '内置';
  if (source === 'workspace') return '工作区';
  return source || '未知';
}

function sourceClass(source: string): string {
  if (source === 'builtin') return 'bg-blue-50 text-blue-700 border-blue-100';
  if (source === 'workspace') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  return 'bg-neutral-100 text-neutral-600 border-neutral-200';
}

export default function SkillsSection({ manualCreateTrigger }: { manualCreateTrigger?: number }) {
  const { refresh: refreshDiscovery } = useDiscoveryStore();
  const { toolboxSearchQuery } = useSettingsStore();
  const [payload, setPayload] = useState<SkillsPayload | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<SkillTab>('builtin');
  const [detail, setDetail] = useState<NanobotSkillInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [actingName, setActingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { token, baseUrl } = await getSkillsAuth();
      const next = await fetchSkills(token, baseUrl);
      setPayload(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (manualCreateTrigger && manualCreateTrigger > 0) {
      setError('技能创建已交给 nanobot 原生 workspace/skills。当前面板先提供查看、启停和删除。');
    }
  }, [manualCreateTrigger]);

  const skills = payload?.skills ?? [];
  const search = toolboxSearchQuery.trim().toLowerCase();
  const filtered = useMemo(() => {
    return skills.filter((skill) => {
      if (activeSubTab === 'builtin' && skill.source !== 'builtin') return false;
      if (activeSubTab === 'workspace' && skill.source !== 'workspace') return false;
      if (!search) return true;
      return [
        skill.name,
        skill.description,
        skill.source,
        ...(skill.tags ?? []),
      ].some((value) => value.toLowerCase().includes(search));
    });
  }, [activeSubTab, search, skills]);

  const subTabs = [
    { id: 'builtin', label: '内置技能', count: skills.filter((skill) => skill.source === 'builtin').length },
    { id: 'workspace', label: '我的技能', count: skills.filter((skill) => skill.source === 'workspace').length },
  ];

  const applyPayload = async (next: SkillsPayload) => {
    setPayload(next);
    await refreshDiscovery();
  };

  const handleToggle = async (skill: NanobotSkillInfo) => {
    setActingName(skill.name);
    setError(null);
    try {
      const { token, baseUrl } = await getSkillsAuth();
      const next = await runSkillAction(token, skill.enabled ? 'disable' : 'enable', skill.name, baseUrl);
      await applyPayload(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActingName(null);
    }
  };

  const handleDelete = async (skill: NanobotSkillInfo) => {
    if (skill.source !== 'workspace') return;
    setActingName(skill.name);
    setError(null);
    try {
      const { token, baseUrl } = await getSkillsAuth();
      const next = await runSkillAction(token, 'delete', skill.name, baseUrl);
      await applyPayload(next);
      if (detail?.name === skill.name) setDetail(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActingName(null);
    }
  };

  const openDetail = async (skill: NanobotSkillInfo) => {
    setDetail(skill);
    setError(null);
    try {
      const { token, baseUrl } = await getSkillsAuth();
      const next = await fetchSkillDetail(token, skill.name, baseUrl);
      setDetail(next.skills[0] ?? skill);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 px-4 pt-4 pb-2">
        <SubTabBar
          tabs={subTabs}
          activeTab={activeSubTab}
          onChange={(id) => setActiveSubTab(id as SkillTab)}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            <div className="text-sm text-red-700">{error}</div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在读取 nanobot 技能
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-neutral-400">没有找到技能</div>
        ) : (
          <div className="space-y-2">
            {filtered.map((skill) => {
              const busy = actingName === skill.name;
              return (
                <div
                  key={`${skill.source}:${skill.name}`}
                  onClick={() => void openDetail(skill)}
                  className={`group flex cursor-pointer items-center gap-3 rounded-lg border border-neutral-200/70 bg-white p-3 transition-colors hover:border-neutral-300 ${
                    !skill.enabled ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500">
                    {getSkillIcon(skill.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-neutral-900">/{skill.name}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] ${sourceClass(skill.source)}`}>
                        {sourceLabel(skill.source)}
                      </span>
                      {!skill.available && (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                          依赖缺失
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs text-neutral-500">{skill.description}</p>
                    {!skill.available && skill.missing && (
                      <p className="mt-1 truncate text-[11px] text-amber-600">{skill.missing}</p>
                    )}
                  </div>
                  <Toggle
                    checked={skill.enabled}
                    onChange={() => void handleToggle(skill)}
                    disabled={busy}
                  />
                  {skill.source === 'workspace' && (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDelete(skill);
                      }}
                      disabled={busy}
                      className="shrink-0 rounded p-1.5 text-neutral-400 opacity-0 transition-colors hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 disabled:opacity-40"
                      title="删除我的技能"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {detail && (
        <div className="absolute inset-0 z-20 flex flex-col bg-[#faf9f5]">
          <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-neutral-500">
                  {getSkillIcon(detail.name)}
                </div>
                <h3 className="truncate text-base font-semibold text-neutral-900">/{detail.name}</h3>
                <span className={`rounded border px-1.5 py-0.5 text-[10px] ${sourceClass(detail.source)}`}>
                  {sourceLabel(detail.source)}
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-neutral-500">{detail.path}</p>
            </div>
            <button
              onClick={() => setDetail(null)}
              className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
              title="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            <p className="mb-4 text-sm leading-6 text-neutral-700">{detail.description}</p>
            {!detail.available && detail.missing && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                依赖缺失：{detail.missing}
              </div>
            )}
            <pre className="whitespace-pre-wrap rounded-lg border border-neutral-200 bg-white p-4 text-xs leading-5 text-neutral-700">
              {detail.content || '未读取到技能内容'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
