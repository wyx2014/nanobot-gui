import { useCallback } from 'react';
import { getNanobotClient, syncSessionFromGateway } from '@/core/nanobotClient';
import { isScheduleRunConversationTitle } from '@/core/scheduleRunTitle';
import { useChatStore } from '@/stores/chatStore';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { ScheduledTaskRun } from '@/types/schedule';

export { isScheduleRunConversationTitle };

export function formatScheduleRunDate(timestamp: number): string {
  const date = new Date(timestamp);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours().toString().padStart(2, '0');
  const minute = date.getMinutes().toString().padStart(2, '0');
  return `${month}/${day} ${hour}:${minute}`;
}

export function useOpenScheduleRun() {
  const switchConversation = useChatStore((state) => state.switchConversation);
  const setViewMode = useSettingsStore((state) => state.setViewMode);
  const markRunViewed = useScheduleStore((state) => state.markRunViewed);

  return useCallback(async (run: ScheduledTaskRun, taskName: string) => {
    const sessionKey = run.sessionKey ?? run.conversationId;
    if (!sessionKey) return false;

    const fallbackTitle = `${formatScheduleRunDate(run.startedAt)} - ${taskName}`;
    if (run.status === 'running') {
      try {
        getNanobotClient().attach(sessionKey);
      } catch {
        // The active ChatView subscribes after gateway bootstrap completes.
      }
    }

    if (
      run.status === 'running'
      && !useChatStore.getState().conversations[sessionKey]
    ) {
      useChatStore.getState().createConversation(null, {
        id: sessionKey,
        scheduledTaskId: run.scheduledTaskId,
        skipActivate: true,
        title: fallbackTitle,
      });
      useChatStore.getState().setConversationStatus(sessionKey, 'running');
    } else if (!useChatStore.getState().conversations[sessionKey]) {
      await syncSessionFromGateway(sessionKey, {
        scheduledTaskId: run.scheduledTaskId,
        title: fallbackTitle,
      });
    }

    const conversation = useChatStore.getState().conversations[sessionKey];
    if (!conversation) return false;

    if (
      conversation.scheduledTaskId !== run.scheduledTaskId
      || conversation.title !== fallbackTitle
    ) {
      useChatStore.getState().upsertConversation(sessionKey, {
        ...conversation,
        title: fallbackTitle,
        scheduledTaskId: run.scheduledTaskId,
      });
    }

    switchConversation(sessionKey);
    setViewMode('chat');
    void markRunViewed(run.scheduledTaskId, run).catch((error) => {
      console.warn('Failed to mark schedule run viewed', error);
    });
    return true;
  }, [markRunViewed, setViewMode, switchConversation]);
}
