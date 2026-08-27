import { beforeEach, describe, expect, it } from 'vitest';
import type { ScheduledTask, ScheduledTaskRun } from '@/types/schedule';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { openScheduleRunNotification, ScheduleRunNotificationTracker } from './scheduleRunMonitor';

function run(id: string, status: ScheduledTaskRun['status']): ScheduledTaskRun {
  return {
    id,
    runId: id,
    scheduledTaskId: 'task-1',
    conversationId: `cron:task-1:${id}`,
    sessionKey: `cron:task-1:${id}`,
    startedAt: 1,
    ...(status === 'running' ? {} : { completedAt: 2 }),
    status,
  };
}

function task(runs: ScheduledTaskRun[]): ScheduledTask {
  return {
    id: 'task-1',
    name: '找李家平安排任务',
    prompt: '提醒用户：找李家平安排任务',
    schedule: { frequency: 'once', at: '2026-08-26T09:03:00+08:00' },
    status: 'completed',
    createdAt: 1,
    updatedAt: 2,
    runs,
    totalRuns: runs.length,
  };
}

describe('schedule run notification tracker', () => {
  beforeEach(() => {
    useScheduleStore.setState({ activeRunDetail: null });
    useSettingsStore.setState({ viewMode: 'chat' });
  });

  it('uses existing terminal history as a baseline', () => {
    const tracker = new ScheduleRunNotificationTracker([task([run('old', 'completed')])]);

    expect(tracker.consume([task([run('old', 'completed')])])).toEqual([]);
  });

  it('reports a run that completes between polls exactly once', () => {
    const tracker = new ScheduleRunNotificationTracker([task([])]);
    const completed = task([run('new', 'completed')]);

    expect(tracker.consume([completed])).toMatchObject([
      { taskId: 'task-1', taskName: '找李家平安排任务', run: { status: 'completed' } },
    ]);
    expect(tracker.consume([completed])).toEqual([]);
  });

  it('reports terminal transitions and preserves error status', () => {
    const tracker = new ScheduleRunNotificationTracker([task([run('failed', 'running')])]);

    expect(tracker.consume([task([run('failed', 'error')])])).toMatchObject([
      { run: { runId: 'failed', status: 'error' } },
    ]);
  });

  it('opens the exact run detail from a notification', () => {
    openScheduleRunNotification('task-1', 'run-7');

    expect(useScheduleStore.getState().activeRunDetail).toEqual({
      taskId: 'task-1',
      runId: 'run-7',
    });
    expect(useSettingsStore.getState().viewMode).toBe('schedule');
  });
});
