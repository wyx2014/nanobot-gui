/**
 * Test helpers — platform mocking utilities
 */
import { vi } from 'vitest';
import * as platform from '../utils/platform';

/**
 * Override platform detection for tests.
 * Call in beforeEach or at the top of a describe block.
 * Returns a cleanup function.
 */
export function setPlatformForTest(os: 'macos' | 'windows' | 'linux') {
  const isWinSpy = vi.spyOn(platform, 'isWindows');
  const isMacSpy = vi.spyOn(platform, 'isMacOS');
  const getPlatSpy = vi.spyOn(platform, 'getPlatform');

  isWinSpy.mockReturnValue(os === 'windows');
  isMacSpy.mockReturnValue(os === 'macos');
  getPlatSpy.mockReturnValue(os);

  return () => {
    isWinSpy.mockRestore();
    isMacSpy.mockRestore();
    getPlatSpy.mockRestore();
  };
}
