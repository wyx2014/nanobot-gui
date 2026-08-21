import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { usePromptHubStore } from '@/stores/promptHubStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useChatStore } from '@/stores/chatStore';
import { useI18n } from '@/i18n';
import { fetchSkillDetail, fetchSkills, runSkillAction, saveSkill } from '@/core/api';
import { getNanobotStatus, getNanobotToken, refreshNanobotAuth } from '@/core/nanobotClient';
import { fetchPromptHubSkills, publishPromptHubSkill } from '@/core/prompthubApi';
import { displaySkillName } from '@/core/skills/filter';
import type { NanobotSkillInfo, SkillsPayload } from '@/core/types';
import { ipc, shellBridge } from '@/lib/ipc-factory';
import SubTabBar from './SubTabBar';
import { Toggle } from '@/components/ui/toggle';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ITEM_NAME_RE } from '@/utils/validation';
import WindowModalBackdrop from '@/components/common/WindowModalBackdrop';
import {
  AlertCircle,
  FileText,
  Loader2,
  Trash2,
  X,
  Clock,
  Target,
  User,
  CloudSun,
  Code,
  Download,
  Brain,
  UploadCloud,
  FolderOpen
} from 'lucide-react';

type SkillTab = 'builtin' | 'workspace';

function getSkillIcon(name: string) {
  const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    'cron': Clock,
    'long-goal': Target,
    'my': User,
    'weather': CloudSun,
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
    throw new Error('TPACowork 服务尚未就绪');
  }
  const baseUrl = `http://127.0.0.1:${status.port}`;
  const token = getNanobotToken();
  if (token) return { token, baseUrl };
  const refreshed = await refreshNanobotAuth();
  return { token: refreshed.token, baseUrl: refreshed.baseUrl };
}

function sourceLabel(source: string, isEnglish: boolean): string {
  if (source === 'builtin') return isEnglish ? 'Built-in' : '内置';
  if (source === 'workspace') return isEnglish ? 'Workspace' : '工作区';
  return source || (isEnglish ? 'Unknown' : '未知');
}

function sourceClass(source: string): string {
  if (source === 'builtin') return 'bg-blue-50 text-blue-700 border-blue-100';
  if (source === 'workspace') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  return 'bg-neutral-100 text-neutral-600 border-neutral-200';
}

const builtinEnglishDescriptions: Record<string, string> = {
  'deep-research': 'Conduct in-depth research through multi-round search, cross-verification, and research reports.',
  'create-agent': 'Use AI guidance to create a custom agent.',
  'create-skill': 'Use AI guidance to create a custom skill.',
  'code-review': 'Review code, identify potential issues, and suggest improvements.',
  'schedule': 'Create and manage automations that run automatically at regular intervals.',
  'weekly-report': 'Generate a weekly report from completed work.',
  'translate': 'Translate between Chinese and English, including files and text.',
  'summarize': 'Summarize documents or text and extract key information.',
  'write-article': 'Create Xiaohongshu- or Douyin-style social-media articles from a topic and knowledge base.',
  'writing-plans': 'Create a detailed, step-by-step execution plan before implementing a multi-step task or architecture specification.',
};

function displaySkillDescription(skill: NanobotSkillInfo, isEnglish: boolean): string {
  return isEnglish && skill.source === 'builtin'
    ? builtinEnglishDescriptions[skill.name] ?? skill.description
    : skill.description;
}

function skillMarkdown(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description.trim())}\n---\n\n# ${name}\n\n${body.trim()}\n`;
}

function normalizeSkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

type SkillPackageFile = { path: string; content: Uint8Array };

