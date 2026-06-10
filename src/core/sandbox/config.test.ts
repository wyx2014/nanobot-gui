import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock platform module
let mockPlatform = 'macos';
vi.mock('@/utils/platform', () => ({
  isMacOS: () => mockPlatform === 'macos',
  isWindows: () => mockPlatform === 'windows',
}));

// Must import after mocks
import { isSandboxEnabled } from './config';
import { useSettingsStore } from '@/stores/settingsStore';

describe('sandbox/config', () => {
  beforeEach(() => {
    mockPlatform = 'macos';
    useSettingsStore.setState({ sandboxEnabled: true });
  });

  describe('isSandboxEnabled', () => {
    it('returns true on macOS when sandboxEnabled is true', () => {
      expect(isSandboxEnabled()).toBe(true);
    });

    it('returns false on macOS when sandboxEnabled is false', () => {
      useSettingsStore.setState({ sandboxEnabled: false });
      expect(isSandboxEnabled()).toBe(false);
    });

    it('returns false on Windows regardless of setting', () => {
      mockPlatform = 'windows';
      useSettingsStore.setState({ sandboxEnabled: true });
      expect(isSandboxEnabled()).toBe(false);
    });

    it('returns false on Linux regardless of setting', () => {
      mockPlatform = 'linux';
      useSettingsStore.setState({ sandboxEnabled: true });
      expect(isSandboxEnabled()).toBe(false);
    });
  });
});
