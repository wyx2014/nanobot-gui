import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  message?: string;
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
}

interface ToastActions {
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

export type ToastStore = ToastState & ToastActions;

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
}

// Track timeout IDs so we can clear them when toasts are manually removed
const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastStore>()(
  immer((set) => ({
    toasts: [],

    addToast: (toast) => {
      const id = generateId();
      const duration = toast.duration ?? 3000;

      set((state) => {
        state.toasts.push({ ...toast, id });
      });

      // Auto-remove after duration
      const timeoutId = setTimeout(() => {
        toastTimeouts.delete(id);
        set((state) => {
          state.toasts = state.toasts.filter((t) => t.id !== id);
        });
      }, duration);
      toastTimeouts.set(id, timeoutId);
    },

    removeToast: (id) => {
      // Clear the auto-remove timeout if toast is manually dismissed
      const timeoutId = toastTimeouts.get(id);
      if (timeoutId) {
        clearTimeout(timeoutId);
        toastTimeouts.delete(id);
      }
      set((state) => {
        state.toasts = state.toasts.filter((t) => t.id !== id);
      });
    },
  }))
);
