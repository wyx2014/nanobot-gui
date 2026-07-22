import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawn = vi.fn();
const execFile = vi.fn((_file: string, _args: string[], callback: (error: Error | null, stdout: string) => void) => callback(null, ''));
const existsSync = vi.fn(() => true);
const mkdirSync = vi.fn();
const fetchMock = vi.fn();

vi.mock('child_process', () => ({
  default: { spawn, execFile },
  spawn,
  execFile,
}));
vi.mock('fs', () => ({ default: { existsSync, mkdirSync }, existsSync, mkdirSync }));
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/tparuyi-test'),
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

function processStub() {
  const child = new EventEmitter() as EventEmitter & {
    killed: boolean;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.killed = false;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => {
    child.killed = true;
    queueMicrotask(() => child.emit('exit', 0, 'SIGTERM'));
    return true;
  });
  return child;
}

describe('PythonBridge lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    existsSync.mockReturnValue(true);
    execFile.mockImplementation((_file, _args, callback) => callback(null, ''));
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ agent_ready: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('shares concurrent starts and passes the bootstrap secret to the gateway', async () => {
    const child = processStub();
    spawn.mockReturnValue(child);
    const { PythonBridge } = await import('./pythonBridge');
    const bridge = new PythonBridge();

    await Promise.all([bridge.start(), bridge.start()]);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(bridge.isReady).toBe(true);
    expect(bridge.tokenSecret).toHaveLength(64);
    expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining([
      '-m', 'nanobot', 'desktop-gateway', '--token-issue-secret', bridge.tokenSecret,
    ]));
  });

  it('stops the managed process and clears readiness', async () => {
    const child = processStub();
    spawn.mockReturnValue(child);
    const { PythonBridge } = await import('./pythonBridge');
    const bridge = new PythonBridge();
    await bridge.start();

    await bridge.stop();

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(bridge.isReady).toBe(false);
  });

  it('waits for the agent loop readiness contract instead of the HTTP port alone', async () => {
    const child = processStub();
    spawn.mockReturnValue(child);
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ agent_ready: false }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: vi.fn().mockResolvedValue(null),
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ agent_ready: true }),
      });
    const { PythonBridge } = await import('./pythonBridge');
    const bridge = new PythonBridge();

    await bridge.start();

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(bridge.isReady).toBe(true);
  });

  it('passes the authenticated desktop PDF renderer to nanobot', async () => {
    const child = processStub();
    spawn.mockReturnValue(child);
    const { PythonBridge } = await import('./pythonBridge');
    const bridge = new PythonBridge();
    bridge.setPdfRenderer('http://127.0.0.1:3210/render-pdf', 'render-secret');

    await bridge.start();

    expect(spawn.mock.calls[0][2]?.env).toMatchObject({
      NANOBOT_PDF_RENDER_URL: 'http://127.0.0.1:3210/render-pdf',
      NANOBOT_PDF_RENDER_TOKEN: 'render-secret',
    });
  });
});
