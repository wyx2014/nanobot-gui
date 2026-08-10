import { describe, expect, it } from 'vitest';
import {
  getMainWindowChrome,
  MACOS_TITLE_BAR_HEIGHT,
  MAIN_WINDOW_BACKGROUND,
  MAIN_WINDOW_BOUNDS,
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

  it('keeps native window chrome on Windows and Linux', () => {
    expect(getMainWindowChrome('win32')).toEqual({});
    expect(getMainWindowChrome('linux')).toEqual({});
  });
});
