import { describe, expect, it, vi } from 'vitest';
import {
  acquireSingleInstanceLock,
  restoreAndFocusWindow,
  type RestorableWindow,
  type SingleInstanceApp,
} from './singleInstance';

function createApp(lockGranted: boolean) {
  let secondInstanceListener: (() => void) | undefined;
  const app = {
    requestSingleInstanceLock: vi.fn(() => lockGranted),
    quit: vi.fn(),
    on: vi.fn((_event: 'second-instance', listener: () => void) => {
      secondInstanceListener = listener;
    }),
  } satisfies SingleInstanceApp;

  return {
    app,
    emitSecondInstance: () => secondInstanceListener?.(),
  };
}

describe('acquireSingleInstanceLock', () => {
  it('keeps the primary process and activates it on subsequent launches', () => {
    const { app, emitSecondInstance } = createApp(true);
    const activatePrimaryInstance = vi.fn();

    expect(acquireSingleInstanceLock(app, activatePrimaryInstance)).toBe(true);
    expect(app.quit).not.toHaveBeenCalled();
    expect(app.on).toHaveBeenCalledWith('second-instance', activatePrimaryInstance);

    emitSecondInstance();
    expect(activatePrimaryInstance).toHaveBeenCalledOnce();
  });

  it('quits a secondary process before registering startup listeners', () => {
    const { app } = createApp(false);

    expect(acquireSingleInstanceLock(app, vi.fn())).toBe(false);
    expect(app.quit).toHaveBeenCalledOnce();
    expect(app.on).not.toHaveBeenCalled();
  });
});

describe('restoreAndFocusWindow', () => {
  function createWindow({ minimized = false, destroyed = false } = {}) {
    return {
      isDestroyed: vi.fn(() => destroyed),
      isMinimized: vi.fn(() => minimized),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    } satisfies RestorableWindow;
  }

  it('shows and focuses the existing hidden window', () => {
    const window = createWindow();

    expect(restoreAndFocusWindow(window)).toBe(true);
    expect(window.restore).not.toHaveBeenCalled();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });

  it('restores a minimized window before focusing it', () => {
    const window = createWindow({ minimized: true });

    expect(restoreAndFocusWindow(window)).toBe(true);
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });

  it('does not interact with a destroyed window', () => {
    const window = createWindow({ destroyed: true });

    expect(restoreAndFocusWindow(window)).toBe(false);
    expect(window.show).not.toHaveBeenCalled();
    expect(window.focus).not.toHaveBeenCalled();
  });
});
