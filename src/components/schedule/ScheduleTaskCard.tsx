import { useState } from 'react';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useI18n } from '@/i18n';
import { ChevronRight, Clock, Pencil, Play, RotateCw, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScheduledTask, ScheduleFrequency } from '@/types/schedule';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import ScheduleRunHistory from './ScheduleRunHistory';

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

function getFrequencyLabel(
  freq: ScheduleFrequency,
  t: ReturnType<typeof useI18n>['t']
): string {
  const map: Record<ScheduleFrequency, string> = {
    hourly: t.schedule.frequencyHourly,
    daily: t.schedule.frequencyDaily,
    weekly: t.schedule.frequencyWeekly,
    weekdays: t.schedule.frequencyWeekdays,
    manual: t.schedule.frequencyManual,
  };
  return map[freq];
}

function getScheduleDescription(task: ScheduledTask, t: ReturnType<typeof useI18n>['t']): string {
  const freq = getFrequencyLabel(task.schedule.frequency, t);
  const time = task.schedule.time;
  if (!time) return freq;

  if (task.schedule.frequency === 'hourly') {
    return `${freq} :${time.minute.toString().padStart(2, '0')}`;
  }

  const timeStr = `${time.hour.toString().padStart(2, '0')}:${time.minute.toString().padStart(2, '0')}`;

  if (task.schedule.frequency === 'weekly') {
    const days = [
      t.schedule.sunday, t.schedule.monday, t.schedule.tuesday,
      t.schedule.wednesday, t.schedule.thursday, t.schedule.friday,
      t.schedule.saturday,
    ];
    const day = days[task.schedule.dayOfWeek ?? 1];
    return `${freq} ${day} ${timeStr}`;
  }

  return `${freq} ${timeStr}`;
}

interface Props {
  task: ScheduledTask;
}

export default function ScheduleTaskCard({ task }: Props) {
  const { t, format } = useI18n();
  const { activeTaskId, setActiveTaskId, pauseTask, resumeTask, runTaskNow, loadTasks, deleteTask, openEditor } = useScheduleStore();
  const [running, setRunning] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const open = activeTaskId === task.id;
  const isPaused = task.status === 'paused';
  const scheduleDesc = getScheduleDescription(task, t);
  const unreadRunCount = task.runs.filter((run) => (
    (run.status === 'completed' || run.status === 'error') && !run.viewedAt
  )).length;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPaused) {
      void resumeTask(task.id);
    } else {
      void pauseTask(task.id);
    }
  };

  const handleRunNow = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRunning(true);
    setActiveTaskId(task.id);
    try {
      const request = runTaskNow(task.id);
      for (let i = 0; i < 3; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await loadTasks();
      }
      await request;
      await loadTasks();
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <div className="bg-white rounded-xl border border-[#e8e4dd] hover:border-[#d4d0c8] hover:shadow-sm transition-all group">
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setActiveTaskId(open ? null : task.id)}
              className="shrink-0 p-1 rounded-md text-[#656358] hover:bg-[#f5f3ee] hover:text-[#29261b]"
              title={t.schedule.runHistory}
            >
              <ChevronRight className={cn('h-4 w-4 transition-transform', open && 'rotate-90')} />
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    isPaused ? 'bg-neutral-300' : 'bg-green-500'
                  )}
                />
                <span className="text-[14px] font-medium text-[#29261b] truncate">
                  {task.name}
                </span>
                <span className="text-[12px] text-[#8a867c] shrink-0">
                  {task.runs.length ? `${task.runs.length} ${t.schedule.runHistory}` : t.schedule.noRuns}
                </span>
                {unreadRunCount > 0 && (
                  <span className="shrink-0 rounded-full bg-[#d97757]/10 px-1.5 py-0.5 text-[11px] font-medium text-[#d97757]">
                    {format(t.schedule.unreadRuns, { count: unreadRunCount })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-[12px] text-[#656358]">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {scheduleDesc}
                </span>
                {task.lastRunAt && (
                  <span>
                    {t.schedule.lastRun}: {formatTimeAgo(task.lastRunAt, t.schedule.ago)}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openEditor(task.id);
                }}
                className="p-1.5 rounded-md text-[#656358] hover:bg-[#f5f3ee] hover:text-[#29261b]"
                title={t.schedule.edit}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleRunNow}
                disabled={running}
                className="p-1.5 rounded-md text-[#656358] hover:bg-[#f5f3ee] hover:text-[#d97757] disabled:opacity-60"
                title={t.schedule.runNow}
              >
                {running ? <RotateCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDeleteConfirm(true);
                }}
                className="p-1.5 rounded-md text-[#656358] hover:bg-red-50 hover:text-red-500"
                title={t.schedule.delete}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            <button
              onClick={handleToggle}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
                isPaused ? 'bg-neutral-200' : 'bg-green-500'
              )}
              title={isPaused ? t.schedule.resume : t.schedule.pause}
            >
              <span
                className={cn(
                  'inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform',
                  isPaused ? 'translate-x-[3px]' : 'translate-x-[19px]'
                )}
              />
            </button>
          </div>
        </div>

        {open && (
          <div className="max-h-[320px] overflow-y-auto border-t border-[#e8e4dd] bg-[#fbfaf7] px-2 py-2">
            <ScheduleRunHistory runs={task.runs} taskName={task.name} />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        title={t.schedule.delete}
        message={t.schedule.deleteConfirm}
        confirmText={t.common.confirm}
        cancelText={t.common.cancel}
        onConfirm={() => {
          setShowDeleteConfirm(false);
          void deleteTask(task.id);
        }}
        onCancel={() => setShowDeleteConfirm(false)}
        variant="danger"
      />
    </>
  );
}
