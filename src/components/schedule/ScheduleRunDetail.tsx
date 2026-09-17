import { useEffect, useState } from 'react';
import { CircleAlert, ExternalLink, LoaderCircle } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useScheduleStore } from '@/stores/scheduleStore';
import { formatTaskDuration } from '@/utils/taskDuration';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useOpenScheduleRun } from './useOpenScheduleRun';

function formatTimestamp(timestamp: number | undefined, locale: string): string {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

export default function ScheduleRunDetail() {
  const { t, locale } = useI18n();
  const activeRunDetail = useScheduleStore((state) => state.activeRunDetail);
  const closeRunDetail = useScheduleStore((state) => state.closeRunDetail);
  const markRunViewed = useScheduleStore((state) => state.markRunViewed);
  const task = useScheduleStore((state) => (
    activeRunDetail ? state.tasks[activeRunDetail.taskId] : undefined
  ));
  const run = task?.runs.find((candidate) => (
    (candidate.runId?.trim() || candidate.id) === activeRunDetail?.runId
  ));
  const openScheduleRun = useOpenScheduleRun();
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);

  useEffect(() => {
    setOpenFailed(false);
    if (!activeRunDetail || !run || run.status === 'running' || run.viewedAt) return;
    void markRunViewed(activeRunDetail.taskId, run).catch((error) => {
      console.warn('Failed to mark schedule run viewed', error);
    });
  }, [activeRunDetail, markRunViewed, run]);

  if (!activeRunDetail || !task || !run) return null;

  const sessionKey = run.sessionKey || run.conversationId || '';
  const isLegacyFallbackSession = sessionKey === `cron:${task.id}`;
  const hasConversation = run.resultType !== 'none'
    && !isLegacyFallbackSession
    && Boolean(sessionKey)
    && (run.conversationAvailable ?? true);
  const duration = run.completedAt
    ? formatTaskDuration(Math.max(0, run.completedAt - run.startedAt))
    : '-';
  const unavailableText = openFailed
    ? `${t.schedule.openConversationFailed} ${t.schedule.conversationMissingUnavailable}`
    : (run.unavailableReason === 'legacy' || isLegacyFallbackSession)
      ? t.schedule.conversationLegacyUnavailable
      : t.schedule.conversationUnavailable;

  const handleOpenConversation = async () => {
    setOpening(true);
    setOpenFailed(false);
    try {
      const opened = await openScheduleRun(run, task.name);
      if (!opened) setOpenFailed(true);
      else closeRunDetail();
    } catch (error) {
      console.warn('Failed to open schedule run conversation', error);
      setOpenFailed(true);
    } finally {
      setOpening(false);
    }
  };

  const statusText = run.status === 'running'
    ? t.schedule.runStatusRunning
    : run.status === 'completed'
      ? t.schedule.runStatusCompleted
      : t.schedule.runStatusError;

  return (
    <Dialog open onOpenChange={(open) => !open && closeRunDetail()}>
      <DialogContent
        data-schedule-run-detail={`${task.id}:${run.runId?.trim() || run.id}`}
        className="max-w-[560px] gap-0 overflow-hidden border-[#e7e1d8] bg-[#fbfaf7] p-0 dark:border-white/10 dark:bg-[#202020]"
      >
        <DialogHeader className="border-b border-[#ebe7df] px-6 py-5 pr-12 dark:border-white/10">
          <DialogTitle className="text-[17px] text-[#29261b] dark:text-[#eeeae2]">
            {t.schedule.runDetail}
          </DialogTitle>
          <DialogDescription className="text-[13px] text-[#777267] dark:text-[#aaa69d]">
            {task.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-[12px]">
            <div>
              <div className="text-[#99958c] dark:text-[#88847c]">{t.schedule.status}</div>
              <div className={cn(
                'mt-1 font-medium',
                run.status === 'running' && 'text-amber-600 dark:text-amber-300',
                run.status === 'completed' && 'text-emerald-600 dark:text-emerald-300',
                run.status === 'error' && 'text-red-500 dark:text-red-300',
              )}>{statusText}</div>
            </div>
            <div>
              <div className="text-[#99958c] dark:text-[#88847c]">{t.schedule.duration}</div>
              <div className="mt-1 font-medium text-[#3d392f] dark:text-[#ddd8cf]">{duration}</div>
            </div>
            <div>
              <div className="text-[#99958c] dark:text-[#88847c]">{t.schedule.startedAt}</div>
              <div className="mt-1 text-[#3d392f] dark:text-[#ddd8cf]">{formatTimestamp(run.startedAt, locale)}</div>
            </div>
            <div>
              <div className="text-[#99958c] dark:text-[#88847c]">{t.schedule.completedAt}</div>
              <div className="mt-1 text-[#3d392f] dark:text-[#ddd8cf]">{formatTimestamp(run.completedAt, locale)}</div>
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[12px] text-[#99958c] dark:text-[#88847c]">{t.schedule.prompt}</div>
            <div className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[#f1efeb] px-3 py-2.5 text-[12.5px] leading-5 text-[#49453c] dark:bg-[#292929] dark:text-[#d4d0c8]">
              {task.prompt}
            </div>
          </div>

          {run.error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-[12px] leading-5 text-red-600 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{run.error}</span>
            </div>
          )}
          {(!hasConversation || openFailed) && (
            <div className={cn(
              'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[12px] leading-5',
              openFailed
                ? 'border-red-100 bg-red-50 text-red-600 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300'
                : 'border-[#e7e1d8] bg-[#f5f2ec] text-[#777267] dark:border-white/10 dark:bg-[#292929] dark:text-[#aaa69d]',
            )}>
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{unavailableText}</span>
            </div>
          )}
        </div>

        {hasConversation && (
          <DialogFooter className="border-t border-[#ebe7df] px-6 py-4 dark:border-white/10">
            <Button
              data-cowork-button="primary"
              data-schedule-run-conversation
              type="button"
              onClick={() => void handleOpenConversation()}
              disabled={opening}
              className="h-9 rounded-lg px-4 text-[12.5px] disabled:opacity-60"
            >
              {opening
                ? <LoaderCircle className="h-4 w-4 animate-spin" />
                : <ExternalLink className="h-4 w-4" />}
              {t.schedule.viewFullConversation}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
