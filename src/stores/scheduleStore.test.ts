import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleTasksPayload } from '@/core/types';
import type { ScheduledTask } from '@/types/schedule';

const mocks = vi.hoisted(() => ({
  fetchScheduleTasks: vi.fn(),
  markScheduleRunViewed: vi.fn(),
}));

vi.mock('@/core/api', () => ({
  createScheduleTask: vi.fn(),
  deleteScheduleRun: vi.fn(),
  deleteScheduleTask: vi.fn(),
  fetchScheduleTasks: mocks.fetchScheduleTasks,
  markScheduleRunViewed: mocks.markScheduleRunViewed,
  pauseScheduleTask: vi.fn(),
  resumeScheduleTask: vi.fn(),
  runScheduleTaskNow: vi.fn(),
  updateScheduleTask: vi.fn(),
}));

vi.mock('@/core/nanobotClient', () => ({
  bootstrapNanobotGateway: vi.fn(),
  getNanobotStatus: vi.fn().mockResolvedValue({ ready: true, port: 8900 }),
  getNanobotToken: vi.fn().mockReturnValue('token'),
  refreshNanobotAuth: vi.fn(),
}));

import { useScheduleStore } from './scheduleStore';

function reminderTask(): ScheduledTask {
  const completedAt = Date.now();
  return {
    id: 'once-reminder',
    name: 'A股开市提醒',
    prompt: '提醒我关注A股开市',
    schedule: { frequency: 'once', at: '2026-08-26T05:10:00Z' },
    status: 'completed',
    createdAt: completedAt - 10_000,
    updatedAt: completedAt,
    totalRuns: 1,
    runs: [{
      id: 'reminder-run',
      runId: 'reminder-run',
      scheduledTaskId: 'once-reminder',
      resultType: 'none',
      conversationAvailable: false,
      startedAt: completedAt - 1_000,
      completedAt,
      status: 'completed',
    }],
  };
}

describe('scheduleStore synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useScheduleStore.setState({
      tasks: {},
      loading: false,
      error: null,
      activeRunDetail: null,
    });
  });

  it('ignores a stale poll that returns after a reminder was confirmed and deleted', async () => {
    const task = reminderTask();
    let resolvePoll!: (payload: ScheduleTasksPayload) => void;
    mocks.fetchScheduleTasks.mockReturnValue(new Promise<ScheduleTasksPayload>((resolve) => {
      resolvePoll = resolve;
    }));
    mocks.markScheduleRunViewed.mockResolvedValue({ tasks: [] });
    useScheduleStore.setState({ tasks: { [task.id]: task } });

    const stalePoll = useScheduleStore.getState().loadTasks();
    await vi.waitFor(() => expect(mocks.fetchScheduleTasks).toHaveBeenCalledOnce());

    await useScheduleStore.getState().markRunViewed(task.id, task.runs[0]);
    expect(useScheduleStore.getState().tasks).toEqual({});

    resolvePoll({ tasks: [task] });
    await stalePoll;

    expect(useScheduleStore.getState().tasks).toEqual({});
  });
});
