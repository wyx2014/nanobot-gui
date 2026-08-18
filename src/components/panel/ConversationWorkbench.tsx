import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CodeXml,
  File,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  FolderOpen,
  Loader2,
  Minus,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n';
import { shellBridge } from '@/lib/ipc-factory';
import { useChatStore } from '@/stores/chatStore';
import {
  useConversationWorkbenchStore,
  type WorkbenchProgressSnapshot,
} from '@/stores/conversationWorkbenchStore';
import { useTurnPlanStore } from '@/stores/turnPlanStore';
import { useThreadResourceStore } from '@/stores/threadResourceStore';
import { usePreviewStore } from '@/stores/previewStore';
import { getGatewayBaseUrl, getNanobotToken } from '@/core/nanobotClient';
import { conversationIdToSessionKey } from '@/core/sessionKey';
import {
  fetchSessionArtifacts,
  normalizeSessionArtifactRecords,
  type SessionArtifact,
} from '@/core/sessionArtifacts';
import { fetchThreadResource } from '@/core/api';
import { projectThreadResource } from '@/core/nanobot/threadResourceProjection';
import { artifactPreviewKind } from '@/core/artifacts';

const EMPTY_PROGRESS: WorkbenchProgressSnapshot = {
  steps: [],
  isActive: false,
  source: 'empty',
};

const POLL_INTERVAL_MS = 5_000;

function artifactIcon(artifact: SessionArtifact): LucideIcon {
  const kind = artifactPreviewKind(artifact.ref);
  if (kind === 'image') return FileImage;
  if (kind === 'video') return Video;
  if (kind === 'xlsx' || kind === 'csv') return FileSpreadsheet;
  if (kind === 'html') return CodeXml;
  if (kind === 'markdown') return FileType;
  if (kind === 'code') return FileCode2;
  if (kind === 'pdf' || kind === 'docx' || kind === 'text') return FileText;
  return File;
}

