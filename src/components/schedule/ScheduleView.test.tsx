import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScheduleView from './ScheduleView';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useChatStore } from '@/stores/chatStore';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { ScheduledTask } from '@/types/schedule';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalLoadTasks = useScheduleStore.getState().loadTasks;
const originalDeleteRun = useScheduleStore.getState().deleteRun;

let container: HTMLDivElement | undefined;
let root: Root | undefined;

function taskFixture(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  const now = Date.now();
  return {
    id: 'daily-brief',
    name: '每日简报',
    description: '汇总当天要闻',
    prompt: '搜索并总结当天最重要的新闻',
    schedule: { frequency: 'daily', time: { hour: 8, minute: 30 } },
    status: 'active',
    createdAt: now - 100_000,
    updatedAt: now,
    totalRuns: 2,
    runs: [
      {
        id: 'run-success',
        scheduledTaskId: 'daily-brief',
        conversationId: 'cron:daily-brief:success',
        sessionKey: 'cron:daily-brief:success',
        startedAt: now - 60_000,
        completedAt: now - 30_000,
        status: 'completed',
      },
      {
        id: 'run-error',
        scheduledTaskId: 'daily-brief',
        conversationId: 'cron:daily-brief:error',
        sessionKey: 'cron:daily-brief:error',
        startedAt: now - 120_000,
        completedAt: now - 90_000,
        status: 'error',
        error: '联网搜索失败',
      },
    ],
    ...overrides,
  };
}

function renderView() {
  container = document.createElement('div');
  container.style.height = '900px';
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(
    <TooltipProvider delayDuration={0}>
      <ScheduleView />
    </TooltipProvider>,
  ));
  return container;
}

beforeEach(() => {
  useSettingsStore.getState().setLanguage('zh-CN');
  useDiscoveryStore.setState({ skills: [] });
  useChatStore.setState({
    conversations: {},
    activeConversationId: null,
    conversationNavigationHistory: [],
  });
  useScheduleStore.setState({
    tasks: {},
    loading: false,
    error: null,
    activeTaskId: null,
    selectedTaskId: null,
    showEditor: false,
    editingTaskId: null,
    editorDraft: null,
    loadTasks: vi.fn(async () => undefined),
    deleteRun: vi.fn(async (taskId, run) => {
      useScheduleStore.setState((state) => ({
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...state.tasks[taskId],
            runs: state.tasks[taskId].runs.filter((item) => item.id !== run.id),
            totalRuns: Math.max(0, state.tasks[taskId].totalRuns - 1),
          },
        },
      }));
    }),
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
  useScheduleStore.setState({
    loadTasks: originalLoadTasks,
    deleteRun: originalDeleteRun,
    tasks: {},
    selectedTaskId: null,
    showEditor: false,
    editingTaskId: null,
    editorDraft: null,
  });
});

