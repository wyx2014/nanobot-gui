import { useEffect, useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let activeModalBackdrops = 0;

function modalBackgroundPaused(): boolean {
  return activeModalBackdrops > 0;
}

function notifyModalStateChanged(): void {
  if (typeof document !== 'undefined') {
    document.body.classList.toggle('window-modal-open', modalBackgroundPaused());
  }
  listeners.forEach((listener) => listener());
}

function acquireModalBackgroundPause(): () => void {
  activeModalBackdrops += 1;
  notifyModalStateChanged();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeModalBackdrops = Math.max(0, activeModalBackdrops - 1);
    notifyModalStateChanged();
  };
}

export function useModalBackgroundPause(): void {
  useEffect(() => acquireModalBackgroundPause(), []);
}

export function useModalBackgroundPaused(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    modalBackgroundPaused,
    () => false,
  );
}

