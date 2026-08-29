import { describe, expect, it } from 'vitest';
import {
  LINUX_TITLE_BAR_HEIGHT,
  MACOS_TITLE_BAR_HEIGHT,
  rendererTitlebarSafeTop,
  WINDOWS_TITLE_BAR_HEIGHT,
} from './windowChrome';

describe('renderer window chrome safe area', () => {
  it('matches the native window chrome dimensions', () => {
    expect(MACOS_TITLE_BAR_HEIGHT).toBe(48);
    expect(WINDOWS_TITLE_BAR_HEIGHT).toBe(36);
    expect(LINUX_TITLE_BAR_HEIGHT).toBe(48);
  });

  it('reserves caption rows that use native window-control overlays', () => {
    expect(rendererTitlebarSafeTop('windows')).toBe(36);
    expect(rendererTitlebarSafeTop('win32')).toBe(36);
    expect(rendererTitlebarSafeTop('macos')).toBe(0);
    expect(rendererTitlebarSafeTop('linux')).toBe(48);
  });
});
