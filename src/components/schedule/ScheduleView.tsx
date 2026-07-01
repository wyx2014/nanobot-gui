import { useEffect } from 'react';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useI18n } from '@/i18n';
import { navigateToChatWithInput } from '@/utils/navigation';
import { Plus, Clock, Info, Wand2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import ScheduleTaskCard from './ScheduleTaskCard';
import ScheduleEditor from './ScheduleEditor';

export default function ScheduleView() {
  const { t } = useI18n();
  const { tasks, openEditor, loadTasks, loading, error } = useScheduleStore();

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const handleAskAbu = () => {
    navigateToChatWithInput(t.schedule.askAbuCreatePrompt);
  };

  const sortedTasks = Object.values(tasks).sort((a, b) => b.createdAt - a.createdAt);
  const hasRunningRuns = sortedTasks.some((task) => task.runs.some((run) => run.status === 'running'));

  useEffect(() => {
    if (!hasRunningRuns) return;
    const id = window.setInterval(() => {
      void loadTasks();
    }, 2000);
    return () => window.clearInterval(id);
  }, [hasRunningRuns, loadTasks]);

  return (
    <div className="flex flex-col h-full bg-[#faf8f5]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#e8e4dd]/60">
        <h1 className="text-[16px] font-semibold text-[#29261b]">{t.schedule.title}</h1>
        {sortedTasks.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleAskAbu}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium bg-[#f0ede6] text-[#29261b] hover:bg-[#e8e4dd] transition-colors shrink-0"
            >
              <Wand2 className="h-3.5 w-3.5 text-[#d97757]" />
              {t.schedule.askRuyiToCreate}
            </button>
            <button
              onClick={() => openEditor()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium bg-[#d97757] text-white hover:bg-[#c8664a] transition-colors shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              {t.schedule.newTask}
            </button>
          </div>
        )}
      </div>

      {/* Info banner */}
      <div className="mx-6 mt-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-[#f0ede6]/80 border border-[#e8e4dd]/50">
        <Info className="h-3.5 w-3.5 text-[#656358] shrink-0" />
        <span className="text-[12px] text-[#656358]">{t.schedule.onlyRunWhileAwake}</span>
      </div>

      {/* Task list or empty state */}
      {loading && sortedTasks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[13px] text-[#656358]">
          正在从 nanobot 加载定时任务...
        </div>
      ) : error ? (
        <div className="mx-6 mt-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : sortedTasks.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <div className="w-16 h-16 rounded-full bg-[#f0ede6] flex items-center justify-center mb-4">
            <Clock className="h-7 w-7 text-[#9a9689]" />
          </div>
          <p className="text-[15px] text-[#29261b] font-medium mb-1.5">
            {t.schedule.noTasks}
          </p>
          <p className="text-[13px] text-[#656358] mb-5">
            {t.schedule.noTasksHint}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => openEditor()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium bg-[#d97757] text-white hover:bg-[#c8664a] transition-colors"
            >
              <Plus className="h-4 w-4" />
              {t.schedule.noTasksCTA}
            </button>
            <button
              onClick={handleAskAbu}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium bg-[#f0ede6] text-[#29261b] hover:bg-[#e8e4dd] transition-colors"
            >
              <Wand2 className="h-4 w-4 text-[#d97757]" />
              {t.schedule.askRuyiToCreate}
            </button>
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="px-6 py-4 space-y-3">
            {sortedTasks.map((task) => (
              <ScheduleTaskCard key={task.id} task={task} />
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Editor modal */}
      <ScheduleEditor />
    </div>
  );
}
