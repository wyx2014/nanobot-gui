import { describe, expect, it } from 'vitest';
import {
  getMainWindowChrome,
  LINUX_TITLE_BAR_DARK,
  LINUX_TITLE_BAR_HEIGHT,
  LINUX_TITLE_BAR_LIGHT,
  MACOS_TITLE_BAR_HEIGHT,
  MAIN_WINDOW_BACKGROUND,
  MAIN_WINDOW_BOUNDS,
  WINDOWS_TITLE_BAR_DARK,
  WINDOWS_TITLE_BAR_HEIGHT,
  WINDOWS_TITLE_BAR_LIGHT,
} from './mainWindowConfig';

describe('main window bounds', () => {
  it('matches the OpenWorker desktop window contract', () => {
    expect(MAIN_WINDOW_BOUNDS).toEqual({
      width: 1360,
      height: 900,
      minWidth: 980,
      minHeight: 640,
    });
  });

  it('is immutable so runtime setup cannot drift from the tested contract', () => {
    expect(Object.isFrozen(MAIN_WINDOW_BOUNDS)).toBe(true);
  });
});

describe('main window chrome', () => {
  it('uses a full-size hidden title bar aligned with macOS traffic lights', () => {
    expect(MACOS_TITLE_BAR_HEIGHT).toBe(48);
    expect(MAIN_WINDOW_BACKGROUND).toBe('#fbfaf7');
    expect(getMainWindowChrome('darwin')).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: { height: 48 },
      trafficLightPosition: { x: 16, y: 17 },
    });
  });

  it('uses a Codex-style overlay that keeps native window buttons on Windows', () => {
    expect(WINDOWS_TITLE_BAR_HEIGHT).toBe(36);
    expect(WINDOWS_TITLE_BAR_LIGHT).toEqual({
      color: '#f7f6f2',
      symbolColor: '#29261b',
    });
    expect(WINDOWS_TITLE_BAR_DARK).toEqual({
      color: '#242424',
      symbolColor: '#f3f0e8',
    });
    expect(getMainWindowChrome('win32')).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#f7f6f2',
        symbolColor: '#29261b',
        height: 36,
      },
    });
  });

  it('uses a themed overlay while retaining native window buttons on Linux', () => {
    expect(LINUX_TITLE_BAR_HEIGHT).toBe(48);
    expect(LINUX_TITLE_BAR_LIGHT).toEqual({ color: '#fbfaf7' });
    expect(LINUX_TITLE_BAR_DARK).toEqual({ color: '#1f1f1f' });
    expect(getMainWindowChrome('linux')).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#fbfaf7',
        height: 48,
      },
    });
  });
});
