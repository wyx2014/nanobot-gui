import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ScheduleRunHistory from './ScheduleRunHistory';
import { formatScheduleRunDate } from './useOpenScheduleRun';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { ScheduledTaskRun } from '@/types/schedule';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: Root | undefined;

beforeEach(() => {
  useSettingsStore.getState().setLanguage('zh-CN');
  useChatStore.setState({
    conversations: {},
    activeConversationId: null,
    conversationNavigationHistory: [],
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
  useChatStore.setState({
    conversations: {},
    activeConversationId: null,
    conversationNavigationHistory: [],
  });
});

describe('ScheduleRunHistory', () => {
  it('always uses the standard scheduled-run title instead of a gateway conversation title', () => {
    const startedAt = new Date(2026, 7, 13, 13, 5).getTime();
    const sessionKey = 'cron:daily-brief:1723456789000:abcd1234';
    const run: ScheduledTaskRun = {
      id: '1723456789000:abcd1234',
      runId: '1723456789000:abcd1234',
      scheduledTaskId: 'daily-brief',
      conversationId: sessionKey,
      sessionKey,
      startedAt,
      completedAt: startedAt + 1_000,
      status: 'completed',
    };
    useChatStore.getState().upsertConversation(sessionKey, {
      id: sessionKey,
      title: 'The user wants me to execute a',
      messages: [],
      createdAt: startedAt,
      updatedAt: startedAt,
      status: 'idle',
      scheduledTaskId: 'daily-brief',
    });

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(
      <ScheduleRunHistory runs={[run]} taskName="每日AI新闻推送" />,
    ));

    const expectedTitle = `${formatScheduleRunDate(startedAt)} - 每日AI新闻推送`;
    expect(container?.textContent).toContain(expectedTitle);
    expect(container?.textContent).not.toContain('The user wants me to execute a');
  });
});
