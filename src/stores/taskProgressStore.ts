import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { useShallow } from 'zustand/react/shallow';

/**
 * Task step representation for progress tracking
 */
export interface TaskStep {
  id: string;
  label: string;                    // e.g., "找到桌面发票文件夹"
  status: 'pending' | 'running' | 'completed' | 'error';
  progress?: { current: number; total: number };  // Optional progress for batch operations
  detail?: string;                  // Additional details
  completionMessage?: string;       // Friendly completion message
  toolCallIds?: string[];           // Associated tool call IDs
  startTime?: number;
  endTime?: number;
}

interface TaskProgressState {
  /** Current task steps */
  steps: TaskStep[];
  /** ID of the currently executing step */
  currentStepId: string | null;
  /** Whether we have parsed steps from AI response */
  hasSteps: boolean;
  /** Current conversation ID for this task */
  conversationId: string | null;
}

interface TaskProgressActions {
  /** Set all steps (typically from AI response parsing) */
  setSteps: (steps: TaskStep[], conversationId: string) => void;
  /** Add a single step */
  addStep: (step: TaskStep) => void;
  /** Update a specific step */
  updateStep: (id: string, updates: Partial<TaskStep>) => void;
  /** Set the current step */
  setCurrentStep: (id: string | null) => void;
  /** Mark a step as running */
  startStep: (id: string) => void;
  /** Mark a step as completed */
  completeStep: (id: string, completionMessage?: string) => void;
  /** Mark a step as error */
  errorStep: (id: string, errorMessage?: string) => void;
  /** Update step progress */
  updateStepProgress: (id: string, current: number, total: number) => void;
  /** Associate tool call IDs with a step */
  linkToolCall: (stepId: string, toolCallId: string) => void;
  /** Find step by tool call ID */
  findStepByToolCallId: (toolCallId: string) => TaskStep | undefined;
  /** Clear all steps */
  clearSteps: () => void;
}

export type TaskProgressStore = TaskProgressState & TaskProgressActions;

export const useTaskProgressStore = create<TaskProgressStore>()(
  immer((set, get) => ({
    steps: [],
    currentStepId: null,
    hasSteps: false,
    conversationId: null,

    setSteps: (steps, conversationId) => {
      set((state) => {
        state.steps = steps;
        state.hasSteps = steps.length > 0;
        state.conversationId = conversationId;
        state.currentStepId = null;
      });
    },

    addStep: (step) => {
      set((state) => {
        state.steps.push(step);
        state.hasSteps = true;
      });
    },

    updateStep: (id, updates) => {
      set((state) => {
        const step = state.steps.find((s) => s.id === id);
        if (step) {
          Object.assign(step, updates);
        }
      });
    },

    setCurrentStep: (id) => {
      set((state) => {
        state.currentStepId = id;
      });
    },

    startStep: (id) => {
      set((state) => {
        const step = state.steps.find((s) => s.id === id);
        if (step) {
          step.status = 'running';
          step.startTime = Date.now();
        }
        state.currentStepId = id;
      });
    },

    completeStep: (id, completionMessage) => {
      set((state) => {
        const step = state.steps.find((s) => s.id === id);
        if (step) {
          step.status = 'completed';
          step.endTime = Date.now();
          if (completionMessage) {
            step.completionMessage = completionMessage;
          }
        }
        // Move to next pending step
        const nextPending = state.steps.find((s) => s.status === 'pending');
        state.currentStepId = nextPending?.id ?? null;
      });
    },

    errorStep: (id, errorMessage) => {
      set((state) => {
        const step = state.steps.find((s) => s.id === id);
        if (step) {
          step.status = 'error';
          step.endTime = Date.now();
          if (errorMessage) {
            step.detail = errorMessage;
          }
        }
      });
    },

    updateStepProgress: (id, current, total) => {
      set((state) => {
        const step = state.steps.find((s) => s.id === id);
        if (step) {
          step.progress = { current, total };
        }
      });
    },

    linkToolCall: (stepId, toolCallId) => {
      set((state) => {
        const step = state.steps.find((s) => s.id === stepId);
        if (step) {
          if (!step.toolCallIds) {
            step.toolCallIds = [];
          }
          if (!step.toolCallIds.includes(toolCallId)) {
            step.toolCallIds.push(toolCallId);
          }
        }
      });
    },

    findStepByToolCallId: (toolCallId) => {
      const state = get();
      return state.steps.find((s) => s.toolCallIds?.includes(toolCallId));
    },

    clearSteps: () => {
      set((state) => {
        state.steps = [];
        state.currentStepId = null;
        state.hasSteps = false;
        state.conversationId = null;
      });
    },
  }))
);

/**
 * Helper: Get overall progress
 * Uses useShallow to prevent infinite re-renders when returning objects
 */
export function useTaskProgress() {
  return useTaskProgressStore(
    useShallow((s) => {
      const total = s.steps.length;
      const completed = s.steps.filter((step) => step.status === 'completed').length;
      const running = s.steps.filter((step) => step.status === 'running').length;
      const errors = s.steps.filter((step) => step.status === 'error').length;

      return {
        total,
        completed,
        running,
        errors,
        hasSteps: s.hasSteps,
        isComplete: total > 0 && completed === total,
        progress: total > 0 ? completed / total : 0,
      };
    })
  );
}
