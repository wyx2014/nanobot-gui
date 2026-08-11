export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  on(event: 'second-instance', listener: () => void): unknown;
}

export interface RestorableWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

/**
 * Keep desktop startup single-instance. A secondary process exits before it
 * can initialise runtime services and asks the primary process to surface its
 * existing window instead.
 */
export function acquireSingleInstanceLock(
  app: SingleInstanceApp,
  activatePrimaryInstance: () => void,
): boolean {
  const isPrimaryInstance = app.requestSingleInstanceLock();
  if (!isPrimaryInstance) {
    app.quit();
    return false;
  }

  app.on('second-instance', activatePrimaryInstance);
  return true;
}

/** Restore a hidden/minimised primary window without creating another one. */
export function restoreAndFocusWindow(window: RestorableWindow | null): boolean {
  if (!window || window.isDestroyed()) return false;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return true;
}
