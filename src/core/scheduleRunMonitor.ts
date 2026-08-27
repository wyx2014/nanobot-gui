import { format, getI18n } from '@/i18n';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useToastStore } from '@/stores/toastStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { ScheduledTask, ScheduledTaskRun } from '@/types/schedule';
import {
  notifyScheduledTaskCompleted,
  notifyScheduledTaskError,
} from '@/utils/notifications';

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_TRACKED_TERMINAL_RUNS = 2_048;

export interface ScheduleRunNotification {
  taskId: string;
  taskName: string;
  run: ScheduledTaskRun;
}

function runKey(task: ScheduledTask, run: ScheduledTaskRun): string {
  return `${task.id}:${run.runId?.trim() || run.id}`;
}

function isTerminalRun(run: ScheduledTaskRun): boolean {
  return run.status === 'completed' || run.status === 'error';
}

/** Tracks terminal run IDs so refreshes and reconnects cannot duplicate alerts. */
export class ScheduleRunNotificationTracker {
  private readonly terminalRunKeys = new Set<string>();
  private readonly terminalRunOrder: string[] = [];

  constructor(tasks: ScheduledTask[] = []) {
    this.remember(tasks, false);
  }

  consume(tasks: ScheduledTask[]): ScheduleRunNotification[] {
    return this.remember(tasks, true);
  }

  private remember(tasks: ScheduledTask[], collect: boolean): ScheduleRunNotification[] {
    const notifications: ScheduleRunNotification[] = [];
    for (const task of tasks) {
      for (const run of task.runs) {
        if (!isTerminalRun(run)) continue;
        const key = runKey(task, run);
        if (this.terminalRunKeys.has(key)) continue;
        this.terminalRunKeys.add(key);
        this.terminalRunOrder.push(key);
        if (collect) {
          notifications.push({ taskId: task.id, taskName: task.name, run });
        }
      }
    }

    while (this.terminalRunOrder.length > MAX_TRACKED_TERMINAL_RUNS) {
      const oldest = this.terminalRunOrder.shift();
      if (oldest) this.terminalRunKeys.delete(oldest);
    }
    return notifications;
  }
}

export function openScheduleRunNotification(taskId: string, runId: string): void {
  useScheduleStore.getState().openRunDetail(taskId, runId);
  useSettingsStore.getState().setViewMode('schedule');
}

function deliverRunNotification(notification: ScheduleRunNotification): void {
  const { taskId, taskName, run } = notification;
  const runId = run.runId?.trim() || run.id;
  const t = getI18n();
  const failed = run.status === 'error';
  const message = format(
    failed ? t.schedule.taskError : t.schedule.taskCompleted,
    { name: taskName },
  );

  useToastStore.getState().addToast({
    type: failed ? 'error' : 'success',
    title: t.schedule.title,
    message,
    duration: 8_000,
    onClick: () => openScheduleRunNotification(taskId, runId),
  });

  if (failed) {
    void notifyScheduledTaskError(taskName, taskId, runId);
  } else {
    void notifyScheduledTaskCompleted(taskName, taskId, runId);
  }
}

/**
 * Poll the local gateway as a delivery fallback. Cron execution remains fully
 * owned by nanobot; this only mirrors new terminal runs into desktop UI state.
 */
export function startScheduleRunMonitor(
  pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): () => void {
  let stopped = false;
  let pollInFlight = false;
  let tracker = useScheduleStore.getState().error
    ? null
    : new ScheduleRunNotificationTracker(
      Object.values(useScheduleStore.getState().tasks),
    );

  const poll = async () => {
    if (stopped || pollInFlight) return;
    pollInFlight = true;
    try {
      await useScheduleStore.getState().loadTasks();
      const state = useScheduleStore.getState();
      if (state.error) return;
      const tasks = Object.values(state.tasks);
      if (!tracker) {
        tracker = new ScheduleRunNotificationTracker(tasks);
        return;
      }
      tracker.consume(tasks).forEach(deliverRunNotification);
    } finally {
      pollInFlight = false;
    }
  };

  const intervalId = window.setInterval(() => {
    void poll();
  }, Math.max(500, pollIntervalMs));

  return () => {
    stopped = true;
    window.clearInterval(intervalId);
  };
}
