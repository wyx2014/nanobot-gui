import { useState, useEffect } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useI18n } from '@/i18n';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScheduledTaskRun } from '@/types/schedule';
import { useOpenScheduleRun } from '@/components/schedule/useOpenScheduleRun';

const MAX_VISIBLE_RUNS = 5;

function formatRunDate(timestamp: number): string {
  const d = new Date(timestamp);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${month}/${day} ${h}:${m}`;
}

function RunStatusDot({ run }: { run: ScheduledTaskRun }) {
  const isUnread = (run.status === 'completed' || run.status === 'error') && !run.viewedAt;
  if (run.status === 'running') {
    return <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />;
  }
  if (isUnread) {
    return <span className="w-1.5 h-1.5 rounded-full bg-[#d97757] shrink-0" />;
  }
  if (run.status === 'error') {
    return <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />;
  }
  return <span className="w-1.5 shrink-0" />;
}

export default function ScheduledSection() {
  const { t } = useI18n();
  const tasks = useScheduleStore((s) => s.tasks);
  const loadTasks = useScheduleStore((s) => s.loadTasks);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const viewMode = useSettingsStore((s) => s.viewMode);
  const openScheduleRun = useOpenScheduleRun();

  const [sectionOpen, setSectionOpen] = useState(true);
  const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  // Only show tasks that have runs
  const tasksWithRuns = Object.values(tasks).filter((task) => task.runs.length > 0);
  if (tasksWithRuns.length === 0) return null;

  const toggleTask = (taskId: string) => {
    setExpandedTasks((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  const handleRunClick = async (taskId: string, run: ScheduledTaskRun) => {
    await openScheduleRun(run, tasks[taskId]?.name ?? '自动化');
  };

  return (
    <div className="px-3 pb-4">
      {/* Section header */}
      <button
        onClick={() => setSectionOpen(!sectionOpen)}
        className="flex items-center gap-1 w-full px-2 py-1 text-[13px] font-medium tracking-[-0.01em] text-[#8a867c] hover:text-[#29261b]"
      >
        <ChevronRight
          className={cn('h-3 w-3 transition-transform', sectionOpen && 'rotate-90')}
        />
        <span>{t.sidebar.scheduled}</span>
      </button>

      {sectionOpen && (
        <div className="space-y-0.5">
          {tasksWithRuns.map((task) => {
            const isExpanded = expandedTasks[task.id] ?? true;
            const visibleRuns = isExpanded
              ? task.runs.slice(0, MAX_VISIBLE_RUNS)
              : [];

            return (
              <div key={task.id}>
                {/* Parent task row only groups execution records. */}
                <div className="flex items-center gap-1 px-2">
                  <button
                    onClick={() => toggleTask(task.id)}
                    className="shrink-0 p-0.5 text-[#656358] hover:text-[#29261b]"
                  >
                    <ChevronRight
                      className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-90')}
                    />
                  </button>
                  <div className="min-w-0 flex-1 py-1 text-[13px] font-medium tracking-[-0.01em] text-[#3d3929]">
                    <span className="truncate">{task.name}</span>
                  </div>
                </div>

                {/* Child run items */}
                {isExpanded && (
                  <div className="ml-5 space-y-px">
                    {visibleRuns.map((run) => {
                      const sessionKey = run.sessionKey ?? run.conversationId;
                      const isActive = sessionKey === activeConversationId && viewMode === 'chat';
                      // Label: "M/D HH:mm - TaskName" like Cowork's "Mar 5 - Hello greeting"
                      const label = `${formatRunDate(run.startedAt)} - ${task.name}`;

                      return (
                        <button
                          key={run.id}
                          onClick={() => void handleRunClick(task.id, run)}
                          className={cn(
                            'flex items-center gap-1.5 w-full px-2 py-1 rounded-lg text-[12.5px] font-medium tracking-[-0.01em] truncate transition-colors',
                            isActive
                              ? 'bg-[#ecebe7] text-[#29261b]'
                              : 'text-[#656358] hover:bg-[#eeeeea] hover:text-[#3d3929]'
                          )}
                        >
                          <RunStatusDot run={run} />
                          <span className="truncate">{label}</span>
                        </button>
                      );
                    })}
                    {task.runs.length > MAX_VISIBLE_RUNS && (
                      <button
                        onClick={() => toggleTask(task.id)}
                        className="w-full px-2 py-0.5 text-[11px] text-[#999] hover:text-[#656358] text-left"
                      >
                        +{task.runs.length - MAX_VISIBLE_RUNS} more
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
