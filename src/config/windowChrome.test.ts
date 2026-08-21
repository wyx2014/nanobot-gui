import { describe, expect, it } from 'vitest';
import {
  MACOS_TITLE_BAR_HEIGHT,
  rendererTitlebarSafeTop,
  WINDOWS_TITLE_BAR_HEIGHT,
} from './windowChrome';

describe('renderer window chrome safe area', () => {
  it('matches the native window chrome dimensions', () => {
    expect(MACOS_TITLE_BAR_HEIGHT).toBe(48);
    expect(WINDOWS_TITLE_BAR_HEIGHT).toBe(36);
  });

  it('reserves the Windows caption row and leaves other platforms unchanged', () => {
    expect(rendererTitlebarSafeTop('windows')).toBe(36);
    expect(rendererTitlebarSafeTop('win32')).toBe(36);
    expect(rendererTitlebarSafeTop('macos')).toBe(0);
    expect(rendererTitlebarSafeTop('linux')).toBe(0);
  });
});
