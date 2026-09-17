import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Download, FileText, Loader2, RefreshCw, Store, X } from 'lucide-react';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { usePromptHubStore } from '@/stores/promptHubStore';
import { useSettingsStore } from '@/stores/settingsStore';
import CenteredLoadingIndicator from '@/components/common/CenteredLoadingIndicator';
import { fetchSkills, runSkillAction } from '@/core/api';
import { getNanobotStatus, getNanobotToken, refreshNanobotAuth } from '@/core/nanobotClient';
import {
  fetchPromptHubFile,
  fetchPromptHubSkillDetail,
  fetchPromptHubSkills,
  type PromptHubSkill,
  type PromptHubSkillDetail,
} from '@/core/prompthubApi';
import type { NanobotSkillInfo } from '@/core/types';
import { ipc } from '@/lib/ipc-factory';
import { useI18n } from '@/i18n';

async function getSkillsAuth(): Promise<{ token: string; baseUrl: string }> {
  const status = await getNanobotStatus();
  if (!status.ready) throw new Error('TP Cowork 服务尚未就绪');
  const baseUrl = `http://127.0.0.1:${status.port}`;
  const token = getNanobotToken();
  if (token) return { token, baseUrl };
  const refreshed = await refreshNanobotAuth();
  return { token: refreshed.token, baseUrl: refreshed.baseUrl };
}

function skillKey(skill: PromptHubSkill): string {
  return (skill.slug || skill.name || skill.displayName || skill.id).trim();
}

function skillTitle(skill: PromptHubSkill): string {
  return skill.displayName || skill.name || skill.slug || skill.id;
}

function skillDescription(skill: PromptHubSkill, isEnglish = false): string {
  return skill.description || skill.summary || (isEnglish ? 'No description available' : '暂无描述');
}

function tagList(skill: PromptHubSkill): string[] {
  if (Array.isArray(skill.tags)) return skill.tags.map((tag) => tag.trim()).filter(Boolean);
  return (skill.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean);
}

function reviewLabel(status: string | undefined, isEnglish = false): string | null {
  if (status === 'pending') return isEnglish ? 'Under review' : '审核中';
  if (status === 'rejected') return isEnglish ? 'Rejected' : '已拒绝';
  return null;
}

function firstSkillFile(files: { path: string }[]): string | null {
  return files.find((file) => ['skill.md', 'skills.md'].includes(file.path.toLowerCase()))?.path ?? null;
}

type StoreSkillFile = { path: string; content: string };

