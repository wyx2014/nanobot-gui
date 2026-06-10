import { useState } from 'react';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useI18n, format } from '@/i18n';
import { schedulerEngine } from '@/core/scheduler/scheduler';
import {
  ArrowLeft,
  Pencil,
  Play,
  Pause,
  Trash2,
  RotateCw,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScheduleFrequency } from '@/types/schedule';
import ScheduleRunHistory from './ScheduleRunHistory';
import ConfirmDialog from '@/components/common/ConfirmDialog';

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

export default function ScheduleTaskDetail() {
  const { t } = useI18n();
  const {
    tasks,
    selectedTaskId,
    setSelectedTaskId,
    pauseTask,
    resumeTask,
    deleteTask,
    openEditor,
  } = useScheduleStore();

  const [isRunning, setIsRunning] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const task = selectedTaskId ? tasks[selectedTaskId] : null;

  if (!task) return null;

  const isPaused = task.status === 'paused';

  const handleRunNow = async () => {
    setIsRunning(true);
    try {
      await schedulerEngine.runNow(task.id);
    } finally {
      setIsRunning(false);
    }
  };

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    setShowDeleteConfirm(false);
    deleteTask(task.id);
  };

  const handleEdit = () => {
    openEditor(task.id);
  };

  const handleBack = () => {
    setSelectedTaskId(null);
  };

  // Build schedule description
  const freq = getFrequencyLabel(task.schedule.frequency, t);
  const time = task.schedule.time;
  let scheduleDesc = freq;
  if (time) {
    if (task.schedule.frequency === 'hourly') {
      scheduleDesc = `${freq} :${time.minute.toString().padStart(2, '0')}`;
    } else {
      const timeStr = `${time.hour.toString().padStart(2, '0')}:${time.minute.toString().padStart(2, '0')}`;
      if (task.schedule.frequency === 'weekly') {
        const days = [
          t.schedule.sunday, t.schedule.monday, t.schedule.tuesday,
          t.schedule.wednesday, t.schedule.thursday, t.schedule.friday,
          t.schedule.saturday,
        ];
        const day = days[task.schedule.dayOfWeek ?? 1];
        scheduleDesc = `${freq} ${day} ${timeStr}`;
      } else {
        scheduleDesc = `${freq} ${timeStr}`;
      }
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[#e8e4dd] bg-white">
        <button
          onClick={handleBack}
          className="p-1.5 rounded-md text-[#656358] hover:bg-[#f5f3ee] hover:text-[#29261b] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-[18px] font-semibold text-[#29261b] flex-1 truncate">
          {task.name}
        </h1>
        <button
          onClick={handleEdit}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] text-[#3d3929] hover:bg-[#f5f3ee] transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
          {t.schedule.edit}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="px-6 py-5 space-y-5">
          {/* Info section */}
          <div className="bg-white rounded-xl border border-[#e8e4dd] p-4 space-y-3">
            {/* Status */}
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-[#656358]">{t.schedule.status}</span>
              <span className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'w-2 h-2 rounded-full',
                    isPaused ? 'bg-neutral-300' : 'bg-green-500'
                  )}
                />
                <span className={cn(
                  'text-[13px] font-medium',
                  isPaused ? 'text-neutral-500' : 'text-green-600'
                )}>
                  {isPaused ? t.schedule.statusPaused : t.schedule.statusActive}
                </span>
              </span>
            </div>

            {/* Schedule */}
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-[#656358]">{t.schedule.schedule}</span>
              <span className="flex items-center gap-1.5 text-[13px] text-[#29261b]">
                <Clock className="h-3.5 w-3.5 text-[#656358]" />
                {scheduleDesc}
              </span>
            </div>

            {/* Total runs */}
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-[#656358]">{t.schedule.runHistory}</span>
              <span className="text-[13px] text-[#29261b]">
                {format(t.schedule.totalRuns, { count: task.totalRuns })}
              </span>
            </div>
          </div>

          {/* Description */}
          {task.description && (
            <div className="bg-white rounded-xl border border-[#e8e4dd] p-4">
              <div className="text-[13px] text-[#656358] mb-1.5">{t.schedule.description}</div>
              <p className="text-[14px] text-[#29261b] leading-relaxed whitespace-pre-wrap">
                {task.description}
              </p>
            </div>
          )}

          {/* Prompt */}
          <div className="bg-white rounded-xl border border-[#e8e4dd] p-4">
            <div className="text-[13px] text-[#656358] mb-1.5">{t.schedule.prompt}</div>
            <p className="text-[14px] text-[#29261b] leading-relaxed whitespace-pre-wrap font-mono bg-[#faf8f5] rounded-lg p-3 text-[13px]">
              {task.prompt}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleRunNow}
              disabled={isRunning}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors',
                isRunning
                  ? 'bg-amber-50 text-amber-600 cursor-not-allowed'
                  : 'bg-[#d97757] text-white hover:bg-[#c8664a]'
              )}
            >
              {isRunning ? (
                <RotateCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {isRunning ? t.schedule.running : t.schedule.runNow}
            </button>

            <button
              onClick={() => isPaused ? resumeTask(task.id) : pauseTask(task.id)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium bg-[#f5f3ee] text-[#3d3929] hover:bg-[#e8e5de] transition-colors"
            >
              {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              {isPaused ? t.schedule.resume : t.schedule.pause}
            </button>

            <div className="flex-1" />

            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium text-red-500 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t.schedule.delete}
            </button>
          </div>

          {/* Run history */}
          <div className="bg-white rounded-xl border border-[#e8e4dd] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#e8e4dd]">
              <h3 className="text-[14px] font-medium text-[#29261b]">
                {t.schedule.runHistory}
              </h3>
            </div>
            <ScheduleRunHistory runs={task.runs} />
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        title={t.schedule.delete}
        message={t.schedule.deleteConfirm}
        confirmText={t.common.confirm}
        cancelText={t.common.cancel}
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
        variant="danger"
      />
    </div>
  );
}
