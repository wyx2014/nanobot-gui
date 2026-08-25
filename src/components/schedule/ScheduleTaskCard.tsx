import { useState } from 'react';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useI18n } from '@/i18n';
import { Clock, Pencil, Play, RotateCw, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScheduledTask } from '@/types/schedule';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import { getScheduleDescription } from './scheduleFormat';

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
  task: ScheduledTask;
}

export default function ScheduleTaskCard({ task }: Props) {
  const { t, locale, format } = useI18n();
  const { pauseTask, resumeTask, runTaskNow, loadTasks, deleteTask, openEditor } = useScheduleStore();
  const [running, setRunning] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isPaused = task.status === 'paused';
  const isCompleted = task.status === 'completed';
  const scheduleDesc = getScheduleDescription(task.schedule, t, locale);
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
      <div data-schedule-card className="bg-white rounded-xl border border-[#e8e4dd] hover:border-[#d4d0c8] hover:shadow-sm transition-all group">
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    isPaused || isCompleted ? 'bg-neutral-300' : 'bg-green-500'
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

            {isCompleted ? (
              <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-1 text-[11px] font-medium text-neutral-500">
                {t.schedule.statusCompleted}
              </span>
            ) : (
              <button
                onClick={handleToggle}
                data-schedule-toggle
                data-active={isPaused ? "false" : "true"}
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
                  isPaused ? 'bg-neutral-200' : 'bg-green-500'
                )}
                title={isPaused ? t.schedule.resume : t.schedule.pause}
              >
                <span
                  data-schedule-toggle-thumb
                  className={cn(
                    'inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform',
                    isPaused ? 'translate-x-[3px]' : 'translate-x-[19px]'
                  )}
                />
              </button>
            )}
          </div>
        </div>

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
