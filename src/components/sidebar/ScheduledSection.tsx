import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useI18n } from '@/i18n';
import { syncSessionFromGateway } from '@/core/nanobotClient';
import { ChevronRight, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScheduledTaskRun } from '@/types/schedule';

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
  const setSelectedTaskId = useScheduleStore((s) => s.setSelectedTaskId);
  const markRunViewed = useScheduleStore((s) => s.markRunViewed);
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const switchConversation = useChatStore((s) => s.switchConversation);
  const setViewMode = useSettingsStore((s) => s.setViewMode);
  const viewMode = useSettingsStore((s) => s.viewMode);

  const [sectionOpen, setSectionOpen] = useState(true);
  const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>({});

  // Context menu for child runs
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    taskId: string;
    run: ScheduledTaskRun;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  // Close context menu when clicking outside
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [contextMenu]);

  // Only show tasks that have runs
  const tasksWithRuns = Object.values(tasks).filter((task) => task.runs.length > 0);
  if (tasksWithRuns.length === 0) return null;

  const toggleTask = (taskId: string) => {
    setExpandedTasks((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  const handleParentClick = (taskId: string) => {
    setSelectedTaskId(taskId);
    setViewMode('schedule');
  };

  const handleRunClick = async (taskId: string, run: ScheduledTaskRun) => {
    const sessionKey = run.sessionKey ?? run.conversationId;
    if (!conversations[sessionKey]) {
      await syncSessionFromGateway(sessionKey, {
        scheduledTaskId: taskId,
        title: `${formatRunDate(run.startedAt)} - ${tasks[taskId]?.name ?? '定时任务'}`,
      });
    }
    const conv = useChatStore.getState().conversations[sessionKey];
    if (conv) {
      if (conv.scheduledTaskId !== taskId) {
        useChatStore.getState().upsertConversation(sessionKey, {
          ...conv,
          scheduledTaskId: taskId,
        });
      }
      switchConversation(sessionKey);
      setViewMode('chat');
      void markRunViewed(taskId, run).catch((err) => {
        console.warn('Failed to mark schedule run viewed', err);
      });
    }
  };

  const handleRunContextMenu = (
    e: React.MouseEvent,
    taskId: string,
    run: ScheduledTaskRun
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, taskId, run });
  };

  const handleViewScheduledTask = () => {
    if (!contextMenu) return;
    setSelectedTaskId(contextMenu.taskId);
    setViewMode('schedule');
    setContextMenu(null);
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
                {/* Parent task row — chevron toggles children, title opens detail */}
                <div className="flex items-center gap-1 px-2">
                  <button
                    onClick={() => toggleTask(task.id)}
                    className="shrink-0 p-0.5 text-[#656358] hover:text-[#29261b]"
                  >
                    <ChevronRight
                      className={cn('h-3 w-3 transition-transform', isExpanded && 'rotate-90')}
                    />
                  </button>
                  <button
                    onClick={() => handleParentClick(task.id)}
                    className={cn(
                      'flex-1 min-w-0 text-left py-1 rounded-md text-[13px] font-medium tracking-[-0.01em] truncate',
                      'text-[#3d3929] hover:text-[#29261b]'
                    )}
                  >
                    <span className="truncate">{task.name}</span>
                  </button>
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
                          onContextMenu={(e) => handleRunContextMenu(e, task.id, run)}
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

      {/* Context menu for child runs */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-white rounded-lg shadow-lg border border-[#e8e4dd] py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={handleViewScheduledTask}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] text-[#3d3929] hover:bg-[#f0ede6]"
          >
            <Clock className="h-3.5 w-3.5" />
            {t.sidebar.viewScheduledTask}
          </button>
        </div>
      )}
    </div>
  );
}
