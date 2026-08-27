/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Global test setup — mock all Tauri and external SDK modules
 */
import { vi, beforeEach } from 'vitest';

// Mock window.ipc for Electron environment in tests
const mockIpc = {
  invoke: vi.fn().mockImplementation(async (channel: string, data?: any) => {
    switch (channel) {
      case 'os:homeDir':
        return '/Users/testuser';
      case 'os:appDataDir':
        return '/Users/testuser/.ruyi';
      case 'os:desktopDir':
        return '/Users/testuser/Desktop';
      case 'os:documentDir':
        return '/Users/testuser/Documents';
      case 'os:downloadDir':
        return '/Users/testuser/Downloads';
      case 'os:platform':
        return 'darwin'; // maps to 'macos'
      case 'app:installationId':
        return 'test-installation';
      case 'os:resolve':
        return typeof data === 'string' ? data : data?.path || '';
      case 'os:resolveResource':
        return typeof data === 'string' ? data : data?.path || '';
      case 'fs:exists':
        return false;
      case 'fs:readTextFile':
        return '';
      case 'fs:readDir':
        return [];
      case 'fs:readFile':
        return new Uint8Array();
      case 'fs:lstat':
        return { isSymbolicLink: () => false, isDirectory: () => false, isFile: () => true, size: 0, mtimeMs: Date.now() };
      case 'dialog:open':
        return null;
      case 'dialog:save':
        return null;
      case 'clipboard:readText':
        return '';
      case 'nanobot:diagnostics':
        return {
          capturedAt: '2026-08-13T00:00:00.000Z',
          status: 'starting',
          ready: false,
          starting: true,
          port: 8900,
          pid: 1234,
          restartCount: 0,
          platform: 'win32/x64',
          packaged: true,
          pythonBin: 'C:\\TPCowork\\resources\\python\\python.exe',
          pythonExists: true,
          logPath: 'C:\\Users\\test\\AppData\\Roaming\\TPCowork\\nanobot.log',
          logExists: true,
          lastError: null,
          text: 'TPCowork diagnostics\nstatus=starting',
        };
      default:
        return undefined;
    }
  }),
  on: vi.fn().mockReturnValue(() => {}),
  send: vi.fn(),
};

// Expose to window and global
if (typeof window !== 'undefined') {
  (window as any).ipc = mockIpc;
}
(globalThis as any).window = globalThis.window || {};
(globalThis as any).window.ipc = mockIpc;

// ── Polyfill localStorage for happy-dom ──
// happy-dom may not fully implement the Storage API needed by Zustand persist
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage?.setItem) {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
  } as Storage;
}

// ── Reset localStorage before each test ──
beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // Fallback: no-op
  }
});