describe('ScheduleView automation center', () => {
  it('shows WorkBuddy-style tabs and opens a template as a prefilled real task draft', () => {
    const view = renderView();

    expect(view.querySelector('[data-schedule-tab="tasks"]')?.textContent).toContain('定时任务');
    expect(view.querySelector('[data-schedule-tab="runs"]')?.textContent).toContain('执行记录');
    expect(view.querySelectorAll('[data-automation-template]')).toHaveLength(6);
    expect(
      Array.from(view.querySelectorAll<HTMLElement>('[data-automation-template]'))
        .map((item) => item.getAttribute('data-automation-template')),
    ).toEqual([
      'weekly-work-report',
      'daily-morning-work-brief',
      'ai-daily-brief',
      'monthly-work-review',
      'knowledge-capture-assistant',
      'daily-email-todo-extractor',
    ]);

    const template = view.querySelector<HTMLButtonElement>('[data-automation-template="ai-daily-brief"]');
    expect(template).not.toBeNull();
    act(() => template?.click());

    const editor = view.querySelector<HTMLElement>('[data-schedule-editor]');
    expect(editor).not.toBeNull();
    expect(editor?.querySelector<HTMLInputElement>('input[name="schedule-name"]')?.value).toBe('每日 AI 新闻推送');
    expect(editor?.querySelector<HTMLTextAreaElement>('textarea[name="schedule-prompt"]')?.value).toContain('过去 24 小时');
    expect(useScheduleStore.getState().editorDraft?.schedule).toEqual({
      frequency: 'daily',
      time: { hour: 8, minute: 30 },
    });
  });

  it('opens the monthly work review with a real monthly schedule', () => {
    const view = renderView();
    const template = view.querySelector<HTMLButtonElement>('[data-automation-template="monthly-work-review"]');

    act(() => template?.click());

    expect(useScheduleStore.getState().editorDraft?.schedule).toEqual({
      frequency: 'monthly',
      time: { hour: 9, minute: 0 },
      dayOfMonth: 1,
    });
    expect(view.querySelector('[data-schedule-month-day]')).not.toBeNull();
  });

  it('aggregates run history across tasks and filters it by search text', () => {
    useScheduleStore.setState({ tasks: { 'daily-brief': taskFixture() } });
    const view = renderView();

    const historyTab = view.querySelector<HTMLButtonElement>('[data-schedule-tab="runs"]');
    act(() => historyTab?.click());
    expect(view.querySelectorAll('[data-schedule-run-row]')).toHaveLength(2);

    const search = view.querySelector<HTMLInputElement>('input[placeholder="搜索自动化或运行记录"]');
    expect(search).not.toBeNull();
    act(() => {
      if (!search) return;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(search, '联网搜索失败');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(view.querySelectorAll('[data-schedule-run-row]')).toHaveLength(1);
    expect(view.textContent).toContain('联网搜索失败');
  });

  it('does not surface gateway-generated conversation titles in run records', () => {
    useScheduleStore.setState({ tasks: { 'daily-brief': taskFixture() } });
    const sessionKey = 'cron:daily-brief:success';
    useChatStore.setState({
      conversations: {
        [sessionKey]: {
          id: sessionKey,
          title: 'The user wants me to execute a',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: 'idle',
          scheduledTaskId: 'daily-brief',
        },
      },
      activeConversationId: null,
      conversationNavigationHistory: [],
    });
    const view = renderView();
    act(() => view.querySelector<HTMLButtonElement>('[data-schedule-tab="runs"]')?.click());

    expect(view.textContent).not.toContain('The user wants me to execute a');
  });


  it('keeps task cards focused on task management without expandable run history', () => {
    useScheduleStore.setState({ tasks: { 'daily-brief': taskFixture() } });
    const view = renderView();

    expect(view.querySelector('[data-schedule-card]')).not.toBeNull();
    expect(view.querySelector('[data-schedule-run-row]')).toBeNull();
    expect(view.querySelector('[data-schedule-card] button[title="执行记录"]')).toBeNull();

    act(() => view.querySelector<HTMLButtonElement>('[data-schedule-tab="runs"]')?.click());
    expect(view.querySelectorAll('[data-schedule-run-row]')).toHaveLength(2);
  });

  it('deletes a completed run from execution records after confirmation', async () => {
    useScheduleStore.setState({ tasks: { 'daily-brief': taskFixture() } });
    const view = renderView();
    act(() => view.querySelector<HTMLButtonElement>('[data-schedule-tab="runs"]')?.click());

    const deleteButton = view.querySelector<HTMLButtonElement>('[data-schedule-run-delete="daily-brief:run-success"]');
    expect(deleteButton).not.toBeNull();
    act(() => deleteButton?.click());
    expect(view.textContent).toContain(
      '确定永久删除这条执行记录及其对应会话？删除后无法恢复，但不会删除工作空间中的文件。',
    );

    const confirmButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === '确认');
    await act(async () => {
      confirmButton?.click();
      await Promise.resolve();
    });

    expect(useScheduleStore.getState().deleteRun).toHaveBeenCalledWith(
      'daily-brief',
      expect.objectContaining({ id: 'run-success' }),
    );
    expect(view.querySelector('[data-schedule-run-row="daily-brief:run-success"]')).toBeNull();
  });

  it('opens a running record immediately and creates its live conversation shell', async () => {
    const runningSessionKey = 'cron:daily-brief:1723456789000:abcd1234';
    const runningTask = taskFixture({
      totalRuns: 1,
      runs: [{
        id: '1723456789000:abcd1234',
        runId: '1723456789000:abcd1234',
        scheduledTaskId: 'daily-brief',
        conversationId: runningSessionKey,
        sessionKey: runningSessionKey,
        startedAt: Date.now(),
        status: 'running',
      }],
    });
    useScheduleStore.setState({ tasks: { 'daily-brief': runningTask } });
    const view = renderView();

    act(() => view.querySelector<HTMLButtonElement>('[data-schedule-tab="runs"]')?.click());
    const row = view.querySelector<HTMLButtonElement>('[data-schedule-run-open]');
    expect(row?.disabled).toBe(false);

    await act(async () => {
      row?.click();
      await Promise.resolve();
    });

    expect(useChatStore.getState().activeConversationId).toBe(runningSessionKey);
    expect(useChatStore.getState().conversations[runningSessionKey]).toMatchObject({
      scheduledTaskId: 'daily-brief',
      status: 'running',
    });
    expect(useSettingsStore.getState().viewMode).toBe('chat');
  });

  it('keeps the awake-only notice behind an accessible info tooltip', () => {
    useScheduleStore.setState({ tasks: { 'daily-brief': taskFixture() } });
    const view = renderView();

    const awakeHint = view.querySelector<HTMLButtonElement>('[data-schedule-awake-hint]');
    expect(awakeHint).not.toBeNull();
    expect(awakeHint?.getAttribute('aria-label')).toBe('自动化仅在应用打开且电脑未休眠时运行');
    expect(view.textContent).not.toContain('自动化仅在应用打开且电脑未休眠时运行');
  });

  it('ignores the legacy selected task detail and keeps task management in the list', () => {
    useScheduleStore.setState({
      tasks: { 'daily-brief': taskFixture() },
      selectedTaskId: 'daily-brief',
    });
    const view = renderView();

    expect(view.querySelector('[data-schedule-detail]')).toBeNull();
    expect(view.querySelector('[data-schedule-card]')).not.toBeNull();
    expect(view.textContent).toContain('每日简报');
  });
});
