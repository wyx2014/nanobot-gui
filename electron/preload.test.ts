import { beforeEach, describe, expect, it, vi } from 'vitest';

const exposeInMainWorld = vi.fn();
const send = vi.fn();
const invoke = vi.fn();
const on = vi.fn();
const removeListener = vi.fn();
const getPathForFile = vi.fn();

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { send, invoke, on, removeListener },
  webUtils: { getPathForFile },
}));
vi.mock('@electron-toolkit/preload', () => ({ electronAPI: { platform: 'test' } }));

describe('preload IPC bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true });
  });

  it('exposes a narrow invoke/send/on interface and unsubscribes the exact listener', async () => {
    await import('./preload');
    const ipcBridge = exposeInMainWorld.mock.calls.find(([name]) => name === 'ipc')?.[1] as {
      send(channel: string, data: unknown): void;
      invoke(channel: string, data?: unknown): Promise<unknown>;
      on(channel: string, listener: (...args: unknown[]) => void): () => void;
    };
    const listener = vi.fn();

    ipcBridge.send('nanobot:status', { requestId: '1' });
    ipcBridge.invoke('nanobot:request', { path: '/health' });
    const unsubscribe = ipcBridge.on('event:nanobot-error', listener);
    const registered = on.mock.calls[0][1];
    registered({ sender: 'main' }, 'gateway unavailable');
    unsubscribe();

    expect(send).toHaveBeenCalledWith('nanobot:status', { requestId: '1' });
    expect(invoke).toHaveBeenCalledWith('nanobot:request', { path: '/health' });
    expect(listener).toHaveBeenCalledWith('gateway unavailable');
    expect(removeListener).toHaveBeenCalledWith('event:nanobot-error', registered);
  });

  it('exposes Electron’s supported absolute-path resolver for dropped files', async () => {
    getPathForFile.mockReturnValue('C:\\Users\\alice\\Desktop\\report.xlsx');
    await import('./preload');
    const desktopApi = exposeInMainWorld.mock.calls.find(([name]) => name === 'api')?.[1] as {
      getPathForFile(file: File): string;
    };
    const file = new File(['report'], 'report.xlsx');

    expect(desktopApi.getPathForFile(file)).toBe('C:\\Users\\alice\\Desktop\\report.xlsx');
    expect(getPathForFile).toHaveBeenCalledWith(file);
  });
});
