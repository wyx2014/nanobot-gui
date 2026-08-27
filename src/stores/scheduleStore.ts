import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  createScheduleTask,
  deleteScheduleRun,
  deleteScheduleTask,
  fetchScheduleTasks,
  markScheduleRunViewed,
  pauseScheduleTask,
  resumeScheduleTask,
  runScheduleTaskNow,
  updateScheduleTask,
} from '@/core/api';
import {
  bootstrapNanobotGateway,
  getNanobotStatus,
  getNanobotToken,
  refreshNanobotAuth,
} from '@/core/nanobotClient';
import type { ScheduleTasksPayload } from '@/core/types';
import type {
  ScheduledTask,
  ScheduleConfig,
  ScheduleTaskDraft,
  ScheduledTaskRun,
} from '../types/schedule';

function runKey(run: ScheduledTaskRun): string {
  return run.runId?.trim() || run.id;
}

function tasksById(
  tasks: ScheduledTask[],
  current: Record<string, ScheduledTask> = {},
): Record<string, ScheduledTask> {
  return Object.fromEntries(tasks.map((task) => {
    const currentRuns = new Map(
      (current[task.id]?.runs ?? []).map((run) => [runKey(run), run]),
    );
    const runs = task.runs.map((run) => {
      const viewedAt = currentRuns.get(runKey(run))?.viewedAt;
      return viewedAt && !run.viewedAt ? { ...run, viewedAt } : run;
    });
    return [task.id, { ...task, runs }];
  }));
}

let scheduleMutationRevision = 0;

async function gatewayAuth(): Promise<{ token: string; baseUrl: string }> {
  let token = getNanobotToken();
  let status = await getNanobotStatus();
  if (!token) {
    await bootstrapNanobotGateway();
    token = getNanobotToken();
    status = await getNanobotStatus();
  }
  if (!status.ready || !token) {
    throw new Error('TP Cowork 服务还没有准备好。');
  }
  return { token, baseUrl: `http://127.0.0.1:${status.port}` };
}

async function withScheduleAuth<T>(
  task: (token: string, baseUrl: string) => Promise<T>,
): Promise<T> {
  const auth = await gatewayAuth();
  try {
    return await task(auth.token, auth.baseUrl);
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('Unauthorized')) {
      throw err;
    }
    const refreshed = await refreshNanobotAuth();
    return await task(refreshed.token, refreshed.baseUrl);
  }
}

interface ScheduleState {
  tasks: Record<string, ScheduledTask>;
  loading: boolean;
  error: string | null;
  activeTaskId: string | null;
  selectedTaskId: string | null;
  showEditor: boolean;
  editingTaskId: string | null;
  editorDraft: ScheduleTaskDraft | null;
  activeRunDetail: { taskId: string; runId: string } | null;
}

interface ScheduleActions {
  loadTasks: () => Promise<void>;
  applyPayload: (payload: ScheduleTasksPayload) => void;
  createTask: (data: ScheduleTaskDraft) => Promise<string>;
  updateTask: (
    id: string,
    data: {
      name: string;
      description?: string;
      prompt: string;
      schedule: ScheduleConfig;
      skillName?: string;
      workspacePath?: string;
    },
  ) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  pauseTask: (id: string) => Promise<void>;
  resumeTask: (id: string) => Promise<void>;
  runTaskNow: (id: string) => Promise<void>;
  getActiveTaskCount: () => number;
  getUnviewedRunCount: () => number;
  markRunViewed: (taskId: string, run: ScheduledTaskRun) => Promise<void>;
  deleteRun: (taskId: string, run: ScheduledTaskRun) => Promise<void>;
  setActiveTaskId: (id: string | null) => void;
  setSelectedTaskId: (id: string | null) => void;
  openEditor: (taskId?: string, draft?: ScheduleTaskDraft) => void;
  closeEditor: () => void;
  openRunDetail: (taskId: string, runId: string) => void;
  closeRunDetail: () => void;
}

export type ScheduleStore = ScheduleState & ScheduleActions;

