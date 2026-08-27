import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Filter,
  History,
  LoaderCircle,
  Search,
  SearchX,
  Trash2,
  X,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chatStore';
import { useScheduleStore } from '@/stores/scheduleStore';
import { Select } from '@/components/ui/select';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import type { ScheduledTask, ScheduledTaskRun } from '@/types/schedule';
import { isScheduleRunConversationTitle } from './useOpenScheduleRun';

type RunFilter = 'all' | 'running' | 'completed' | 'error' | 'unread';

interface RunEntry {
  task: ScheduledTask;
  run: ScheduledTaskRun;
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function groupKey(timestamp: number, now: number): string {
  const day = startOfDay(timestamp);
  const today = startOfDay(now);
  if (day === today) return 'today';
  if (day === today - 86_400_000) return 'yesterday';
  const date = new Date(day);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${dayOfMonth}`;
}

function formatGroupLabel(key: string, locale: string, today: string, yesterday: string): string {
  if (key === 'today') return today;
  if (key === 'yesterday') return yesterday;
  const date = new Date(`${key}T00:00:00`);
  return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(date);
}

function formatRunTime(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

function statusLabel(run: ScheduledTaskRun, labels: {
  running: string;
  completed: string;
  error: string;
}): string {
  if (run.status === 'running') return labels.running;
  if (run.status === 'completed') return labels.completed;
  return run.error?.trim() || labels.error;
}

export default function ScheduleRunCenter() {
  const { t, locale } = useI18n();
  const tasks = useScheduleStore((state) => state.tasks);
  const deleteRun = useScheduleStore((state) => state.deleteRun);
  const markRunViewed = useScheduleStore((state) => state.markRunViewed);
  const conversations = useChatStore((state) => state.conversations);
  const openRunDetail = useScheduleStore((state) => state.openRunDetail);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RunFilter>('all');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [confirmingRunId, setConfirmingRunId] = useState<string | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RunEntry | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const allRuns = useMemo<RunEntry[]>(() => (
    Object.values(tasks)
      .flatMap((task) => task.runs.map((run) => ({ task, run })))
      .sort((a, b) => b.run.startedAt - a.run.startedAt)
  ), [tasks]);

  const filteredRuns = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return allRuns.filter(({ task, run }) => {
      const unread = (run.status === 'completed' || run.status === 'error') && !run.viewedAt;
      if (filter === 'unread' && !unread) return false;
      if (filter !== 'all' && filter !== 'unread' && run.status !== filter) return false;
      if (!normalizedQuery) return true;

      const sessionKey = run.sessionKey ?? run.conversationId;
      const conversationTitle = sessionKey ? conversations[sessionKey]?.title : '';
      const searchableTitle = isScheduleRunConversationTitle(conversationTitle)
        ? conversationTitle
        : '';
      return [task.name, task.description, run.error, searchableTitle]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [allRuns, conversations, filter, query]);

  const groups = useMemo(() => {
    const now = Date.now();
    const ordered = new Map<string, RunEntry[]>();
    for (const entry of filteredRuns) {
      const key = groupKey(entry.run.startedAt, now);
      const entries = ordered.get(key) ?? [];
      entries.push(entry);
      ordered.set(key, entries);
    }
    return [...ordered.entries()];
  }, [filteredRuns]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleOpenRun = async (entry: RunEntry) => {
    const { task, run } = entry;
    if (run.resultType !== 'none' || run.status === 'running') {
      openRunDetail(task.id, run.runId?.trim() || run.id);
      return;
    }
    if (run.viewedAt) return;

    const key = `${task.id}:${run.id}`;
    setConfirmingRunId(key);
    setOpenError(null);
    try {
      await markRunViewed(task.id, run);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOpenError(`${t.schedule.reminderConfirmFailed}: ${message}`);
    } finally {
      setConfirmingRunId(null);
    }
  };

  const handleDeleteRun = async () => {
    if (!pendingDelete) return;
    const entry = pendingDelete;
    const key = `${entry.task.id}:${entry.run.id}`;
    setPendingDelete(null);
    setDeletingRunId(key);
    setOpenError(null);
    try {
      await deleteRun(entry.task.id, entry.run);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setOpenError(`${t.schedule.deleteRunFailed}: ${message}`);
    } finally {
      setDeletingRunId(null);
    }
  };

  const filterOptions = [
    { value: 'all', label: t.schedule.filterAll },
    { value: 'running', label: t.schedule.runStatusRunning },
    { value: 'completed', label: t.schedule.runStatusCompleted },
    { value: 'error', label: t.schedule.runStatusError },
    { value: 'unread', label: t.schedule.filterUnread },
  ];

  return (
    <div data-schedule-run-center className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ebe7df]/75 px-6 py-4 dark:border-white/10">
        <div className="text-[12px] text-[#8a867c] dark:text-[#9b978f]">
          {t.schedule.runCount.replace('{count}', String(filteredRuns.length))}
        </div>
        <div className="flex flex-1 items-center justify-end gap-2">
          <div className="flex items-center gap-1.5 text-[#777267] dark:text-[#aaa69d]">
            <Filter className="h-4 w-4" strokeWidth={1.75} />
            <Select
              value={filter}
              onChange={(value) => setFilter(value as RunFilter)}
              options={filterOptions}
              variant="inline"
              className="min-w-[118px]"
            />
          </div>
          <label className="flex h-9 min-w-[220px] max-w-[360px] flex-1 items-center gap-2 rounded-xl border border-transparent bg-[#f1efeb] px-3 text-[#777267] transition-colors focus-within:border-[#d9d3c9] focus-within:bg-white dark:bg-[#262626] dark:text-[#aaa69d] dark:focus-within:border-white/20 dark:focus-within:bg-[#202020]">
            <Search className="h-4 w-4 shrink-0" strokeWidth={1.8} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.schedule.searchRuns}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-[#29261b] outline-none placeholder:text-[#aaa69f] dark:text-[#eeeae2] dark:placeholder:text-[#77736c]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label={t.schedule.clearSearch}
                className="rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
        </div>
      </div>

      {openError && (
        <div role="alert" className="mx-6 mt-3 flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" />
          {openError}
        </div>
      )}

      {allRuns.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#f0ede7] text-[#aaa69d] dark:bg-[#292929] dark:text-[#77736c]">
            <History className="h-7 w-7" strokeWidth={1.6} />
          </span>
          <p className="text-[15px] font-medium text-[#29261b] dark:text-[#eeeae2]">{t.schedule.noRuns}</p>
          <p className="mt-1 text-[12px] text-[#777267] dark:text-[#9d9990]">{t.schedule.noRunsHint}</p>
        </div>
      ) : filteredRuns.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <SearchX className="mb-3 h-8 w-8 text-[#b0aca3] dark:text-[#77736c]" strokeWidth={1.5} />
          <p className="text-[14px] font-medium text-[#3d392f] dark:text-[#dedad2]">{t.schedule.noMatchingRuns}</p>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setFilter('all');
            }}
            className="mt-3 text-[12px] font-medium text-[#d97757] hover:text-[#bd6247]"
          >
            {t.schedule.clearFilters}
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 pb-8 pt-3">
          {groups.map(([key, entries]) => {
            const collapsed = collapsedGroups.has(key);
            return (
              <section key={key} className="mb-5" data-schedule-run-group={key}>
                <button
                  type="button"
                  onClick={() => toggleGroup(key)}
                  className="mb-1.5 flex items-center gap-1.5 py-1 text-[12px] font-medium text-[#8a867c] hover:text-[#4b483f] dark:text-[#9d9990] dark:hover:text-[#ddd8cf]"
                  aria-expanded={!collapsed}
                >
                  {formatGroupLabel(key, locale, t.schedule.today, t.schedule.yesterday)}
                  <span className="text-[10px] text-[#b0aca3]">{entries.length}</span>
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', collapsed && '-rotate-90')} />
                </button>

                {!collapsed && (
                  <div className="overflow-hidden rounded-xl border border-[#ebe7df]/80 bg-white dark:border-white/10 dark:bg-[#232323]">
                    {entries.map((entry, index) => {
                      const { task, run } = entry;
                      const rowKey = `${task.id}:${run.id}`;
                      const sessionKey = run.sessionKey ?? run.conversationId;
                      const conversationTitle = sessionKey ? conversations[sessionKey]?.title : undefined;
                      const detail = isScheduleRunConversationTitle(conversationTitle)
                        ? conversationTitle
                        : statusLabel(run, {
                          running: t.schedule.runStatusRunning,
                          completed: t.schedule.runCompletedSummary,
                          error: t.schedule.runStatusError,
                        });
                      const unread = (run.status === 'completed' || run.status === 'error') && !run.viewedAt;
                      const confirmationOnly = run.resultType === 'none' && run.status !== 'running';
                      const confirmed = confirmationOnly && Boolean(run.viewedAt);
                      const confirming = confirmingRunId === rowKey;

                      return (
                        <div
                          key={rowKey}
                          data-schedule-run-row={rowKey}
                          className={cn(
                            'group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors',
                            index > 0 && 'border-t border-[#f0ede7] dark:border-white/[0.07]',
                            'hover:bg-[#faf8f4] dark:hover:bg-[#292929]',
                          )}
                        >
                          <button
                            type="button"
                            data-schedule-run-open={confirmationOnly ? undefined : rowKey}
                            data-schedule-run-confirm={confirmationOnly ? rowKey : undefined}
                            onClick={() => void handleOpenRun(entry)}
                            disabled={deletingRunId === rowKey || confirming || confirmed}
                            className={cn(
                              'flex min-w-0 flex-1 items-center gap-3 text-left',
                              confirmed && 'cursor-default',
                            )}
                          >
                            <span className={cn(
                              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                              run.status === 'running' && 'bg-amber-50 text-amber-600 dark:bg-amber-400/10 dark:text-amber-300',
                              run.status === 'completed' && 'bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300',
                              run.status === 'error' && 'bg-red-50 text-red-500 dark:bg-red-400/10 dark:text-red-300',
                            )}>
                              {run.status === 'running' && <LoaderCircle className="h-4 w-4 animate-spin" />}
                              {run.status === 'completed' && <Check className="h-4 w-4" strokeWidth={2} />}
                              {run.status === 'error' && <CircleAlert className="h-4 w-4" />}
                            </span>

                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <span className="truncate text-[14px] font-medium text-[#29261b] dark:text-[#eeeae2]">{task.name}</span>
                                {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#d97757]" aria-label={t.schedule.filterUnread} />}
                              </span>
                              <span className={cn(
                                'mt-0.5 block truncate text-[12px]',
                                run.status === 'error' ? 'text-red-500 dark:text-red-300' : 'text-[#9a968d] dark:text-[#8f8b83]',
                              )}>
                                {detail}
                              </span>
                            </span>

                            <span className="shrink-0 text-[12px] text-[#aaa69e] dark:text-[#77736c]">
                              {formatRunTime(run.startedAt, locale)}
                            </span>
                            {confirmationOnly ? (
                              <span
                                data-schedule-run-confirm-state={confirmed ? 'confirmed' : 'pending'}
                                className={cn(
                                  'inline-flex min-w-12 shrink-0 items-center justify-end gap-1.5 text-[12px] font-medium',
                                  confirmed
                                    ? 'text-emerald-600 dark:text-emerald-300'
                                    : 'text-[#d97757] dark:text-[#e89576]',
                                )}
                              >
                                {confirming && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                                {!confirming && confirmed && <Check className="h-3.5 w-3.5" />}
                                {confirmed ? t.schedule.reminderConfirmed : t.common.confirm}
                              </span>
                            ) : (
                              <ChevronRight className="h-4 w-4 shrink-0 text-[#b0aca3]" strokeWidth={1.7} />
                            )}
                          </button>
                          {run.status !== 'running' && (
                            <button
                              type="button"
                              data-schedule-run-delete={rowKey}
                              onClick={() => setPendingDelete(entry)}
                              disabled={deletingRunId === rowKey}
                              aria-label={`${t.schedule.deleteRun}: ${task.name}`}
                              title={t.schedule.deleteRun}
                              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#aaa69e] opacity-55 transition-all hover:bg-red-50 hover:text-red-500 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/40 dark:text-[#77736c] dark:hover:bg-red-400/10 dark:hover:text-red-300"
                            >
                              {deletingRunId === rowKey
                                ? <LoaderCircle className="h-4 w-4 animate-spin" />
                                : <Trash2 className="h-4 w-4" strokeWidth={1.8} />}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t.schedule.deleteRun}
        message={t.schedule.deleteRunConfirm}
        confirmText={t.common.confirm}
        cancelText={t.common.cancel}
        onConfirm={() => void handleDeleteRun()}
        onCancel={() => setPendingDelete(null)}
        variant="danger"
      />
    </div>
  );
}
