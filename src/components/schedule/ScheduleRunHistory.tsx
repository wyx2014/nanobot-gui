import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useI18n } from '@/i18n';
import { syncSessionFromGateway } from '@/core/nanobotClient';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScheduledTaskRun } from '@/types/schedule';

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

function formatRunDate(timestamp: number): string {
  const d = new Date(timestamp);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${month}/${day} ${h}:${m}`;
}

function isDefaultConversationTitle(title: string | undefined): boolean {
  const cleaned = title?.trim();
  return !cleaned || cleaned === '新对话' || cleaned === 'New chat';
}

export default function ScheduleRunHistory({ runs, taskName }: Props) {
  const { t } = useI18n();
  const switchConversation = useChatStore((s) => s.switchConversation);
  const setViewMode = useSettingsStore((s) => s.setViewMode);
  const setReturnTarget = useScheduleStore((s) => s.setReturnTarget);
  const markRunViewed = useScheduleStore((s) => s.markRunViewed);
  const conversations = useChatStore((s) => s.conversations);

  const handleViewConversation = async (run: ScheduledTaskRun) => {
    const sessionKey = run.sessionKey ?? run.conversationId;
    const fallbackTitle = `${formatRunDate(run.startedAt)} - ${taskName}`;
    if (!conversations[sessionKey]) {
      await syncSessionFromGateway(sessionKey, {
        scheduledTaskId: run.scheduledTaskId,
        title: fallbackTitle,
      });
    }
    const conv = useChatStore.getState().conversations[sessionKey];
    if (conv) {
      if (conv.scheduledTaskId !== run.scheduledTaskId || isDefaultConversationTitle(conv.title)) {
        useChatStore.getState().upsertConversation(sessionKey, {
          ...conv,
          title: isDefaultConversationTitle(conv.title) ? fallbackTitle : conv.title,
          scheduledTaskId: run.scheduledTaskId,
        });
      }
      setReturnTarget({ taskId: run.scheduledTaskId, runId: run.id });
      switchConversation(sessionKey);
      setViewMode('chat');
      void markRunViewed(run.scheduledTaskId, run).catch((err) => {
        console.warn('Failed to mark schedule run viewed', err);
      });
    }
  };

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
        const sessionKey = run.sessionKey ?? run.conversationId;
        const conversationTitle = conversations[sessionKey]?.title;
        const title = isDefaultConversationTitle(conversationTitle)
          ? `${formatRunDate(run.startedAt)} - ${taskName}`
          : conversationTitle;
        const isUnread = (run.status === 'completed' || run.status === 'error') && !run.viewedAt;

        return (
          <div
            key={run.id}
            className="flex items-center gap-2 px-2 py-2 rounded-md hover:bg-[#f5f3ee] transition-colors"
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

            {(run.sessionKey || run.conversationId) && (
              <button
                onClick={() => void handleViewConversation(run)}
                className="text-[#656358] hover:text-[#d97757] p-1 shrink-0"
                title={t.schedule.viewConversation}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