export default function SkillsSection({ manualCreateTrigger }: { manualCreateTrigger?: number }) {
  const { locale } = useI18n();
  const isEnglish = locale === 'en-US';
  const { refresh: refreshDiscovery } = useDiscoveryStore();
  const removeProjectSkillBinding = useWorkspaceStore((s) => s.removeProjectSkillBinding);
  const { toolboxSearchQuery } = useSettingsStore();
  const promptHubBaseUrl = usePromptHubStore((s) => s.baseUrl);
  const promptHubToken = usePromptHubStore((s) => s.token);
  const [payload, setPayload] = useState<SkillsPayload | null>(null);
  const [hubSkillNames, setHubSkillNames] = useState<Set<string>>(new Set());
  const [activeSubTab, setActiveSubTab] = useState<SkillTab>('builtin');
  const [detail, setDetail] = useState<NanobotSkillInfo | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actingName, setActingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createBody, setCreateBody] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { token, baseUrl } = await getSkillsAuth();
      const next = await fetchSkills(token, baseUrl);
      setPayload(next);
      if (promptHubToken) {
        const hub = await fetchPromptHubSkills(promptHubBaseUrl, promptHubToken);
        setHubSkillNames(new Set((hub.records ?? []).map((skill) => (skill.slug || skill.name || '').toLowerCase()).filter(Boolean)));
      } else {
        setHubSkillNames(new Set());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [promptHubBaseUrl, promptHubToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (manualCreateTrigger && manualCreateTrigger > 0) {
      setError(null);
      setCreateOpen(true);
      setActiveSubTab('workspace');
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
        displaySkillName(skill.name),
        displaySkillDescription(skill, isEnglish),
        skill.source,
        ...(skill.tags ?? []),
      ].some((value) => value.toLowerCase().includes(search));
    });
  }, [activeSubTab, isEnglish, search, skills]);

  const subTabs = [
    { id: 'builtin', label: isEnglish ? 'Built-in Skills' : '内置技能', count: skills.filter((skill) => skill.source === 'builtin').length },
    { id: 'workspace', label: isEnglish ? 'My Skills' : '我的技能', count: skills.filter((skill) => skill.source === 'workspace').length },
  ];

  const applyPayload = async (next: SkillsPayload) => {
    setPayload(next);
    await refreshDiscovery();
  };

  const resetCreateForm = () => {
    setCreateName('');
    setCreateDescription('');
    setCreateBody('');
  };

  const handleCreate = async () => {
    const name = normalizeSkillName(createName);
    const description = createDescription.trim();
    const body = createBody.trim();
    if (!ITEM_NAME_RE.test(name)) {
      setError('技能名称只能使用英文小写、数字和连字符，且不能以连字符开头或结尾。');
      return;
    }
    if (!description || !body) {
      setError('请填写触发描述和技能说明。');
      return;
    }
    if (skills.some((skill) => skill.name === name)) {
      setError(`技能 /${name} 已存在。`);
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const { token, baseUrl } = await getSkillsAuth();
      const next = await saveSkill(token, name, skillMarkdown(name, description, body), baseUrl);
      await applyPayload(next);
      setActiveSubTab('workspace');
      setCreateOpen(false);
      resetCreateForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
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
      removeProjectSkillBinding(skill.name);
      useChatStore.setState((state) => {
        for (const conversation of Object.values(state.conversations)) {
          if (conversation.activeSkills) {
            conversation.activeSkills = conversation.activeSkills.filter((name) => name !== skill.name);
          }
        }
      });
      await applyPayload(next);
      if (detail?.name === skill.name) setDetail(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActingName(null);
    }
  };

  const handleUpload = async (skill: NanobotSkillInfo) => {
    if (!promptHubToken) {
      setError('请先在技能商店登录 PromptHub。');
      return;
    }
    setActingName(skill.name);
    setError(null);
    setMessage(null);
    try {
      const { token, baseUrl } = await getSkillsAuth();
      const next = await fetchSkillDetail(token, skill.name, baseUrl);
      const localSkill = next.skills[0];
      const files = localSkill?.path
        ? await ipc.invoke<SkillPackageFile[]>('skills:readPackage', localSkill.path)
        : [];
      if (!files.some((file) => file.path.toLowerCase() === 'skill.md')) throw new Error('未读取到本地技能包');
      await publishPromptHubSkill(promptHubBaseUrl, promptHubToken, {
        slug: skill.name,
        displayName: skill.name,
        files,
      });
      setHubSkillNames((names) => new Set(names).add(skill.name.toLowerCase()));
      setMessage(`已上传 /${skill.name} 到技能商店`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActingName(null);
    }
  };

  const openDetail = async (skill: NanobotSkillInfo) => {
    setDetail(skill);
    setDetailLoading(true);
    setError(null);
    try {
      const { token, baseUrl } = await getSkillsAuth();
      const next = await fetchSkillDetail(token, skill.name, baseUrl);
      setDetail(next.skills[0] ?? skill);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div data-skills-surface className="relative flex h-full flex-col overflow-hidden">
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
        {message && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <div className="text-sm text-emerald-700">{message}</div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            {isEnglish ? 'Loading skills' : '正在读取技能'}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-neutral-400">{isEnglish ? 'No skills found' : '没有找到技能'}</div>
        ) : (
          <div className="space-y-2">
            {filtered.map((skill) => {
              const busy = actingName === skill.name;
              return (
                <div
                  key={`${skill.source}:${skill.name}`}
                  onClick={() => void openDetail(skill)}
                  data-skill-card
                  data-enabled={skill.enabled ? "true" : "false"}
                  className="group flex cursor-pointer items-center gap-3 rounded-lg border border-neutral-200/70 bg-white p-3 transition-colors hover:border-neutral-300"
                >
                  <div data-skill-icon className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500">
                    {getSkillIcon(skill.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span data-skill-name className="truncate text-sm font-medium text-neutral-900">/{displaySkillName(skill.name)}</span>
                      <span data-skill-source={skill.source} className={`rounded border px-1.5 py-0.5 text-[10px] ${sourceClass(skill.source)}`}>
                        {sourceLabel(skill.source, isEnglish)}
                      </span>
                      {!skill.available && (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                          {isEnglish ? 'Dependency missing' : '依赖缺失'}
                        </span>
                      )}
                    </div>
                    <p data-skill-description className="mt-1 truncate text-xs text-neutral-500">{displaySkillDescription(skill, isEnglish)}</p>
                    {!skill.available && skill.missing && (
                      <p className="mt-1 truncate text-[11px] text-amber-600">{skill.missing}</p>
                    )}
                  </div>
                  <Toggle
                    checked={skill.enabled}
                    onChange={() => void handleToggle(skill)}
                    disabled={busy}
                  />
                  {skill.source === 'workspace' && !hubSkillNames.has(skill.name.toLowerCase()) && (
                    <button
                      data-skill-action="upload"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleUpload(skill);
                      }}
                      disabled={busy}
                      className="shrink-0 rounded p-1.5 text-neutral-400 opacity-0 transition-colors hover:bg-emerald-50 hover:text-emerald-600 group-hover:opacity-100 disabled:opacity-40"
                      title="上传到技能商店"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                    </button>
                  )}
                  {skill.source === 'workspace' && (
                    <button
                      data-skill-action="delete"
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
        <div data-skill-detail className="absolute inset-0 z-20 flex flex-col bg-[#faf9f5]">
          <div data-skill-detail-header className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-neutral-500">
                  {getSkillIcon(detail.name)}
                </div>
                <h3 className="truncate text-base font-semibold text-neutral-900">/{displaySkillName(detail.name)}</h3>
                <span data-skill-source={detail.source} className={`rounded border px-1.5 py-0.5 text-[10px] ${sourceClass(detail.source)}`}>
                  {sourceLabel(detail.source, isEnglish)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {detail.path ? (
                <button
                  onClick={() => {
                    const separator = detail.path.includes('\\') ? '\\' : '/';
                    const dir = detail.path.slice(0, detail.path.lastIndexOf(separator));
                    void shellBridge.openPath(dir || detail.path);
                  }}
                  className="rounded-lg p-2 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
                  title={isEnglish ? 'Open skill folder' : '打开技能目录'}
                >
                  <FolderOpen className="h-4 w-4" />
                </button>
              ) : null}
              <button
                onClick={() => setDetail(null)}
                className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            <p className="mb-4 text-sm leading-6 text-neutral-700">{displaySkillDescription(detail, isEnglish)}</p>
            {!detail.available && detail.missing && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                依赖缺失：{detail.missing}
              </div>
            )}
            {detailLoading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-neutral-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                {isEnglish ? 'Loading skill details...' : '正在读取技能详情'}
              </div>
            ) : (
              <pre className="whitespace-pre-wrap rounded-lg border border-neutral-200 bg-white p-4 text-xs leading-5 text-neutral-700">
                {detail.content || '未读取到技能内容'}
              </pre>
            )}
          </div>
        </div>
      )}

      {createOpen && (
        <div
          className="window-modal-viewport fixed inset-0 z-[9999] flex items-center justify-center"
          onClick={(event) => {
            if (event.target === event.currentTarget && !creating) setCreateOpen(false);
          }}
        >
          <WindowModalBackdrop />
          <div data-skill-create-dialog className="relative w-[520px] rounded-2xl border border-black/5 bg-white p-5 shadow-lg">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-[17px] font-semibold text-[#29261b]">创建技能</h3>
                <p className="mt-1 text-[13px] text-[#8a867c]">保存后会写入工作区的我的技能。</p>
              </div>
              <button
                onClick={() => setCreateOpen(false)}
                disabled={creating}
                className="rounded-lg p-1.5 text-[#656358] hover:bg-[#f5f3ee] hover:text-[#29261b] disabled:opacity-50"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-[#656358]">技能名称</span>
                <Input
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  onBlur={() => setCreateName(normalizeSkillName(createName))}
                  placeholder="stock-research-note"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-[#656358]">触发描述</span>
                <Textarea
                  value={createDescription}
                  onChange={(event) => setCreateDescription(event.target.value)}
                  className="min-h-[72px]"
                  placeholder="当用户需要按照固定格式整理股票研究笔记时使用"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-[#656358]">技能说明</span>
                <Textarea
                  value={createBody}
                  onChange={(event) => setCreateBody(event.target.value)}
                  className="min-h-[120px]"
                  placeholder="输出包含公司概况、核心财务、风险点、结论。"
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setCreateOpen(false)}
                disabled={creating}
                className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-[#656358] hover:bg-[#f5f3ee] disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={() => void handleCreate()}
                disabled={creating}
                className="inline-flex items-center gap-2 rounded-lg bg-[#29261b] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#3a3628] disabled:opacity-60"
              >
                {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
