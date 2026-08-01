import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Brain,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import {
  clearProjectMemories,
  consolidateProjectMemories,
  forgetProjectMemory,
  listProjectMemories,
  reindexProjectMemories,
} from "@/core/api";
import {
  getNanobotStatus,
  getNanobotToken,
  refreshNanobotAuth,
} from "@/core/nanobotClient";
import type {
  ProjectMemoriesPayload,
  ProjectMemoryJobPayload,
  ProjectMemoryPayload,
} from "@/core/types";
import { useI18n } from "@/i18n";
import { useChatStore } from "@/stores/chatStore";

interface ProjectMemoryDialogProps {
  project: { id: string; name: string };
  onClose: () => void;
}

async function gatewayAuth(): Promise<{ token: string; baseUrl: string }> {
  const status = await getNanobotStatus();
  if (!status.ready) throw new Error("nanobot 服务尚未就绪");
  const baseUrl = `http://127.0.0.1:${status.port}`;
  const token = getNanobotToken();
  if (token) return { token, baseUrl };
  return refreshNanobotAuth();
}

function formatTime(value?: number | null): string {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function interpolate(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, String(value)),
    template,
  );
}

export default function ProjectMemoryDialog({
  project,
  onClose,
}: ProjectMemoryDialogProps) {
  const { t } = useI18n();
  const switchConversation = useChatStore((state) => state.switchConversation);
  const [payload, setPayload] = useState<ProjectMemoriesPayload | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kindLabels = useMemo<Record<string, string>>(() => ({
    project_preference: t.projectMemory.kindProjectPreference,
    workflow: t.projectMemory.kindWorkflow,
    repo_fact: t.projectMemory.kindRepoFact,
    failure_shield: t.projectMemory.kindFailureShield,
    decision_rule: t.projectMemory.kindDecisionRule,
    reference: t.projectMemory.kindReference,
    long_term: t.projectMemory.kindLongTerm,
  }), [t]);
  const jobStatus = useCallback((job?: ProjectMemoryJobPayload | null) => {
    if (!job) return t.projectMemory.statusWaiting;
    if (job.status === "running") return t.projectMemory.statusRunning;
    if (job.status === "failed") return t.projectMemory.statusFailed;
    if (job.status === "succeeded_no_output") return t.projectMemory.statusNoOutput;
    return interpolate(t.projectMemory.statusDone, {
      time: formatTime(job.completedAt ?? job.updatedAt),
    });
  }, [t]);
  const jobError = payload?.status.phase2?.error?.message
    ?? payload?.status.phase1?.error?.message
    ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const auth = await gatewayAuth();
      setPayload(await listProjectMemories(auth.token, project.id, auth.baseUrl));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.projectMemory.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [project.id, t.projectMemory.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleMemories = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return payload?.memories ?? [];
    return (payload?.memories ?? []).filter((memory) => (
      memory.title.toLowerCase().includes(normalized)
      || memory.content.toLowerCase().includes(normalized)
      || (kindLabels[memory.kind] ?? memory.kind).toLowerCase().includes(normalized)
    ));
  }, [kindLabels, payload?.memories, query]);

  const consolidate = async () => {
    setAction("consolidate");
    setError(null);
    try {
      const auth = await gatewayAuth();
      await consolidateProjectMemories(auth.token, project.id, auth.baseUrl);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.projectMemory.consolidateFailed);
    } finally {
      setAction(null);
    }
  };

  const reindex = async () => {
    setAction("reindex");
    setError(null);
    try {
      const auth = await gatewayAuth();
      await reindexProjectMemories(auth.token, project.id, auth.baseUrl);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.projectMemory.reindexFailed);
    } finally {
      setAction(null);
    }
  };

  const forget = async (memory: ProjectMemoryPayload) => {
    if (!window.confirm(interpolate(t.projectMemory.forgetConfirm, {
      name: memory.title || memory.content.slice(0, 24),
    }))) {
      return;
    }
    setAction(memory.id);
    setError(null);
    try {
      const auth = await gatewayAuth();
      await forgetProjectMemory(auth.token, project.id, memory.id, auth.baseUrl);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.projectMemory.forgetFailed);
    } finally {
      setAction(null);
    }
  };

  const clearAll = async () => {
    if (!window.confirm(interpolate(t.projectMemory.clearConfirm, { name: project.name }))) {
      return;
    }
    setAction("clear");
    setError(null);
    try {
      const auth = await gatewayAuth();
      await clearProjectMemories(auth.token, project.id, auth.baseUrl);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.projectMemory.clearFailed);
    } finally {
      setAction(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/20 px-4 backdrop-blur-[1px] animate-in fade-in duration-150">
      <div className="flex max-h-[82vh] w-full max-w-[760px] flex-col overflow-hidden rounded-[20px] border border-[#e6e1d8] bg-[#fbfaf7] shadow-[0_22px_70px_rgba(0,0,0,0.22)]">
        <div className="flex items-start justify-between border-b border-[#e8e4dc] px-7 py-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-[#d97757]" />
              <h2 className="truncate text-[21px] font-semibold text-[#29261b]">{t.projectMemory.title}</h2>
            </div>
            <p className="mt-1.5 truncate text-[13px] text-[#8a867c]">{project.name}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded-full bg-[#ece8df] px-2 py-1 text-[#656358]">
                {t.projectMemory.phase1} · {jobStatus(payload?.status.phase1)}
              </span>
              <span className="rounded-full bg-[#ece8df] px-2 py-1 text-[#656358]">
                {t.projectMemory.phase2} · {jobStatus(payload?.status.phase2)}
              </span>
              <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">
                {t.projectMemory.retrievalMode}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#656358] hover:bg-[#efede7]"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-[#ebe7df] px-7 py-3">
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl border border-[#e5e1d8] bg-white px-3">
            <Search className="h-4 w-4 shrink-0 text-[#9a968d]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.projectMemory.searchPlaceholder}
              className="w-full bg-transparent text-[13px] text-[#29261b] outline-none placeholder:text-[#aaa69d]"
            />
          </div>
          <button
            onClick={() => void load()}
            disabled={loading || action !== null}
            className="flex h-9 items-center gap-1.5 rounded-xl border border-[#e5e1d8] bg-white px-3 text-[12px] font-medium text-[#656358] hover:bg-[#f5f2ec] disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            {t.projectMemory.refresh}
          </button>
          <button
            onClick={() => void reindex()}
            disabled={loading || action !== null}
            className="flex h-9 items-center gap-1.5 rounded-xl border border-[#e5e1d8] bg-white px-3 text-[12px] font-medium text-[#656358] hover:bg-[#f5f2ec] disabled:opacity-50"
          >
            {action === "reindex" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {t.projectMemory.reindex}
          </button>
          <button
            onClick={() => void consolidate()}
            disabled={loading || action !== null}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-[#29261b] px-3.5 text-[12px] font-medium text-white hover:bg-[#17150f] disabled:opacity-50"
          >
            {action === "consolidate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
            {t.projectMemory.consolidate}
          </button>
        </div>

        {(error || jobError) && (
          <div className="mx-7 mt-4 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-[12px] text-red-600">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error || jobError}</span>
          </div>
        )}

        <div className="min-h-[260px] flex-1 overflow-y-auto px-7 py-4">
          {loading && !payload ? (
            <div className="flex h-48 items-center justify-center gap-2 text-[13px] text-[#8a867c]">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t.projectMemory.loading}
            </div>
          ) : visibleMemories.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center text-center">
              <Brain className="h-8 w-8 text-[#cbc6bb]" />
              <p className="mt-3 text-[14px] font-medium text-[#656358]">
                {query ? t.projectMemory.noMatch : t.projectMemory.empty}
              </p>
              <p className="mt-1 text-[12px] text-[#9a968d]">
                {t.projectMemory.emptyHint}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleMemories.map((memory) => (
                <article
                  key={memory.id}
                  className="rounded-2xl border border-[#e8e4dc] bg-white px-4 py-3.5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-[#f0ece4] px-2 py-0.5 text-[10px] font-medium text-[#6d685f]">
                          {kindLabels[memory.kind] ?? memory.kind}
                        </span>
                        <h3 className="truncate text-[14px] font-semibold text-[#29261b]">
                          {memory.title || t.projectMemory.unnamed}
                        </h3>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-[#4e4a43]">
                        {memory.content}
                      </p>
                    </div>
                    <button
                      onClick={() => void forget(memory)}
                      disabled={action !== null}
                      className="flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] text-[#9a6863] hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    >
                      {action === memory.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      {t.projectMemory.forget}
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#f0ede7] pt-2 text-[10.5px] text-[#969188]">
                    <span>{interpolate(t.projectMemory.usageCount, { count: memory.usageCount })}</span>
                    <span>{interpolate(t.projectMemory.lastUsed, {
                      time: formatTime(memory.lastUsedAt) || t.projectMemory.neverUsed,
                    })}</span>
                    <span>{interpolate(t.projectMemory.sourceCount, { count: memory.sources.length })}</span>
                    {memory.confidence != null && (
                      <span>{interpolate(t.projectMemory.confidence, {
                        value: `${Math.round(memory.confidence * 100)}%`,
                      })}</span>
                    )}
                    <span>{interpolate(t.projectMemory.updatedAt, {
                      time: formatTime(memory.updatedAt),
                    })}</span>
                    {memory.sources.map((source) => (
                      source.sourceSessionKey ? (
                        <button
                          key={source.id}
                          onClick={() => {
                            switchConversation(source.sourceSessionKey!);
                            onClose();
                          }}
                          className="inline-flex items-center gap-1 text-[#b65f43] hover:underline"
                        >
                          {interpolate(t.projectMemory.sessionSource, {
                            id: source.sourceSessionKey.replace(/^websocket:/, "").slice(0, 8),
                          })}
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      ) : null
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[#e8e4dc] bg-white/70 px-7 py-4">
          <p className="text-[11px] text-[#9a968d]">
            {t.projectMemory.clearHint}
          </p>
          <button
            onClick={() => void clearAll()}
            disabled={action !== null || !payload?.memories.length}
            className="flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12px] font-medium text-red-500 hover:bg-red-50 disabled:opacity-40"
          >
            {action === "clear" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            {t.projectMemory.clear}
          </button>
        </div>
      </div>
    </div>
  );
}