export default function SkillStoreSection() {
  const { locale } = useI18n();
  const isEnglish = locale === 'en-US';
  const { toolboxSearchQuery } = useSettingsStore();
  const refreshDiscovery = useDiscoveryStore((s) => s.refresh);
  const {
    baseUrl,
    token,
    openLogin,
  } = usePromptHubStore();

  const [hubSkills, setHubSkills] = useState<PromptHubSkill[]>([]);
  const [localSkills, setLocalSkills] = useState<NanobotSkillInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [detail, setDetail] = useState<PromptHubSkillDetail | null>(null);
  const [detailContent, setDetailContent] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [hubPage, auth] = await Promise.all([
        fetchPromptHubSkills(baseUrl, token),
        getSkillsAuth(),
      ]);
      const local = await fetchSkills(auth.token, auth.baseUrl);
      setHubSkills(hubPage.records ?? []);
      setLocalSkills(local.skills.filter((skill) => skill.source === 'workspace'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [baseUrl, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const search = toolboxSearchQuery.trim().toLowerCase();
  const filteredHubSkills = useMemo(() => (
    hubSkills.filter((skill) => {
      const approved = skill.visibility === 'public' && skill.approvalStatus === 'approved';
      const submitted = skill.approvalStatus === 'pending' || skill.approvalStatus === 'rejected';
      if (!approved && !submitted) return false;
      if (!search) return true;
      return [skillKey(skill), skillTitle(skill), skillDescription(skill), tagList(skill).join(' ')]
        .some((value) => value.toLowerCase().includes(search));
    })
  ), [hubSkills, search]);

  const handleDownload = async (skill: PromptHubSkill) => {
    setActing(`download:${skill.id}`);
    setError(null);
    setMessage(null);
    try {
      const detail = await fetchPromptHubSkillDetail(baseUrl, token!, skill.id);
      const filePath = detail.latestVersion?.id ? firstSkillFile(detail.files) : null;
      if (!detail.latestVersion?.id || !filePath) throw new Error(isEnglish ? 'This skill has no downloadable SKILL.md file.' : '该技能没有可下载的 SKILL.md');
      const files = await Promise.all(
        detail.files.map((file) => fetchPromptHubFile(baseUrl, token!, detail.latestVersion!.id, file.path)),
      );
      const auth = await getSkillsAuth();
      const name = skillKey(detail.skill);
      await ipc.invoke<void>('skills:writePackage', {
        name,
        files: files.map((file): StoreSkillFile => ({ path: file.path, content: file.content })),
      });
      await runSkillAction(auth.token, 'enable', name, auth.baseUrl);
      await refreshDiscovery();
      setMessage(isEnglish ? `Downloaded /${name} to My Skills` : `已下载 /${name} 到我的技能`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActing(null);
    }
  };

  const openDetail = async (skill: PromptHubSkill) => {
    setDetail({ skill, latestVersion: null, files: [] });
    setDetailContent(null);
    setDetailLoading(true);
    setError(null);
    try {
      const next = await fetchPromptHubSkillDetail(baseUrl, token!, skill.id);
      setDetail(next);
      const filePath = next.latestVersion?.id ? firstSkillFile(next.files) : null;
      if (next.latestVersion?.id && filePath) {
        const file = await fetchPromptHubFile(baseUrl, token!, next.latestVersion.id, filePath);
        setDetailContent(file.content);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  };

  if (!token) {
    return (
      <div data-skill-store-surface className="flex h-full flex-col">
        <header data-page-section-heading>
          <h2>{isEnglish ? 'Skill Store' : '技能商店'}</h2>
          <p>{isEnglish ? 'Discover skills for research and everyday work.' : '发现并添加适合研究与办公的技能。'}</p>
        </header>
        <div data-skill-store-login className="m-auto flex max-w-[430px] flex-col items-center px-6 py-12 text-center">
          <span className="cowork-empty-icon mb-4"><Store className="h-8 w-8" strokeWidth={1.55} /></span>
          <h3 data-skill-store-login-title className="text-[17px] font-medium">{isEnglish ? 'Sign in to explore skills' : '登录后探索更多技能'}</h3>
          <p data-skill-store-login-description className="mt-2 text-xs leading-5 text-[#656358]">
            {isEnglish ? 'Sign in to browse the Skill Store and download approved skills.' : '登录后即可查看技能商店并下载已审核发布的技能。'}
          </p>
          <button
            data-skill-store-action="login"
            onClick={openLogin}
            className="mt-4 rounded-lg bg-[#29261b] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#3a3628]"
          >
            {isEnglish ? 'Sign in' : '去登录'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-skill-store-surface className="relative flex h-full flex-col overflow-hidden">
      <header data-page-section-heading>
        <h2>{isEnglish ? 'Skill Store' : '技能商店'}</h2>
        <p>{isEnglish ? 'Discover skills for research and everyday work.' : '发现并添加适合研究与办公的技能。'}</p>
      </header>
      <div data-toolbox-list-body className="flex-1 overflow-y-auto px-4 py-4">
        {(error || message) && (
          <div className={`mb-4 flex items-start gap-2 rounded-lg border p-3 ${
            error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}>
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="text-sm">{error || message}</div>
          </div>
        )}

        {loading ? (
          <CenteredLoadingIndicator
            label={isEnglish ? 'Loading Skill Store...' : '正在读取技能商店'}
            className="min-h-[240px]"
          />
        ) : (
          <div data-toolbox-card-grid className="space-y-2">
            {filteredHubSkills.length === 0 ? (
              <div className="py-8 text-center text-sm text-neutral-400">{isEnglish ? 'No skills found in the store' : '没有找到商店技能'}</div>
            ) : filteredHubSkills.map((skill) => {
              const key = skillKey(skill);
              const approved = skill.visibility === 'public' && skill.approvalStatus === 'approved';
              const installed = approved && localSkills.some((item) => item.name.toLowerCase() === key.toLowerCase());
              const busy = acting === `download:${skill.id}`;
              const review = reviewLabel(skill.approvalStatus, isEnglish);
              return (
                <div
                  key={skill.id}
                  onClick={() => void openDetail(skill)}
                  data-skill-store-card
                  className="group flex cursor-pointer items-center gap-3 rounded-lg border border-neutral-200/70 bg-white p-3 transition-colors hover:border-neutral-300"
                >
                  <div data-skill-store-icon className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span data-skill-store-name className="truncate text-sm font-medium text-neutral-900">/{key}</span>
                      <span data-skill-store-badge className="rounded border border-orange-100 bg-orange-50 px-1.5 py-0.5 text-[10px] text-orange-700">
                        {isEnglish ? 'Store' : '商店'}
                      </span>
                      {review && (
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${
                          skill.approvalStatus === 'rejected'
                            ? 'border-red-100 bg-red-50 text-red-700'
                            : 'border-amber-100 bg-amber-50 text-amber-700'
                        }`}>
                          {review}
                        </span>
                      )}
                      {installed && (
                        <span className="rounded border border-emerald-100 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                          {isEnglish ? 'Installed' : '已安装'}
                        </span>
                      )}
                    </div>
                    <p data-skill-store-description className="mt-1 truncate text-xs text-neutral-500">{skillDescription(skill, isEnglish)}</p>
                    {tagList(skill).length > 0 && (
                      <p className="mt-1 truncate text-[11px] text-[#8a867c]">{tagList(skill).join(' · ')}</p>
                    )}
                  </div>
                  {approved && (
                    <button
                      data-skill-store-action="download"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDownload(skill);
                      }}
                      disabled={busy}
                      className="shrink-0 rounded p-1.5 text-neutral-400 opacity-0 transition-colors hover:bg-orange-50 hover:text-orange-600 group-hover:opacity-100 disabled:opacity-40"
                      title={installed ? (isEnglish ? 'Update skill' : '更新技能') : (isEnglish ? 'Download to My Skills' : '下载到我的技能')}
                    >
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : installed ? (
                        <RefreshCw className="h-4 w-4" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {detail && (
        <div data-skill-store-detail className="absolute inset-0 z-20 flex flex-col bg-[#faf9f5]">
          <div data-skill-detail-header className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-neutral-500" />
                <h3 className="truncate text-base font-semibold text-neutral-900">/{skillKey(detail.skill)}</h3>
                <span data-skill-store-badge className="rounded border border-orange-100 bg-orange-50 px-1.5 py-0.5 text-[10px] text-orange-700">
                  {isEnglish ? 'Store' : '商店'}
                </span>
                {reviewLabel(detail.skill.approvalStatus, isEnglish) && (
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] ${
                    detail.skill.approvalStatus === 'rejected'
                      ? 'border-red-100 bg-red-50 text-red-700'
                      : 'border-amber-100 bg-amber-50 text-amber-700'
                  }`}>
                    {reviewLabel(detail.skill.approvalStatus, isEnglish)}
                  </span>
                )}
              </div>
              <p className="mt-1 truncate text-xs text-neutral-500">
                {detail.latestVersion?.version ? `${isEnglish ? 'Version' : '版本'} ${detail.latestVersion.version}` : (isEnglish ? 'No version information' : '暂无版本信息')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {detail.skill.visibility === 'public' && detail.skill.approvalStatus === 'approved' && (
                <button
                  data-skill-store-action="download"
                  onClick={() => void handleDownload(detail.skill)}
                  disabled={acting === `download:${detail.skill.id}`}
                  className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40"
                  title={isEnglish ? 'Download to My Skills' : '下载到我的技能'}
                >
                  {acting === `download:${detail.skill.id}` ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </button>
              )}
              <button
                data-skill-store-action="close"
                onClick={() => setDetail(null)}
                className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                title={isEnglish ? 'Close' : '关闭'}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            <p className="mb-4 text-sm leading-6 text-neutral-700">{skillDescription(detail.skill, isEnglish)}</p>
            {tagList(detail.skill).length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {tagList(detail.skill).map((tag) => (
                  <span key={tag} className="rounded border border-neutral-200 bg-white px-2 py-0.5 text-[11px] text-neutral-500">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {detailLoading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-neutral-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                {isEnglish ? 'Loading skill details...' : '正在读取技能详情'}
              </div>
            ) : (
              <pre className="whitespace-pre-wrap rounded-lg border border-neutral-200 bg-white p-4 text-xs leading-5 text-neutral-700">
                {detailContent || (isEnglish ? 'Skill content could not be loaded.' : '未读取到技能内容')}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
