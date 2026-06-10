import { describe, it, expect, beforeEach } from 'vitest';
import { useScheduleStore, computeNextRunAt } from './scheduleStore';
import type { ScheduleConfig } from '../types/schedule';

describe('scheduleStore', () => {
  beforeEach(() => {
    useScheduleStore.setState({
      tasks: {},
      activeTaskId: null,
      selectedTaskId: null,
      showEditor: false,
      editingTaskId: null,
    });
  });

  // ── computeNextRunAt ──
  describe('computeNextRunAt', () => {
    it('returns undefined for paused tasks', () => {
      const config: ScheduleConfig = { frequency: 'daily', time: { hour: 9, minute: 0 } };
      expect(computeNextRunAt(config, 'paused')).toBeUndefined();
    });

    it('returns undefined for manual tasks', () => {
      const config: ScheduleConfig = { frequency: 'manual' };
      expect(computeNextRunAt(config, 'active')).toBeUndefined();
    });

    it('computes next hourly run', () => {
      const now = new Date(2026, 2, 2, 10, 15, 0).getTime(); // 10:15
      const config: ScheduleConfig = { frequency: 'hourly', time: { hour: 0, minute: 30 } };
      const next = computeNextRunAt(config, 'active', now)!;
      const nextDate = new Date(next);
      expect(nextDate.getMinutes()).toBe(30);
      expect(next).toBeGreaterThan(now);
    });

    it('computes next daily run', () => {
      const now = new Date(2026, 2, 2, 10, 0, 0).getTime(); // 10:00
      const config: ScheduleConfig = { frequency: 'daily', time: { hour: 9, minute: 0 } };
      const next = computeNextRunAt(config, 'active', now)!;
      // 9:00 has passed today, so next is tomorrow at 9:00
      const nextDate = new Date(next);
      expect(nextDate.getDate()).toBe(3);
      expect(nextDate.getHours()).toBe(9);
    });

    it('computes next daily run (same day, not yet passed)', () => {
      const now = new Date(2026, 2, 2, 8, 0, 0).getTime(); // 08:00
      const config: ScheduleConfig = { frequency: 'daily', time: { hour: 9, minute: 0 } };
      const next = computeNextRunAt(config, 'active', now)!;
      const nextDate = new Date(next);
      expect(nextDate.getDate()).toBe(2); // Same day
      expect(nextDate.getHours()).toBe(9);
    });

    it('computes next weekly run', () => {
      // 2026-03-02 is a Monday
      const now = new Date(2026, 2, 2, 10, 0, 0).getTime();
      const config: ScheduleConfig = { frequency: 'weekly', dayOfWeek: 3, time: { hour: 9, minute: 0 } }; // Wednesday
      const next = computeNextRunAt(config, 'active', now)!;
      const nextDate = new Date(next);
      expect(nextDate.getDay()).toBe(3); // Wednesday
    });

    it('computes next weekday run (skips weekends)', () => {
      // 2026-03-06 is a Friday
      const now = new Date(2026, 2, 6, 18, 0, 0).getTime(); // Friday 18:00
      const config: ScheduleConfig = { frequency: 'weekdays', time: { hour: 9, minute: 0 } };
      const next = computeNextRunAt(config, 'active', now)!;
      const nextDate = new Date(next);
      // Next weekday after Friday 18:00 → Monday
      expect(nextDate.getDay()).toBe(1); // Monday
    });
  });

  // ── createTask ──
  describe('createTask', () => {
    it('creates a task with correct fields', () => {
      const id = useScheduleStore.getState().createTask({
        name: 'Daily Report',
        prompt: 'Generate daily report',
        schedule: { frequency: 'daily', time: { hour: 9, minute: 0 } },
      });
      const task = useScheduleStore.getState().tasks[id];
      expect(task).toBeDefined();
      expect(task.name).toBe('Daily Report');
      expect(task.status).toBe('active');
      expect(task.runs).toHaveLength(0);
      expect(task.totalRuns).toBe(0);
      expect(task.nextRunAt).toBeDefined();
    });
  });

  // ── updateTask ──
  describe('updateTask', () => {
    it('updates task fields', () => {
      const id = useScheduleStore.getState().createTask({
        name: 'Old Name', prompt: 'test', schedule: { frequency: 'daily' },
      });
      useScheduleStore.getState().updateTask(id, { name: 'New Name', prompt: 'updated' });
      const task = useScheduleStore.getState().tasks[id];
      expect(task.name).toBe('New Name');
      expect(task.prompt).toBe('updated');
    });

    it('recalculates nextRunAt when schedule changes', () => {
      const id = useScheduleStore.getState().createTask({
        name: 'Task', prompt: 'test', schedule: { frequency: 'daily', time: { hour: 9, minute: 0 } },
      });
      const before = useScheduleStore.getState().tasks[id].nextRunAt;
      useScheduleStore.getState().updateTask(id, {
        schedule: { frequency: 'hourly', time: { hour: 0, minute: 30 } },
      });
      const after = useScheduleStore.getState().tasks[id].nextRunAt;
      // nextRunAt should change
      expect(after).not.toBe(before);
    });
  });

  // ── deleteTask ──
  describe('deleteTask', () => {
    it('removes a task', () => {
      const id = useScheduleStore.getState().createTask({
        name: 'Task', prompt: 'test', schedule: { frequency: 'manual' },
      });
      useScheduleStore.getState().deleteTask(id);
      expect(useScheduleStore.getState().tasks[id]).toBeUndefined();
    });

    it('clears activeTaskId if deleted', () => {
      const id = useScheduleStore.getState().createTask({
        name: 'Task', prompt: 'test', schedule: { frequency: 'manual' },
      });
      useScheduleStore.getState().setActiveTaskId(id);
      useScheduleStore.getState().deleteTask(id);
      expect(useScheduleStore.getState().activeTaskId).toBeNull();
    });
  });

  // ── pauseTask / resumeTask ──
  describe('pauseTask / resumeTask', () => {
    it('pauses and clears nextRunAt', () => {
      const id = useScheduleStore.getState().createTask({
        name: 'Task', prompt: 'test', schedule: { frequency: 'daily', time: { hour: 9, minute: 0 } },
      });
      useScheduleStore.getState().pauseTask(id);
      const task = useScheduleStore.getState().tasks[id];
      expect(task.status).toBe('paused');
      expect(task.nextRunAt).toBeUndefined();
    });

    it('resumes and recalculates nextRunAt', () => {
      const id = useScheduleStore.getState().createTask({
        name: 'Task', prompt: 'test', schedule: { frequency: 'daily', time: { hour: 9, minute: 0 } },
      });
      useScheduleStore.getState().pauseTask(id);
      useScheduleStore.getState().resumeTask(id);
      const task = useScheduleStore.getState().tasks[id];
      expect(task.status).toBe('active');
      expect(task.nextRunAt).toBeDefined();
    });
  });

  // ── Run tracking ──
  describe('run tracking', () => {
    it('starts a run', () => {
      const id = useScheduleStore.getState().createTask({
        name: 'Task', prompt: 'test', schedule: { frequency: 'manual' },
      });
      useScheduleStore.getState().startRun(id, 'conv1');
      const task = useScheduleStore.getState().tasks[id];
      expect(task.runs).toHaveLength(1);
      expect(task.runs[0].status).toBe('running');
      expect(task.runs[0].conversationId).toBe('conv1');
      expect(task.totalRuns).toBe(1);
      expect(task.lastRunAt).toBeDefined();
    });

    it('completes a run', () => {
      const id = useScheduleStore.getState().createTask({
        name: 'Task', prompt: 'test', schedule: { frequency: 'manual' },
      });
      const runId = useScheduleStore.getState().startRun(id, 'conv1');
      useScheduleStore.getState().completeRun(id, runId);
      const run = useScheduleStore.getState().tasks[id].runs[0];
      expect(run.status).toBe('completed');
      expect(run.completedAt).toBeDefined();
    });

    it('records error run', () => {
      const id = useScheduleStore.getState().createTask({
        name: 'Task', prompt: 'test', schedule: { frequency: 'manual' },
      });
      const runId = useScheduleStore.getState().startRun(id, 'conv1');
      useScheduleStore.getState().errorRun(id, runId, 'API failed');
      const run = useScheduleStore.getState().tasks[id].runs[0];
      expect(run.status).toBe('error');
      expect(run.error).toBe('API failed');
    });

    it('keeps max 20 runs', () => {
      const id = useScheduleStore.getState().createTask({
        name: 'Task', prompt: 'test', schedule: { frequency: 'manual' },
      });
      for (let i = 0; i < 25; i++) {
        useScheduleStore.getState().startRun(id, `conv${i}`);
      }
      expect(useScheduleStore.getState().tasks[id].runs.length).toBeLessThanOrEqual(20);
    });
  });

  // ── getDueTasks ──
  describe('getDueTasks', () => {
    it('returns tasks past their nextRunAt', () => {
      const id = useScheduleStore.getState().createTask({
        name: 'Task', prompt: 'test', schedule: { frequency: 'daily', time: { hour: 0, minute: 0 } },
      });
      // Force nextRunAt to past
      useScheduleStore.setState((state) => {
        state.tasks[id].nextRunAt = Date.now() - 1000;
      });
      const due = useScheduleStore.getState().getDueTasks(Date.now());
      expect(due.some((t) => t.id === id)).toBe(true);
    });

    it('excludes paused tasks', () => {
      const id = useScheduleStore.getState().createTask({
        name: 'Task', prompt: 'test', schedule: { frequency: 'daily', time: { hour: 0, minute: 0 } },
      });
      useScheduleStore.getState().pauseTask(id);
      const due = useScheduleStore.getState().getDueTasks(Date.now());
      expect(due.some((t) => t.id === id)).toBe(false);
    });
  });

  // ── getActiveTaskCount ──
  describe('getActiveTaskCount', () => {
    it('counts active tasks', () => {
      useScheduleStore.getState().createTask({
        name: 'A', prompt: 'test', schedule: { frequency: 'manual' },
      });
      const id2 = useScheduleStore.getState().createTask({
        name: 'B', prompt: 'test', schedule: { frequency: 'manual' },
      });
      useScheduleStore.getState().pauseTask(id2);
      expect(useScheduleStore.getState().getActiveTaskCount()).toBe(1);
    });
  });

  // ── UI state ──
  describe('UI state', () => {
    it('opens/closes editor', () => {
      useScheduleStore.getState().openEditor('task1');
      const state = useScheduleStore.getState();
      expect(state.showEditor).toBe(true);
      expect(state.editingTaskId).toBe('task1');
      useScheduleStore.getState().closeEditor();
      expect(useScheduleStore.getState().showEditor).toBe(false);
    });
  });
});
