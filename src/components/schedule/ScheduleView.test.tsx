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
const originalMarkRunViewed = useScheduleStore.getState().markRunViewed;

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
    activeRunDetail: null,
    loadTasks: vi.fn(async () => undefined),
    markRunViewed: vi.fn(async () => undefined),
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
    markRunViewed: originalMarkRunViewed,
    tasks: {},
    selectedTaskId: null,
    showEditor: false,
    editingTaskId: null,
    editorDraft: null,
    activeRunDetail: null,
  });
});

describe('ScheduleView automation center', () => {
  it('defaults a blank task to a one-time date instead of a daily recurrence', () => {
    useScheduleStore.setState({
      showEditor: true,
      editingTaskId: null,
      editorDraft: null,
    });

    const view = renderView();

    expect(view.querySelector('[data-schedule-once-date]')).not.toBeNull();
    expect(view.querySelector<HTMLInputElement>('input[name="schedule-date"]')?.value).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
    expect(view.textContent).toContain('仅一次');
    expect(view.textContent).toContain('不会自动重复');
  });

  it('renders a chat-created one-time reminder with its exact date', () => {
    useScheduleStore.setState({
      tasks: {
        once: taskFixture({
          id: 'once',
          name: '提交材料提醒',
          schedule: {
            frequency: 'once',
            at: '2099-08-30T01:15:00Z',
            timezone: 'Asia/Shanghai',
          },
        }),
      },
    });

    const view = renderView();

    expect(view.textContent).toContain('仅一次');
    expect(view.textContent).toContain('2099');
    expect(view.textContent).toContain('Asia/Shanghai');
    expect(view.textContent).not.toContain('每天 09:00');
  });

  it('keeps a finished one-time reminder as completed history instead of a resumable task', () => {
    useScheduleStore.setState({
      tasks: {
        completed: taskFixture({
          id: 'completed',
          name: '已触发的提醒',
          status: 'completed',
          schedule: {
            frequency: 'once',
            at: '2026-08-20T01:15:00Z',
            timezone: 'Asia/Shanghai',
          },
          lastRunAt: Date.now() - 60_000,
        }),
      },
    });

    const view = renderView();

    expect(view.textContent).toContain('已完成');
    expect(view.querySelector('[data-schedule-toggle]')).toBeNull();
  });

  it('archives a successfully completed one-time task after its latest run is viewed', async () => {
    const completedAt = Date.now();
    useScheduleStore.setState({
      markRunViewed: vi.fn(async (taskId, run) => {
        useScheduleStore.setState((state) => ({
          tasks: {
            ...state.tasks,
            [taskId]: {
              ...state.tasks[taskId],
              runs: state.tasks[taskId].runs.map((item) => (
                item.id === run.id ? { ...item, viewedAt: Date.now() } : item
              )),
            },
          },
        }));
      }),
      tasks: {
        once: taskFixture({
          id: 'once',
          name: '找李家平安排任务',
          status: 'completed',
          schedule: {
            frequency: 'once',
            at: '2026-08-26T05:10:00Z',
          },
          totalRuns: 1,
          runs: [{
            id: 'once-run',
            runId: 'once-run',
            scheduledTaskId: 'once',
            conversationId: 'cron:once:once-run',
            sessionKey: 'cron:once:once-run',
            startedAt: completedAt - 1_000,
            completedAt,
            status: 'completed',
          }],
        }),
      },
    });

    const view = renderView();

    expect(view.querySelector('[data-schedule-card]')).not.toBeNull();
    expect(view.textContent).toContain('找李家平安排任务');

    act(() => view.querySelector<HTMLButtonElement>('[data-schedule-tab="runs"]')?.click());
    expect(view.querySelector('[data-schedule-run-row="once:once-run"]')).not.toBeNull();
    await act(async () => {
      view.querySelector<HTMLButtonElement>('[data-schedule-run-open="once:once-run"]')?.click();
      await Promise.resolve();
    });
    expect(useScheduleStore.getState().markRunViewed).toHaveBeenCalledWith(
      'once',
      expect.objectContaining({ id: 'once-run' }),
    );

    act(() => {
      useScheduleStore.getState().closeRunDetail();
      view.querySelector<HTMLButtonElement>('[data-schedule-tab="tasks"]')?.click();
    });
    expect(view.querySelector('[data-schedule-card]')).toBeNull();
    expect(view.textContent).not.toContain('找李家平安排任务');

    act(() => view.querySelector<HTMLButtonElement>('[data-schedule-tab="runs"]')?.click());
    expect(view.querySelector('[data-schedule-run-row="once:once-run"]')).not.toBeNull();
  });

  it('does not restore an archived reminder when a stale poll omits viewedAt', () => {
    const completedAt = Date.now();
    const archivedTask = taskFixture({
      id: 'once',
      name: 'A股开市提醒',
      status: 'completed',
      schedule: {
        frequency: 'once',
        at: '2026-08-26T05:10:00Z',
      },
      totalRuns: 1,
      runs: [{
        id: 'once-run',
        runId: 'once-run',
        scheduledTaskId: 'once',
        resultType: 'none',
        conversationAvailable: false,
        startedAt: completedAt - 1_000,
        completedAt,
        status: 'completed',
        viewedAt: completedAt + 1_000,
      }],
    });
    useScheduleStore.setState({ tasks: { once: archivedTask } });
    const view = renderView();

    expect(view.querySelector('[data-schedule-card]')).toBeNull();

    act(() => {
      useScheduleStore.getState().applyPayload({
        tasks: [{
          ...archivedTask,
          runs: archivedTask.runs.map(({ viewedAt: _viewedAt, ...run }) => run),
        }],
      });
    });

    expect(useScheduleStore.getState().tasks.once.runs[0]?.viewedAt).toBe(completedAt + 1_000);
    expect(view.querySelector('[data-schedule-card]')).toBeNull();
  });

  it('keeps unviewed, failed, and recurring tasks in My Automations', () => {
    const now = Date.now();
    const run = (id: string, status: 'completed' | 'error', viewedAt?: number) => ({
      id,
      runId: id,
      scheduledTaskId: id,
      conversationId: `cron:${id}:${id}`,
      sessionKey: `cron:${id}:${id}`,
      startedAt: now,
      completedAt: now + 1_000,
      status,
      viewedAt,
    });
    useScheduleStore.setState({
      tasks: {
        unviewed: taskFixture({
          id: 'unviewed',
          name: '未查看单次任务',
          status: 'completed',
          schedule: { frequency: 'once', at: '2026-08-26T05:10:00Z' },
          runs: [run('unviewed', 'completed')],
        }),
        failed: taskFixture({
          id: 'failed',
          name: '失败单次任务',
          status: 'completed',
          schedule: { frequency: 'once', at: '2026-08-26T05:10:00Z' },
          runs: [run('failed', 'error', now + 2_000)],
        }),
        recurring: taskFixture({
          id: 'recurring',
          name: '周期任务',
          schedule: { frequency: 'daily', time: { hour: 9, minute: 0 } },
          runs: [run('recurring', 'completed', now + 2_000)],
        }),
      },
    });

    const view = renderView();

    expect(view.querySelectorAll('[data-schedule-card]')).toHaveLength(3);
    expect(view.textContent).toContain('未查看单次任务');
    expect(view.textContent).toContain('失败单次任务');
    expect(view.textContent).toContain('周期任务');
  });

  it('shows unread reminders only in execution records, not task cards', () => {
    useScheduleStore.setState({ tasks: { 'daily-brief': taskFixture() } });
    const view = renderView();

    const taskCard = view.querySelector<HTMLElement>('[data-schedule-card]');
    const runsTab = view.querySelector<HTMLButtonElement>('[data-schedule-tab="runs"]');
    expect(taskCard?.textContent).not.toContain('未读');
    expect(runsTab?.textContent).toContain('2');

    act(() => runsTab?.click());
    expect(view.querySelector('[aria-label="未读结果"]')).not.toBeNull();
  });

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

  it('opens run details first, then opens the full live conversation', async () => {
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

    expect(useScheduleStore.getState().activeRunDetail).toEqual({
      taskId: 'daily-brief',
      runId: '1723456789000:abcd1234',
    });
    expect(document.querySelector('[data-schedule-run-detail]')).not.toBeNull();

    const viewConversation = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('查看完整对话'));
    await act(async () => {
      viewConversation?.click();
      await Promise.resolve();
    });

    expect(useChatStore.getState().activeConversationId).toBe(runningSessionKey);
    expect(useChatStore.getState().conversations[runningSessionKey]).toMatchObject({
      scheduledTaskId: 'daily-brief',
      status: 'running',
    });
    expect(useSettingsStore.getState().viewMode).toBe('chat');
  });

  it('confirms a reminder without opening details or a fake conversation', async () => {
    const reminderSessionKey = 'cron:reminder:legacy-run';
    useScheduleStore.setState({
      tasks: {
        'daily-brief': taskFixture({
          totalRuns: 1,
          runs: [{
            id: 'legacy-run',
            runId: 'legacy-run',
            scheduledTaskId: 'daily-brief',
            conversationId: reminderSessionKey,
            sessionKey: reminderSessionKey,
            resultType: 'none',
            conversationAvailable: false,
            startedAt: Date.now() - 1_000,
            completedAt: Date.now(),
            status: 'completed',
          }],
        }),
      },
    });
    const view = renderView();
    act(() => view.querySelector<HTMLButtonElement>('[data-schedule-tab="runs"]')?.click());
    const row = view.querySelector<HTMLButtonElement>('[data-schedule-run-confirm]');
    expect(row?.disabled).toBe(false);
    expect(row?.textContent).toContain('确认');

    await act(async () => {
      row?.click();
      await Promise.resolve();
    });

    expect(useScheduleStore.getState().markRunViewed).toHaveBeenCalledWith(
      'daily-brief',
      expect.objectContaining({ id: 'legacy-run', resultType: 'none' }),
    );
    expect(useScheduleStore.getState().activeRunDetail).toBeNull();
    expect(document.querySelector('[data-schedule-run-detail]')).toBeNull();
    expect(useChatStore.getState().activeConversationId).toBeNull();
    expect(Array.from(document.querySelectorAll('button')).some(
      (button) => button.textContent?.includes('查看完整对话'),
    )).toBe(false);
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