function formatSize(size: number | undefined): string {
  if (size === undefined) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.max(0.1, size / 1024).toFixed(1)} KB`;
  return `${Math.max(0.1, size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatModifiedAt(value: string | number | undefined, locale: string): string {
  if (value === undefined) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Parent directory of a POSIX- or Windows-style absolute path. */
function dirnameOf(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');
  if (idx === -1) return normalized;
  if (idx === 0) return '/';
  return normalized.slice(0, idx);
}

export default function ConversationWorkbench() {
  const { locale, t } = useI18n();
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const conversationStatus = useChatStore((state) => (
    state.activeConversationId
      ? state.conversations[state.activeConversationId]?.status ?? 'idle'
      : 'idle'
  ));
  const workspacePath = useChatStore((state) => (
    activeConversationId
      ? state.conversations[activeConversationId]?.workspacePath ?? null
      : null
  ));
  const projectId = useChatStore((state) => (
    activeConversationId
      ? state.conversations[activeConversationId]?.projectId
      : undefined
  ));
  const sessionId = useChatStore((state) => (
    activeConversationId
      ? state.conversations[activeConversationId]?.sessionId
      : undefined
  ));
  const legacyTurnPlan = useTurnPlanStore((state) => (
    activeConversationId
      ? state.planByConversation[activeConversationId]
      : undefined
  ));
  const threadResource = useThreadResourceStore((state) => (
    activeConversationId
      ? state.resourcesBySession[conversationIdToSessionKey(activeConversationId)]
      : undefined
  ));
  const turnPlan = threadResource?.plan ?? legacyTurnPlan;
  const legacyProgress = useConversationWorkbenchStore((state) => (
    activeConversationId
      ? state.progressByConversation[activeConversationId]
      : undefined
  ));
  const progress: WorkbenchProgressSnapshot = turnPlan
    ? {
        steps: turnPlan.steps.map((step) => ({
          id: step.id,
          title: step.title,
          ...(step.detail ? { detail: step.detail } : {}),
          status: (
            step.status === 'inProgress'
              ? 'running'
              : step.status === 'failed'
                ? 'error'
                : step.status === 'cancelled'
                  ? 'interrupted'
                  : step.status
          ),
        })),
        ...(turnPlan.note ? { note: turnPlan.note } : {}),
        isActive: turnPlan.status === 'running' || turnPlan.status === 'inProgress',
        source: 'task_progress',
      }
    : threadResource
      ? EMPTY_PROGRESS
      : legacyProgress ?? EMPTY_PROGRESS;
  const artifactRevision = useConversationWorkbenchStore((state) => (
    activeConversationId
      ? state.artifactRevisionByConversation[activeConversationId] ?? 0
      : 0
  ));
  const openArtifact = usePreviewStore((state) => state.openArtifact);
  const [artifacts, setArtifacts] = useState<SessionArtifact[]>([]);
  const [loading, setLoading] = useState(false);
  const previewArtifact = usePreviewStore((state) => state.previewArtifact);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const artifactRevisionConversation = useRef<string | null>(null);
  const shouldPollActiveTurn = turnPlan
    ? progress.isActive
    : conversationStatus === 'running';
  const canonicalArtifacts = useMemo(() => {
    if (!activeConversationId || !threadResource) return null;
    return normalizeSessionArtifactRecords(
      getGatewayBaseUrl(),
      threadResource.session_key,
      threadResource.artifacts,
      workspacePath,
      {
        projectId: threadResource.project_id,
        sessionId: threadResource.session_id,
      },
    );
  }, [activeConversationId, threadResource, workspacePath]);

  const refreshArtifacts = useCallback(async () => {
    if (!activeConversationId) return;
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const key = conversationIdToSessionKey(activeConversationId);
      const currentResource = useThreadResourceStore.getState().resourcesBySession[key];
      let rows: SessionArtifact[];
      if (currentResource) {
        const refreshed = await fetchThreadResource(
          getNanobotToken(),
          key,
          getGatewayBaseUrl(),
        );
        if (!refreshed) throw new Error('Thread Resource is unavailable.');
        projectThreadResource(activeConversationId, refreshed);
        rows = normalizeSessionArtifactRecords(
          getGatewayBaseUrl(),
          refreshed.session_key,
          refreshed.artifacts,
          workspacePath,
          { projectId: refreshed.project_id, sessionId: refreshed.session_id },
        );
      } else {
        rows = await fetchSessionArtifacts(
          getNanobotToken(),
          key,
          getGatewayBaseUrl(),
          workspacePath,
          { projectId, sessionId },
        );
      }
      if (requestId !== requestSequence.current) return;
      setArtifacts(rows);
    } catch (loadError) {
      if (requestId !== requestSequence.current) return;
      console.warn('[ConversationWorkbench] Failed to load artifacts:', loadError);
      setError(loadError instanceof Error ? loadError.message : t.panel.artifactsLoadFailed);
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
      }
    }
  }, [activeConversationId, projectId, sessionId, t.panel.artifactsLoadFailed, workspacePath]);

  useEffect(() => {
    requestSequence.current += 1;
    setArtifacts([]);
    setError(null);
    if (canonicalArtifacts) {
      setArtifacts(canonicalArtifacts);
      setLoading(false);
      return;
    }
    setLoading(!!activeConversationId);
    if (activeConversationId) void refreshArtifacts();
  }, [activeConversationId, canonicalArtifacts, refreshArtifacts]);

  useEffect(() => {
    if (artifactRevisionConversation.current !== activeConversationId) {
      artifactRevisionConversation.current = activeConversationId;
      return;
    }
    if (!activeConversationId || artifactRevision === 0) return;
    void refreshArtifacts();
  }, [activeConversationId, artifactRevision, refreshArtifacts]);

  useEffect(() => {
    const hasStagingArtifact = artifacts.some((artifact) => artifact.status === 'staging');
    if (
      !activeConversationId
      || (!shouldPollActiveTurn && !hasStagingArtifact)
    ) return;
    const timer = window.setInterval(() => {
      void refreshArtifacts();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [activeConversationId, artifacts, refreshArtifacts, shouldPollActiveTurn]);

  const openArtifactFolder = useCallback(async () => {
    // Prefer the currently previewed artifact, otherwise the first ready one.
    const ready = artifacts.find((artifact) => artifact.status === 'ready');
    const nativePath = previewArtifact?.nativePath ?? ready?.ref.nativePath;
    const folder = nativePath ? dirnameOf(nativePath) : workspacePath;
    if (folder) {
      try {
        await shellBridge.openPath(folder);
      } catch (openError) {
        console.warn('[ConversationWorkbench] Failed to open artifact folder:', openError);
      }
    }
  }, [artifacts, previewArtifact, workspacePath]);

  const artifactStatusLabel = useCallback((artifact: SessionArtifact): string => {
    if (artifact.status === 'ready') return '';
    if (artifact.status === 'staging') return locale.startsWith('zh') ? '生成中' : 'Generating';
    if (artifact.status === 'failed') return locale.startsWith('zh') ? '生成失败' : 'Failed';
    if (artifact.status === 'missing') return locale.startsWith('zh') ? '文件缺失' : 'Missing';
    return locale.startsWith('zh') ? '已隔离' : 'Quarantined';
  }, [locale]);

  const completedStepCount = progress.steps.filter((step) => (
    step.status === 'completed' || step.status === 'skipped'
  )).length;

  return (
    <div
      data-conversation-summary
      className="flex max-h-[min(72vh,680px)] min-h-0 flex-col overflow-hidden rounded-[20px] border border-[#dcd8d0] bg-[#fbfaf7] shadow-lg dark:border-white/10 dark:bg-[#222] dark:shadow-lg"
    >
      <section
        data-summary-section="progress"
        className="shrink-0 px-4 py-4"
        aria-label={t.panel.progress}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#656358] dark:text-[#b8b4ab]">
            {t.panel.progress}
          </h2>
          {progress.steps.length ? (
            <span className="text-[11px] tabular-nums text-[#9a968c] dark:text-[#88847c]">
              {completedStepCount}/{progress.steps.length}
            </span>
          ) : null}
        </div>

        {progress.steps.length ? (
          <>
            {progress.note ? (
              <p className="mb-3 text-[12px] leading-5 text-[#656358] dark:text-[#aaa69e]">{progress.note}</p>
            ) : null}
            <ol className="no-scrollbar max-h-[240px] space-y-[9px] overflow-y-auto pr-1">
              {progress.steps.map((step) => (
                <li key={step.id} className="grid min-w-0 grid-cols-[16px_minmax(0,1fr)] items-start gap-2">
                  <span
                    className={cn(
                      'mt-0.5 flex h-3 w-3 items-center justify-center border',
                      step.status === 'completed' && 'rounded-[3px] border-teal-500 bg-teal-500 text-white',
                      step.status === 'running' && 'rounded-full border-[#d97757] bg-[#d97757] shadow-[inset_0_0_0_3px_#fbfaf7] dark:shadow-[inset_0_0_0_3px_#222]',
                      step.status === 'pending' && 'rounded-[3px] border-[#aaa69c] bg-transparent',
                      step.status === 'error' && 'rounded-full border-red-500 bg-red-50 text-red-600 dark:bg-red-950/30',
                      (step.status === 'skipped' || step.status === 'interrupted')
                        && 'rounded-[3px] border-[#bbb7ad] bg-transparent text-[#9a968c]',
                    )}
                  >
                    {step.status === 'completed' ? <Check className="h-2.5 w-2.5 stroke-[2.4]" /> : null}
                    {step.status === 'error' ? <AlertCircle className="h-2.5 w-2.5" /> : null}
                    {step.status === 'skipped' || step.status === 'interrupted'
                      ? <Minus className="h-2.5 w-2.5" />
                      : null}
                  </span>
                  <div className="min-w-0">
                    <div
                      className={cn(
                        'text-[12.5px] leading-[1.35]',
                        step.status === 'running' && 'font-medium text-[#29261b] dark:text-[#efebe3]',
                        step.status === 'completed' && 'text-[#8d897f] dark:text-[#969188]',
                        step.status === 'pending' && 'text-[#8b887c] dark:text-[#8f8a82]',
                        step.status === 'error' && 'text-red-600 dark:text-red-400',
                        (step.status === 'skipped' || step.status === 'interrupted')
                          && 'text-[#aaa69b] line-through decoration-[1px] dark:text-[#77736c]',
                      )}
                    >
                      {step.title}
                    </div>
                    {step.detail ? (
                      <div className="truncate text-[11px] text-[#9a968c] dark:text-[#817d75]">{step.detail}</div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
            {progress.isActive ? (
              <p className="mt-3 text-[11.5px] leading-5 text-[#9a968c] dark:text-[#88847c]">{t.panel.progressRunning}</p>
            ) : null}
          </>
        ) : (
          <p className="py-2 text-[12px] leading-5 text-[#8b887c] dark:text-[#918d85]">
            {progress.isActive ? t.panel.progressPlanning : t.panel.progressEmptyHint}
          </p>
        )}
      </section>

      <section
        data-summary-section="artifacts"
        className="flex min-h-0 flex-col border-t border-[#e5e2db] dark:border-white/10"
        aria-label={t.panel.artifacts}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-2 pt-4">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#656358] dark:text-[#b8b4ab]">
              {t.panel.artifacts}
            </h2>
            {artifacts.length ? (
              <span className="text-[11px] text-[#9a968c] dark:text-[#88847c]">{artifacts.length}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => void openArtifactFolder()}
              className="rounded-md p-1.5 text-[#8b887c] transition-colors hover:bg-[#ebe8e1] hover:text-[#29261b] disabled:opacity-50 dark:text-[#969188] dark:hover:bg-white/10 dark:hover:text-white"
              aria-label={t.panel.artifactsOpenFolder}
              title={t.panel.artifactsOpenFolder}
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="no-scrollbar min-h-0 max-h-[300px] overflow-y-auto px-3 pb-4">
          {loading && !artifacts.length ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-[#d97757]" />
            </div>
          ) : error && !artifacts.length ? (
            <div className="mx-1 rounded-xl border border-red-100 bg-red-50/70 px-3 py-3 text-center">
              <p className="text-[12px] text-red-600">{t.panel.artifactsLoadFailed}</p>
              <p className="mt-1 break-words text-[10.5px] leading-4 text-red-500">{error}</p>
              <button
                type="button"
                onClick={() => void refreshArtifacts()}
                className="mt-2 text-[11px] font-medium text-red-600 underline underline-offset-2"
              >
                {t.panel.artifactsRetry}
              </button>
            </div>
          ) : artifacts.length ? (
            <ul className="space-y-1">
              {artifacts.map((artifact) => {
                const Icon = artifactIcon(artifact);
                const size = formatSize(artifact.size);
                const modifiedAt = formatModifiedAt(artifact.modifiedAt, locale);
                const statusLabel = artifactStatusLabel(artifact);
                return (
                  <li key={artifact.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (artifact.status === 'ready') openArtifact(artifact.ref);
                      }}
                      disabled={artifact.status !== 'ready'}
                      className="group grid w-full min-w-0 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 rounded-[9px] border border-transparent px-2 py-2 text-left transition-colors hover:border-[#e3dfd7] hover:bg-white dark:hover:border-white/10 dark:hover:bg-white/[0.06]"
                      title={artifact.errorMessage || artifact.path}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center text-[#77746b] dark:text-[#aaa69e]">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium text-[#29261b] dark:text-[#ebe7df]">
                          {artifact.name}
                        </span>
                        {(size || modifiedAt) ? (
                          <span className="mt-0.5 block truncate text-[10.5px] text-[#9a968c] dark:text-[#817d75]">
                            {[size, modifiedAt].filter(Boolean).join(' · ')}
                          </span>
                        ) : null}
                        {artifact.status === 'failed' && artifact.errorMessage ? (
                          <span className="mt-0.5 block truncate text-[10.5px] text-red-500">
                            {artifact.errorMessage}
                          </span>
                        ) : null}
                      </span>
                      {statusLabel ? (
                        <span className="text-[11px] text-[#aaa69c] transition-colors group-hover:text-[#656358] dark:text-[#817d75] dark:group-hover:text-[#bbb7ae]">
                          {artifact.status === 'staging' ? (
                            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                          ) : null}
                          {statusLabel}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mx-1 flex min-h-20 flex-col items-center justify-center rounded-xl border border-dashed border-[#ddd9d0] bg-white/40 px-4 py-4 text-center dark:border-white/10 dark:bg-white/[0.03]">
              <FileText className="mb-2 h-5 w-5 text-[#aaa69c]" />
              <p className="text-[12px] leading-5 text-[#8b887c] dark:text-[#918d85]">{t.panel.artifactsEmptyHint}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
