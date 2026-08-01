import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronRight,
  File,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Globe2,
  Loader2,
  Minus,
  RefreshCw,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n';
import { useChatStore } from '@/stores/chatStore';
import {
  useConversationWorkbenchStore,
  type WorkbenchProgressSnapshot,
} from '@/stores/conversationWorkbenchStore';
import { useTurnPlanStore } from '@/stores/turnPlanStore';
import { usePreviewStore } from '@/stores/previewStore';
import { useBrowserStore } from '@/stores/browserStore';
import { getGatewayBaseUrl, getNanobotToken } from '@/core/nanobotClient';
import { conversationIdToSessionKey } from '@/core/sessionKey';
import { fetchSessionArtifacts, type SessionArtifact } from '@/core/sessionArtifacts';
import { artifactNativePath, artifactPreviewKind } from '@/core/artifacts';
import { shellBridge } from '@/lib/ipc-factory';

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
  if (kind === 'code') return FileCode2;
  if (kind === 'pdf' || kind === 'docx' || kind === 'markdown' || kind === 'text' || kind === 'html') {
    return FileText;
  }
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

export default function ConversationWorkbench() {
  const { locale, t } = useI18n();
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const browserFrameAvailable = useBrowserStore((state) => (
    activeConversationId
      ? Boolean(state.sessions[activeConversationId]?.frame)
      : false
  ));
  const openBrowserPanel = useBrowserStore((state) => state.openPanel);
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
  const turnPlan = useTurnPlanStore((state) => (
    activeConversationId
      ? state.planByConversation[activeConversationId]
      : undefined
  ));
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
    : legacyProgress ?? EMPTY_PROGRESS;
  const progressCompleted = turnPlan
    ? turnPlan.status === 'completed'
    : progress.steps.length > 0
      && progress.steps.every((step) => step.status === 'completed' || step.status === 'skipped');
  const [progressExpanded, setProgressExpanded] = useState(() => !progressCompleted);
  const progressDisplayState = useRef({
    conversationId: activeConversationId,
    completed: progressCompleted,
    active: progress.isActive,
  });
  const artifactRevision = useConversationWorkbenchStore((state) => (
    activeConversationId
      ? state.artifactRevisionByConversation[activeConversationId] ?? 0
      : 0
  ));
  const openArtifact = usePreviewStore((state) => state.openArtifact);
  const [artifacts, setArtifacts] = useState<SessionArtifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const artifactRevisionConversation = useRef<string | null>(null);
  const shouldPollActiveTurn = turnPlan
    ? progress.isActive
    : conversationStatus === 'running';

  useEffect(() => {
    const previous = progressDisplayState.current;
    if (previous.conversationId !== activeConversationId) {
      progressDisplayState.current = {
        conversationId: activeConversationId,
        completed: progressCompleted,
        active: progress.isActive,
      };
      setProgressExpanded(progress.isActive || !progressCompleted);
      return;
    }

    if (progress.isActive) {
      setProgressExpanded(true);
    } else if (
      progressCompleted
      && (previous.active || !previous.completed)
    ) {
      setProgressExpanded(false);
    }

    progressDisplayState.current = {
      conversationId: activeConversationId,
      completed: progressCompleted,
      active: progress.isActive,
    };
  }, [activeConversationId, progress.isActive, progressCompleted]);

  const refreshArtifacts = useCallback(async (background = false) => {
    if (!activeConversationId) return;
    const requestId = ++requestSequence.current;
    if (background) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const rows = await fetchSessionArtifacts(
        getNanobotToken(),
        conversationIdToSessionKey(activeConversationId),
        getGatewayBaseUrl(),
        workspacePath,
        { projectId, sessionId },
      );
      if (requestId !== requestSequence.current) return;
      setArtifacts(rows);
    } catch (loadError) {
      if (requestId !== requestSequence.current) return;
      console.warn('[ConversationWorkbench] Failed to load artifacts:', loadError);
      setError(loadError instanceof Error ? loadError.message : t.panel.artifactsLoadFailed);
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [activeConversationId, projectId, sessionId, t.panel.artifactsLoadFailed, workspacePath]);

  useEffect(() => {
    requestSequence.current += 1;
    setArtifacts([]);
    setError(null);
    setLoading(!!activeConversationId);
    if (activeConversationId) void refreshArtifacts(false);
  }, [activeConversationId, refreshArtifacts]);

  useEffect(() => {
    if (artifactRevisionConversation.current !== activeConversationId) {
      artifactRevisionConversation.current = activeConversationId;
      return;
    }
    if (!activeConversationId || artifactRevision === 0) return;
    void refreshArtifacts(true);
  }, [activeConversationId, artifactRevision, refreshArtifacts]);

  useEffect(() => {
    const hasStagingArtifact = artifacts.some((artifact) => artifact.status === 'staging');
    if (
      !activeConversationId
      || (!shouldPollActiveTurn && !hasStagingArtifact)
    ) return;
    const timer = window.setInterval(() => {
      void refreshArtifacts(true);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [activeConversationId, artifacts, refreshArtifacts, shouldPollActiveTurn]);

  const artifactStatusLabel = useCallback((artifact: SessionArtifact): string => {
    if (artifact.status === 'ready') return locale.startsWith('zh') ? '打开' : 'Open';
    if (artifact.status === 'staging') return locale.startsWith('zh') ? '生成中' : 'Generating';
    if (artifact.status === 'failed') return locale.startsWith('zh') ? '生成失败' : 'Failed';
    if (artifact.status === 'missing') return locale.startsWith('zh') ? '文件缺失' : 'Missing';
    return locale.startsWith('zh') ? '已隔离' : 'Quarantined';
  }, [locale]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f7f5f0] dark:bg-[#202020]">
      <div className="shrink-0 border-b border-[#e5e2db] dark:border-[#3d3d3d] px-4 pb-3 pt-10">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] font-semibold text-[#29261b] dark:text-[#f3f0e8]">{t.panel.workbench}</div>
          {activeConversationId && browserFrameAvailable ? (
            <button
              type="button"
              onClick={() => openBrowserPanel(activeConversationId)}
              className="flex h-7 items-center gap-1.5 rounded-md border border-[#dedacf] bg-white px-2 text-[11px] text-[#656158] shadow-sm transition-colors hover:bg-[#f3f0e9] dark:border-[#454545] dark:bg-[#2a2a2a] dark:text-[#c4c0b6] dark:hover:bg-[#333]"
              title={t.panel.browserShow}
              aria-label={t.panel.browserShow}
            >
              <Globe2 className="h-3.5 w-3.5" />
              {t.panel.browserTitle}
            </button>
          ) : null}
        </div>
      </div>

      <section className="shrink-0 border-b border-[#e5e2db] dark:border-[#3d3d3d] px-4 py-4" aria-label={t.panel.progress}>
        <button
          type="button"
          className={cn(
            'flex w-full items-center justify-between gap-3 rounded-md text-left',
            progressExpanded && 'mb-3',
          )}
          onClick={() => setProgressExpanded((expanded) => !expanded)}
          aria-expanded={progressExpanded}
        >
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#656358]">
            {t.panel.progress}
          </h2>
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 text-[#8b887c] transition-transform duration-200',
              progressExpanded && 'rotate-90',
            )}
          />
        </button>

        {progressExpanded ? (
          progress.steps.length ? (
            <>
              {progress.note ? (
                <p className="mb-3 text-[12px] leading-5 text-[#656358]">{progress.note}</p>
              ) : null}
              <ol className="space-y-[9px]">
                {progress.steps.map((step) => {
                  return (
                    <li key={step.id} className="grid min-w-0 grid-cols-[16px_minmax(0,1fr)] items-start gap-2">
                      <span
                        className={cn(
                          'mt-0.5 flex h-3 w-3 items-center justify-center border',
                          step.status === 'completed' && 'rounded-[3px] border-[#d97757] bg-[#d97757] text-white',
                          step.status === 'running' && 'rounded-full border-[#d97757] bg-[#d97757] shadow-[inset_0_0_0_3px_#f7f5f0]',
                          step.status === 'pending' && 'rounded-[3px] border-[#aaa69c] bg-transparent',
                          step.status === 'error' && 'rounded-full border-red-500 bg-red-50 text-red-600',
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
                            step.status === 'running' && 'font-medium text-[#29261b]',
                            step.status === 'completed' && 'text-[#9a968c] line-through decoration-[1px]',
                            step.status === 'pending' && 'text-[#8b887c]',
                            step.status === 'error' && 'text-red-600',
                            (step.status === 'skipped' || step.status === 'interrupted')
                              && 'text-[#aaa69b] line-through decoration-[1px]',
                          )}
                        >
                          {step.title}
                        </div>
                        {step.detail ? (
                          <div className="truncate text-[11px] text-[#9a968c]">{step.detail}</div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
              {progress.isActive ? (
                <p className="mt-3 text-[11.5px] leading-5 text-[#9a968c]">{t.panel.progressRunning}</p>
              ) : null}
            </>
          ) : (
            <p className="rounded-xl border border-dashed border-[#ddd9d0] bg-white/50 px-3 py-4 text-center text-[12px] leading-5 text-[#8b887c]">
              {progress.isActive ? t.panel.progressPlanning : t.panel.progressEmptyHint}
            </p>
          )
        ) : null}
      </section>

      <section className="flex min-h-0 flex-1 flex-col" aria-label={t.panel.artifacts}>
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-2 pt-4">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#656358]">
              {t.panel.artifacts}
            </h2>
            {artifacts.length ? (
              <span className="text-[11px] text-[#9a968c]">{artifacts.length}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-0.5">
            {artifacts.length > 0 && artifactNativePath(artifacts[0].ref) ? (
              <button
                type="button"
                onClick={() => {
                  const path = artifactNativePath(artifacts[0].ref);
                  if (path) void shellBridge.revealItemInDir(path);
                }}
                className="rounded-md p-1.5 text-[#8b887c] transition-colors hover:bg-[#ebe8e1] hover:text-[#29261b]"
                aria-label={t.panel.revealInFolder}
                title={t.panel.revealInFolder}
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void refreshArtifacts(true)}
              disabled={loading || refreshing}
              className="rounded-md p-1.5 text-[#8b887c] transition-colors hover:bg-[#ebe8e1] hover:text-[#29261b] disabled:opacity-50"
              aria-label={t.panel.artifactsRefresh}
              title={t.panel.artifactsRefresh}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', (loading || refreshing) && 'animate-spin')} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
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
                onClick={() => void refreshArtifacts(false)}
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
                return (
                  <li key={artifact.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (artifact.status === 'ready') openArtifact(artifact.ref);
                      }}
                      disabled={artifact.status !== 'ready'}
                      className="group grid w-full min-w-0 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 rounded-[9px] border border-transparent px-2 py-2 text-left transition-colors hover:border-[#e3dfd7] hover:bg-white"
                      title={artifact.errorMessage || artifact.path}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center text-[#77746b]">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium text-[#29261b]">
                          {artifact.name}
                        </span>
                        {(size || modifiedAt) ? (
                          <span className="mt-0.5 block truncate text-[10.5px] text-[#9a968c]">
                            {[size, modifiedAt].filter(Boolean).join(' · ')}
                          </span>
                        ) : null}
                        {artifact.status === 'failed' && artifact.errorMessage ? (
                          <span className="mt-0.5 block truncate text-[10.5px] text-red-500">
                            {artifact.errorMessage}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-[11px] text-[#aaa69c] transition-colors group-hover:text-[#656358]">
                        {artifact.status === 'staging' ? (
                          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                        ) : null}
                        {artifactStatusLabel(artifact)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mx-1 flex min-h-28 flex-col items-center justify-center rounded-xl border border-dashed border-[#ddd9d0] bg-white/50 px-4 py-5 text-center">
              <FileText className="mb-2 h-5 w-5 text-[#aaa69c]" />
              <p className="text-[12px] leading-5 text-[#8b887c]">{t.panel.artifactsEmptyHint}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
