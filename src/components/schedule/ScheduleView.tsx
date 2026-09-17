import { useEffect, useMemo, useState } from 'react';
import {
  AlarmClockCheck,
  Info,
  Plus,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useScheduleStore } from '@/stores/scheduleStore';
import { navigateToChatWithInput } from '@/utils/navigation';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import ScheduleEditor from './ScheduleEditor';
import ScheduleRunCenter from './ScheduleRunCenter';
import ScheduleRunDetail from './ScheduleRunDetail';
import ScheduleTaskCard from './ScheduleTaskCard';
import ScheduleTemplateGallery from './ScheduleTemplateGallery';
import { isArchivedOneTimeTask } from './scheduleTaskVisibility';
import CenteredLoadingIndicator from '@/components/common/CenteredLoadingIndicator';

type ScheduleTab = 'tasks' | 'runs';

export default function ScheduleView() {
  const { t, format } = useI18n();
  const {
    tasks,
    showEditor,
    openEditor,
    loadTasks,
    loading,
    error,
    getUnviewedRunCount,
    activeRunDetail,
  } = useScheduleStore();
  const [activeTab, setActiveTab] = useState<ScheduleTab>('tasks');

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (activeRunDetail) setActiveTab('runs');
  }, [activeRunDetail]);

  const allTasks = useMemo(
    () => Object.values(tasks).sort((a, b) => b.createdAt - a.createdAt),
    [tasks],
  );
  const visibleTasks = useMemo(
    () => allTasks.filter((task) => !isArchivedOneTimeTask(task)),
    [allTasks],
  );
  const hasRunningRuns = allTasks.some((task) => task.runs.some((run) => run.status === 'running'));
  const activeCount = visibleTasks.filter((task) => task.status === 'active').length;
  const runCount = visibleTasks.reduce((count, task) => count + task.runs.length, 0);
  const unviewedRunCount = getUnviewedRunCount();

  useEffect(() => {
    if (!hasRunningRuns) return;
    const id = window.setInterval(() => {
      void loadTasks();
    }, 2_000);
    return () => window.clearInterval(id);
  }, [hasRunningRuns, loadTasks]);

  const handleAskAssistant = () => {
    navigateToChatWithInput(t.schedule.askAbuCreatePrompt);
  };

  if (showEditor) {
    return (
      <div data-schedule-surface className="flex h-full min-h-0 flex-col bg-[#fbfaf7] dark:bg-[#191919]">
        <ScheduleEditor />
      </div>
    );
  }

  return (
    <div data-schedule-surface className="flex h-full min-h-0 flex-col bg-[#fbfaf7] dark:bg-[#191919]">
      <header data-schedule-header className="flex min-h-[64px] shrink-0 items-center justify-between gap-4 border-b border-[#ebe7df]/70 bg-[#fbfaf7] px-6 dark:border-white/10 dark:bg-[#1b1b1b]">
        <div
          role="tablist"
          aria-label={t.schedule.title}
          className="inline-flex rounded-xl bg-[#f0eeea] p-1 dark:bg-[#292929]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'tasks'}
            data-schedule-tab="tasks"
            onClick={() => setActiveTab('tasks')}
            className={cn(
              'rounded-lg px-4 py-1.5 text-[13px] font-medium transition-all',
              activeTab === 'tasks'
                ? 'bg-white text-[#29261b] shadow-sm dark:bg-[#3a3937] dark:text-[#f1ede5]'
                : 'text-[#777267] hover:text-[#3d392f] dark:text-[#aaa69d] dark:hover:text-[#eeeae2]',
            )}
          >
            {t.schedule.tasksTab}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'runs'}
            data-schedule-tab="runs"
            onClick={() => setActiveTab('runs')}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[13px] font-medium transition-all',
              activeTab === 'runs'
                ? 'bg-white text-[#29261b] shadow-sm dark:bg-[#3a3937] dark:text-[#f1ede5]'
                : 'text-[#777267] hover:text-[#3d392f] dark:text-[#aaa69d] dark:hover:text-[#eeeae2]',
            )}
          >
            {t.schedule.runHistory}
            {unviewedRunCount > 0 && (
              <span className="min-w-4 rounded-full bg-[#d97757] px-1 py-0.5 text-center text-[9px] leading-3 text-white">
                {unviewedRunCount > 99 ? '99+' : unviewedRunCount}
              </span>
            )}
          </button>
        </div>

        {activeTab === 'tasks' && visibleTasks.length > 0 && (
          <div data-schedule-header-actions className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              data-schedule-header-action="assistant"
              onClick={handleAskAssistant}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#e5e0d7] bg-white/65 px-3 text-[12px] font-medium text-[#4b483f] shadow-[0_1px_2px_rgba(45,40,32,0.04)] transition-[background-color,border-color,color,box-shadow] hover:border-[#d8d2c7] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/30 dark:border-white/10 dark:bg-white/[0.045] dark:text-[#d5d0c7] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] dark:hover:border-white/[0.17] dark:hover:bg-white/[0.075] dark:hover:text-[#fffaf2]"
            >
              <Wand2 className="h-3.5 w-3.5 text-[#d97757] dark:text-[#e18a68]" />
              {t.schedule.askRuyiToCreate}
            </button>
            <button
              type="button"
              data-schedule-header-action="create"
              onClick={() => openEditor()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#292722] bg-[#292722] px-3.5 text-[12px] font-medium text-white shadow-sm transition-[background-color,border-color,box-shadow] hover:border-[#171613] hover:bg-[#171613] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/35 dark:border-[#d97757] dark:bg-[#d97757] dark:text-[#fffaf2] dark:shadow-[0_5px_14px_rgba(0,0,0,0.22)] dark:hover:border-[#e18463] dark:hover:bg-[#e18463] dark:active:border-[#c86c4d] dark:active:bg-[#c86c4d]"
            >
              <Plus className="h-3.5 w-3.5" />
              {t.schedule.addAutomation}
            </button>
          </div>
        )}
      </header>

      {activeTab === 'runs' ? (
        <ScheduleRunCenter />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto w-full max-w-[1320px] px-6 pb-10 pt-5">
            {loading && allTasks.length === 0 ? (
              <CenteredLoadingIndicator
                label={t.schedule.loadingTasks}
                className="min-h-[240px]"
              />
            ) : error ? (
              <div className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-[12px] text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300">
                <span>{error}</span>
                <button type="button" onClick={() => void loadTasks()} className="shrink-0 font-medium underline-offset-2 hover:underline">
                  {t.schedule.retry}
                </button>
              </div>
            ) : visibleTasks.length === 0 ? (
              <section className="flex min-h-[350px] flex-col items-center justify-center px-6 text-center">
                <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#f0ede7] text-[#aaa69d] dark:bg-[#292929] dark:text-[#77736c]">
                  <AlarmClockCheck className="h-8 w-8" strokeWidth={1.55} />
                </span>
                <h1 className="text-[17px] font-medium tracking-[-0.01em] text-[#3a372f] dark:text-[#eeeae2]">
                  {t.schedule.startFirstAutomation}
                </h1>
                <p className="mt-1.5 max-w-[430px] text-[12.5px] leading-5 text-[#777267] dark:text-[#9d9990]">
                  {t.schedule.startFirstAutomationHint}
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => openEditor()}
                    className="flex items-center gap-1.5 rounded-xl bg-[#292722] px-5 py-2.5 text-[13px] font-medium text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-[#171613] hover:shadow-md dark:bg-[#eeeae2] dark:text-[#23211e] dark:hover:bg-white"
                  >
                    <Plus className="h-4 w-4" />
                    {t.schedule.addAutomation}
                  </button>
                  <button
                    type="button"
                    onClick={handleAskAssistant}
                    className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-medium text-[#5d584f] transition-colors hover:bg-[#f0ede7] dark:text-[#c8c3ba] dark:hover:bg-[#292929]"
                  >
                    <Sparkles className="h-4 w-4 text-[#d97757]" />
                    {t.schedule.askRuyiToCreate}
                  </button>
                </div>
              </section>
            ) : (
              <section className="mb-9" aria-labelledby="my-automations-title">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h1 id="my-automations-title" className="text-[17px] font-semibold tracking-[-0.01em] text-[#29261b] dark:text-[#eeeae2]">
                      {t.schedule.myAutomations}
                    </h1>
                    <p className="mt-0.5 text-[12px] text-[#777267] dark:text-[#9d9990]">
                      {format(t.schedule.automationSummary, {
                        total: visibleTasks.length,
                        active: activeCount,
                        runs: runCount,
                      })}
                    </p>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        data-schedule-awake-hint
                        aria-label={t.schedule.onlyRunWhileAwake}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#8b877d] transition-colors hover:bg-[#f0ede6] hover:text-[#555148] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/35 dark:text-[#928e85] dark:hover:bg-[#2b2925] dark:hover:text-[#d4d0c8]"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      sideOffset={7}
                      className="border border-white/10 bg-[#292824] px-2.5 py-1.5 text-[11px] text-white shadow-lg [&>svg]:hidden"
                    >
                      {t.schedule.onlyRunWhileAwake}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="space-y-3">
                  {visibleTasks.map((task) => (
                    <ScheduleTaskCard key={task.id} task={task} />
                  ))}
                </div>
              </section>
            )}

            <ScheduleTemplateGallery />
          </div>
        </ScrollArea>
      )}

      <ScheduleRunDetail />
    </div>
  );
}
