import { useI18n } from '@/i18n';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScheduledTaskRun } from '@/types/schedule';
import { useScheduleStore } from '@/stores/scheduleStore';
import { formatScheduleRunDate } from './useOpenScheduleRun';

function formatTimeAgo(timestamp: number, agoTemplate: string): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  let time: string;
  if (minutes < 1) time = '<1m';
  else if (minutes < 60) time = `${minutes}m`;
  else if (hours < 24) time = `${hours}h`;
  else time = `${days}d`;

  return agoTemplate.replace('{time}', time);
}

interface Props {
  runs: ScheduledTaskRun[];
  taskName: string;
}

export default function ScheduleRunHistory({ runs, taskName }: Props) {
  const { t } = useI18n();
  const openRunDetail = useScheduleStore((state) => state.openRunDetail);

  if (runs.length === 0) {
    return (
      <div className="px-4 py-3 text-[12px] text-[#656358]">
        {t.schedule.noRuns}
      </div>
    );
  }

  return (
    <div className="space-y-1 px-2 pb-2">
      {runs.map((run) => {
        const title = `${formatScheduleRunDate(run.startedAt)} - ${taskName}`;
        const isUnread = (run.status === 'completed' || run.status === 'error') && !run.viewedAt;

        return (
          <button
            type="button"
            key={run.id}
            onClick={() => openRunDetail(run.scheduledTaskId, run.runId?.trim() || run.id)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-[#f5f3ee] dark:hover:bg-[#292929]"
          >
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0',
                run.status === 'running' && 'bg-amber-400 animate-pulse',
                isUnread && 'bg-[#d97757]',
                !isUnread && run.status === 'error' && 'bg-red-500'
              )}
            />

            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium text-[#29261b]">
                {title}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                <span className="text-[#656358]">
                  {formatTimeAgo(run.startedAt, t.schedule.ago)}
                </span>
                <span
                  className={cn(
                    run.status === 'running' && 'text-amber-600',
                    run.status === 'completed' && 'text-green-600',
                    run.status === 'error' && 'text-red-500'
                  )}
                >
                  {run.status === 'running' && t.schedule.runStatusRunning}
                  {run.status === 'completed' && t.schedule.runStatusCompleted}
                  {run.status === 'error' && (run.error ? run.error.slice(0, 30) : t.schedule.runStatusError)}
                </span>
              </div>
            </div>

            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#aaa69e]" />
          </button>
        );
      })}
    </div>
  );
}
