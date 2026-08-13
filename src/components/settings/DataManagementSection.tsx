import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  Database,
  FolderArchive,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";

import ConfirmDialog from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  fetchArchivedData,
  purgeProject,
  purgeSession,
  restoreProject,
  restoreSession,
} from "@/core/api";
import {
  syncProjectsFromGateway,
  syncSessionsFromGateway,
} from "@/core/nanobotClient";
import type {
  ArchivedDataPayload,
  ArchivedProjectPayload,
  ArchivedSessionPayload,
} from "@/core/types";
import { useToastStore } from "@/stores/toastStore";

type PendingDelete =
  | { kind: "session"; item: ArchivedSessionPayload }
  | { kind: "project"; item: ArchivedProjectPayload };

function formatArchivedAt(value: number, isEnglish: boolean): string {
  if (!Number.isFinite(value) || value <= 0) return isEnglish ? "Archived" : "已归档";
  return new Intl.DateTimeFormat(isEnglish ? "en" : "zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function EmptyState({ isEnglish }: { isEnglish: boolean }) {
  return (
    <div
      data-data-management-empty
      className="rounded-xl border border-dashed border-[#dedede] bg-[#fafafa] px-6 py-12 text-center dark:border-[#3e3d39] dark:bg-[#222220]"
    >
      <Archive className="mx-auto h-7 w-7 text-[#aaa59b]" strokeWidth={1.6} />
      <div className="mt-3 text-sm font-medium text-[#4f4c45] dark:text-[#d6d1c8]">
        {isEnglish ? "Nothing is archived" : "暂无归档内容"}
      </div>
      <p className="mt-1 text-xs text-[#8b8578] dark:text-[#8f8a81]">
        {isEnglish
          ? "Archived conversations and workspaces will appear here."
          : "归档后的会话和工作空间会显示在这里。"}
      </p>
    </div>
  );
}

export default function DataManagementSection({
  token,
  apiBase,
  isEnglish,
}: {
  token: string;
  apiBase: string;
  isEnglish: boolean;
}) {
  const addToast = useToastStore((state) => state.addToast);
  const [data, setData] = useState<ArchivedDataPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const refresh = useCallback(async () => {
    if (!token || !apiBase) return;
    setLoading(true);
    setError("");
    try {
      setData(await fetchArchivedData(token, apiBase));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setLoading(false);
    }
  }, [apiBase, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (id: string, operation: () => Promise<void>, success: string) => {
    setBusy(id);
    try {
      await operation();
      await Promise.all([syncSessionsFromGateway(), syncProjectsFromGateway()]);
      await refresh();
      addToast({ type: "success", title: success });
    } catch (operationError) {
      addToast({
        type: "error",
        title: isEnglish ? "Operation failed" : "操作失败",
        message: operationError instanceof Error ? operationError.message : String(operationError),
        duration: 6000,
      });
    } finally {
      setBusy("");
    }
  };

  const restoreArchivedSession = (item: ArchivedSessionPayload) => void run(
    `restore-session:${item.sessionKey}`,
    async () => {
      await restoreSession(token, item.sessionKey, apiBase);
    },
    isEnglish ? "Conversation restored" : "会话已取消归档",
  );

  const restoreArchivedProject = (item: ArchivedProjectPayload) => void run(
    `restore-project:${item.id}`,
    async () => {
      await restoreProject(token, item.id, apiBase);
    },
    isEnglish ? "Workspace restored" : "工作空间已取消归档",
  );

  const confirmPermanentDelete = () => {
    const pending = pendingDelete;
    if (!pending) return;
    setPendingDelete(null);
    if (pending.kind === "session") {
      void run(
        `purge-session:${pending.item.sessionKey}`,
        async () => {
          await purgeSession(token, pending.item.sessionKey, apiBase);
        },
        isEnglish ? "Conversation permanently deleted" : "会话任务已永久删除",
      );
      return;
    }
    void run(
      `purge-project:${pending.item.id}`,
      async () => {
        await purgeProject(token, pending.item.id, apiBase);
      },
      isEnglish ? "Workspace record permanently deleted" : "工作空间记录已永久删除",
    );
  };

  const archivedSessions = data?.archivedSessions ?? [];
  const archivedProjects = data?.archivedProjects ?? [];
  const empty = !loading && !archivedSessions.length && !archivedProjects.length;

  return (
    <div data-data-management className="mx-auto w-full max-w-4xl space-y-5 py-1">
      <section
        data-data-management-notice
        className="flex gap-3 rounded-xl border border-[#e3ded4] bg-[#f8f6f1] px-4 py-3.5 dark:border-[#45413b] dark:bg-[#24221f]"
      >
        <Database className="mt-0.5 h-5 w-5 shrink-0 text-[#9a654f] dark:text-[#dc9678]" strokeWidth={1.7} />
        <div>
          <div className="text-sm font-semibold text-[#302d27] dark:text-[#eee9df]">
            {isEnglish ? "Archive first, delete only when certain" : "先归档，确认无误后再永久删除"}
          </div>
          <p className="mt-1 text-xs leading-5 text-[#746f65] dark:text-[#aaa49a]">
            {isEnglish
              ? "Archiving only hides an item. Permanent deletion removes its conversation journals, progress, and internal records. Workspace files and generated files on disk are never deleted here."
              : "归档只会隐藏项目；永久删除会清理对应的会话记录、进度、产物索引和内部诊断数据。这里不会删除工作空间目录及磁盘上的用户文件或已生成文件。"}
          </p>
        </div>
      </section>

      <div className="flex items-center justify-between">
        <div className="text-xs text-[#817b70] dark:text-[#969087]">
          {isEnglish
            ? `${archivedSessions.length} conversations · ${archivedProjects.length} workspaces`
            : `${archivedSessions.length} 个归档会话 · ${archivedProjects.length} 个归档工作空间`}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={loading || Boolean(busy)}
          className="border-[#dedbd4] bg-white text-[#4f4b43] hover:bg-[#f5f3ee] dark:border-[#46443f] dark:bg-[#282725] dark:text-[#d8d3ca] dark:hover:bg-[#33312e]"
        >
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {isEnglish ? "Refresh" : "刷新"}
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="flex items-center justify-center py-16 text-sm text-[#888278] dark:text-[#99948c]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {isEnglish ? "Loading archived data…" : "正在读取归档数据…"}
        </div>
      ) : null}

      {empty ? <EmptyState isEnglish={isEnglish} /> : null}

      {archivedSessions.length ? (
        <section className="space-y-2">
          <div className="flex items-center gap-2 px-1 text-sm font-semibold text-[#38352f] dark:text-[#e3ded5]">
            <Archive className="h-4 w-4" />
            {isEnglish ? "Archived conversations" : "已归档会话"}
          </div>
          <div className="overflow-hidden rounded-xl border border-[#e5e2db] bg-white dark:border-[#3c3a36] dark:bg-[#242423]">
            {archivedSessions.map((item) => {
              const restoring = busy === `restore-session:${item.sessionKey}`;
              const deleting = busy === `purge-session:${item.sessionKey}`;
              return (
                <div
                  key={item.sessionKey}
                  data-archived-row
                  className="flex items-center gap-4 border-b border-[#eeeae3] px-4 py-3.5 last:border-b-0 dark:border-[#383632]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[#282620] dark:text-[#ece7de]">
                      {item.title || (isEnglish ? "Untitled conversation" : "未命名会话")}
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-[#888278] dark:text-[#969087]">
                      <span className="truncate">{item.projectName || item.projectRoot}</span>
                      <span aria-hidden="true">·</span>
                      <span className="shrink-0">{formatArchivedAt(item.archivedAt, isEnglish)}</span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={() => restoreArchivedSession(item)}
                    className="border-[#dedbd4] bg-white text-[#4f4b43] hover:bg-[#f5f3ee] dark:border-[#494640] dark:bg-[#2b2a27] dark:text-[#ddd8cf] dark:hover:bg-[#35332f]"
                  >
                    {restoring ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                    {isEnglish ? "Restore" : "取消归档"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={() => setPendingDelete({ kind: "session", item })}
                    className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/35 dark:hover:text-red-300"
                  >
                    {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    {isEnglish ? "Delete" : "永久删除"}
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {archivedProjects.length ? (
        <section className="space-y-2">
          <div className="flex items-center gap-2 px-1 text-sm font-semibold text-[#38352f] dark:text-[#e3ded5]">
            <FolderArchive className="h-4 w-4" />
            {isEnglish ? "Archived workspaces" : "已归档工作空间"}
          </div>
          <div className="overflow-hidden rounded-xl border border-[#e5e2db] bg-white dark:border-[#3c3a36] dark:bg-[#242423]">
            {archivedProjects.map((item) => {
              const restoring = busy === `restore-project:${item.id}`;
              const deleting = busy === `purge-project:${item.id}`;
              return (
                <div
                  key={item.id}
                  data-archived-row
                  className="flex items-center gap-4 border-b border-[#eeeae3] px-4 py-3.5 last:border-b-0 dark:border-[#383632]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[#282620] dark:text-[#ece7de]">{item.name}</div>
                    <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-[#888278] dark:text-[#969087]">
                      <span className="truncate">{item.rootPath}</span>
                      <span aria-hidden="true">·</span>
                      <span className="shrink-0">
                        {isEnglish ? `${item.sessionCount} conversations` : `${item.sessionCount} 个会话`}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={() => restoreArchivedProject(item)}
                    className="border-[#dedbd4] bg-white text-[#4f4b43] hover:bg-[#f5f3ee] dark:border-[#494640] dark:bg-[#2b2a27] dark:text-[#ddd8cf] dark:hover:bg-[#35332f]"
                  >
                    {restoring ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                    {isEnglish ? "Restore" : "取消归档"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={() => setPendingDelete({ kind: "project", item })}
                    className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/35 dark:hover:text-red-300"
                  >
                    {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    {isEnglish ? "Delete record" : "永久删除记录"}
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete?.kind === "project"
          ? (isEnglish ? "Permanently delete workspace record?" : "永久删除工作空间记录？")
          : (isEnglish ? "Permanently delete this conversation?" : "永久删除这个会话任务？")}
        message={pendingDelete?.kind === "project"
          ? (isEnglish
            ? "All archived conversation history registered under this workspace will be removed. The folder and files on disk will remain. This cannot be undone."
            : "该工作空间下登记的全部归档会话历史会被清理，但磁盘上的工作空间目录和文件会保留。此操作无法撤销。")
          : (isEnglish
            ? "The conversation journal, task progress, artifact index, and internal diagnostics will be removed. Generated files on disk will remain. This cannot be undone."
            : "会话记录、任务进度、产物索引和内部诊断数据会被清理；磁盘上已经生成的文件会保留。此操作无法撤销。")}
        confirmText={isEnglish ? "Delete permanently" : "永久删除"}
        cancelText={isEnglish ? "Cancel" : "取消"}
        variant="danger"
        onConfirm={confirmPermanentDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