export const useScheduleStore = create<ScheduleStore>()(
  immer((set, get) => ({
    tasks: {},
    loading: false,
    error: null,
    activeTaskId: null,
    selectedTaskId: null,
    showEditor: false,
    editingTaskId: null,
    editorDraft: null,
    activeRunDetail: null,

    applyPayload: (payload) => {
      set((state) => {
        // A viewed run is monotonic. Keep it when an older poll response races
        // with the mark-viewed mutation that archived a one-time reminder.
        state.tasks = tasksById(payload.tasks, state.tasks);
        state.error = null;
        if (state.selectedTaskId && !state.tasks[state.selectedTaskId]) {
          state.selectedTaskId = null;
        }
        if (state.activeTaskId && !state.tasks[state.activeTaskId]) {
          state.activeTaskId = null;
        }
        if (state.activeRunDetail) {
          const task = state.tasks[state.activeRunDetail.taskId];
          const hasRun = task?.runs.some((run) => (
            (run.runId?.trim() || run.id) === state.activeRunDetail?.runId
          ));
          if (!hasRun) state.activeRunDetail = null;
        }
      });
    },

    loadTasks: async () => {
      const mutationRevisionAtStart = scheduleMutationRevision;
      set((state) => {
        state.loading = true;
        state.error = null;
      });
      try {
        const payload = await withScheduleAuth((token, baseUrl) => fetchScheduleTasks(token, baseUrl));
        if (mutationRevisionAtStart === scheduleMutationRevision) {
          get().applyPayload(payload);
        }
      } catch (err) {
        set((state) => {
          state.error = err instanceof Error ? err.message : String(err);
        });
      } finally {
        set((state) => {
          state.loading = false;
        });
      }
    },

    createTask: async (data) => {
      const payload = await withScheduleAuth((token, baseUrl) => createScheduleTask(token, data, baseUrl));
      scheduleMutationRevision += 1;
      get().applyPayload(payload);
      const created = payload.tasks.find((task) => task.name === data.name && task.prompt === data.prompt);
      return created?.id ?? '';
    },

    updateTask: async (id, data) => {
      const payload = await withScheduleAuth((token, baseUrl) => updateScheduleTask(token, id, data, baseUrl));
      scheduleMutationRevision += 1;
      get().applyPayload(payload);
    },

    deleteTask: async (id) => {
      const payload = await withScheduleAuth((token, baseUrl) => deleteScheduleTask(token, id, baseUrl));
      scheduleMutationRevision += 1;
      get().applyPayload(payload);
    },

    pauseTask: async (id) => {
      const payload = await withScheduleAuth((token, baseUrl) => pauseScheduleTask(token, id, baseUrl));
      scheduleMutationRevision += 1;
      get().applyPayload(payload);
    },

    resumeTask: async (id) => {
      const payload = await withScheduleAuth((token, baseUrl) => resumeScheduleTask(token, id, baseUrl));
      scheduleMutationRevision += 1;
      get().applyPayload(payload);
    },

    runTaskNow: async (id) => {
      const payload = await withScheduleAuth((token, baseUrl) => runScheduleTaskNow(token, id, baseUrl));
      scheduleMutationRevision += 1;
      get().applyPayload(payload);
    },

    getActiveTaskCount: () => Object.values(get().tasks).filter((task) => task.status === 'active').length,

    getUnviewedRunCount: () => Object.values(get().tasks).reduce((count, task) => (
      count + task.runs.filter((run) => (
        (run.status === 'completed' || run.status === 'error')
        && !run.viewedAt
      )).length
    ), 0),

    markRunViewed: async (taskId, run) => {
      const runId = run.runId ?? run.id;
      if (!runId || run.status === 'running' || run.viewedAt) return;
      const payload = await withScheduleAuth((token, baseUrl) => markScheduleRunViewed(token, taskId, runId, baseUrl));
      scheduleMutationRevision += 1;
      get().applyPayload(payload);
    },

    deleteRun: async (taskId, run) => {
      const runId = run.runId ?? run.id;
      if (!runId || run.status === 'running') return;
      const payload = await withScheduleAuth((token, baseUrl) => deleteScheduleRun(token, taskId, runId, baseUrl));
      scheduleMutationRevision += 1;
      get().applyPayload(payload);
    },

    setActiveTaskId: (id) => {
      set((state) => {
        state.activeTaskId = id;
      });
    },

    setSelectedTaskId: (id) => {
      set((state) => {
        state.selectedTaskId = id;
      });
    },

    openEditor: (taskId, draft) => {
      set((state) => {
        state.showEditor = true;
        state.editingTaskId = taskId ?? null;
        state.editorDraft = taskId ? null : draft ?? null;
      });
    },

    closeEditor: () => {
      set((state) => {
        state.showEditor = false;
        state.editingTaskId = null;
        state.editorDraft = null;
      });
    },

    openRunDetail: (taskId, runId) => {
      set((state) => {
        state.activeRunDetail = { taskId, runId };
      });
    },

    closeRunDetail: () => {
      set((state) => {
        state.activeRunDetail = null;
      });
    },
  })),
);
