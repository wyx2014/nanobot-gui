import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawn = vi.fn();
const execFile = vi.fn((_file: string, _args: string[], callback: (error: Error | null, stdout: string) => void) => callback(null, ''));
const existsSync = vi.fn(() => true);
const mkdirSync = vi.fn();
const fetchMock = vi.fn();
let appIsPackaged = false;

vi.mock('child_process', () => ({
  default: { spawn, execFile },
  spawn,
  execFile,
}));
vi.mock('fs', () => ({ default: { existsSync, mkdirSync }, existsSync, mkdirSync }));
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appIsPackaged;
    },
    getPath: vi.fn(() => '/tmp/tpcowork-test'),
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

function processStub(pid = 1234) {
  const child = new EventEmitter() as EventEmitter & {
    killed: boolean;
    exitCode: number | null;
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.killed = false;
  child.exitCode = null;
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => {
    child.killed = true;
    child.exitCode = 0;
    queueMicrotask(() => child.emit('exit', child.exitCode, 'SIGTERM'));
    return true;
  });
  return child;
}

function exitProcess(child: ReturnType<typeof processStub>, code: number): void {
  child.exitCode = code;
  child.emit('exit', code, null);
}

describe('PythonBridge lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    appIsPackaged = false;
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

  it('accepts the authenticated gateway while the agent loop is still warming', async () => {
    const child = processStub();
    spawn.mockReturnValue(child);
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: vi.fn().mockResolvedValue(null),
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ agent_ready: false }),
      });
    const { PythonBridge } = await import('./pythonBridge');
    const bridge = new PythonBridge();

    await bridge.start();

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(bridge.isReady).toBe(true);
  });

  it('detects an early child exit and starts a new process instead of waiting for timeout', async () => {
    vi.useFakeTimers();
    try {
      const firstChild = processStub(1001);
      const secondChild = processStub(1002);
      fetchMock.mockRejectedValue(new Error('gateway unavailable'));
      spawn
        .mockReturnValueOnce(firstChild)
        .mockImplementationOnce(() => {
          fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: vi.fn().mockResolvedValue({ agent_ready: true }),
          });
          return secondChild;
        });
      const { PythonBridge } = await import('./pythonBridge');
      const bridge = new PythonBridge();

      const starting = bridge.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(spawn).toHaveBeenCalledTimes(1);

      exitProcess(firstChild, 1);
      await vi.advanceTimersByTimeAsync(2999);
      expect(spawn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await starting;

      expect(spawn).toHaveBeenCalledTimes(2);
      expect(bridge.isReady).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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
      NANOBOT_DESKTOP_GATEWAY: '1',
    });
  });

  it('stops a timed-out child before retrying startup', async () => {
    vi.useFakeTimers();
    try {
      const firstChild = processStub(2001);
      const secondChild = processStub(2002);
      fetchMock.mockRejectedValue(new Error('gateway unavailable'));
      spawn.mockReturnValueOnce(firstChild).mockImplementationOnce(() => {
        expect(firstChild.kill).toHaveBeenCalledWith('SIGTERM');
        fetchMock.mockResolvedValue({ ok: true, status: 200 });
        return secondChild;
      });
      const { PythonBridge } = await import('./pythonBridge');
      const bridge = new PythonBridge();
      const failed = expect(bridge.start()).rejects.toThrow('did not become ready');
      await vi.advanceTimersByTimeAsync(31_000);
      await failed;
      expect(firstChild.killed).toBe(false);

      const retry = bridge.start();
      await vi.advanceTimersByTimeAsync(0);
      await retry;
      expect(spawn).toHaveBeenCalledTimes(2);
      expect(bridge.isReady).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes built-in MCP credentials only to the nanobot child process', async () => {
    const previous = {
      JUYUAN_MCP_TOKEN: process.env.JUYUAN_MCP_TOKEN,
      CAIHUI_MCP_API_KEY: process.env.CAIHUI_MCP_API_KEY,
      IFIND_MCP_API_KEY: process.env.IFIND_MCP_API_KEY,
      ANYSEARCH_API_KEY: process.env.ANYSEARCH_API_KEY,
    };
    Object.assign(process.env, {
      JUYUAN_MCP_TOKEN: 'juyuan-shared',
      CAIHUI_MCP_API_KEY: 'caihui-shared',
      IFIND_MCP_API_KEY: 'ifind-shared',
      ANYSEARCH_API_KEY: 'anysearch-shared',
    });
    try {
      const child = processStub();
      spawn.mockReturnValue(child);
      const { PythonBridge } = await import('./pythonBridge');
      const bridge = new PythonBridge();

      await bridge.start();

      expect(spawn.mock.calls[0][2]?.env).toMatchObject({
        JUYUAN_MCP_TOKEN: 'juyuan-shared',
        CAIHUI_MCP_API_KEY: 'caihui-shared',
        IFIND_MCP_API_KEY: 'ifind-shared',
        ANYSEARCH_API_KEY: 'anysearch-shared',
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('passes the managed image extraction service to the nanobot child process', async () => {
    const previous = {
      NANOBOT_IMAGE_EXTRACT_API_URL: process.env.NANOBOT_IMAGE_EXTRACT_API_URL,
      NANOBOT_IMAGE_EXTRACT_API_KEY: process.env.NANOBOT_IMAGE_EXTRACT_API_KEY,
      NANOBOT_IMAGE_EXTRACT_MODEL: process.env.NANOBOT_IMAGE_EXTRACT_MODEL,
    };
    Object.assign(process.env, {
      NANOBOT_IMAGE_EXTRACT_API_URL: 'http://vision.example/v1/chat/completions',
      NANOBOT_IMAGE_EXTRACT_API_KEY: 'managed-key',
      NANOBOT_IMAGE_EXTRACT_MODEL: 'qwen-vl',
    });
    try {
      const child = processStub();
      spawn.mockReturnValue(child);
      const { PythonBridge } = await import('./pythonBridge');
      const bridge = new PythonBridge();

      await bridge.start();

      expect(spawn.mock.calls[0][2]?.env).toMatchObject({
        NANOBOT_IMAGE_EXTRACT_API_URL: 'http://vision.example/v1/chat/completions',
        NANOBOT_IMAGE_EXTRACT_API_KEY: 'managed-key',
        NANOBOT_IMAGE_EXTRACT_MODEL: 'qwen-vl',
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('uses the precompiled installed wheel in packaged apps', async () => {
    appIsPackaged = true;
    const previousPythonPath = process.env.PYTHONPATH;
    const previousResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
    process.env.PYTHONPATH = '/tmp/parent-python-path';
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: '/tmp/resources',
    });
    try {
      const child = processStub();
      spawn.mockReturnValue(child);
      const { PythonBridge } = await import('./pythonBridge');
      const bridge = new PythonBridge();

      await bridge.start();

      expect(spawn.mock.calls[0][2]).toMatchObject({
        cwd: '/tmp/tpcowork-test/workspace',
      });
      expect(spawn.mock.calls[0][2]?.env?.PYTHONPATH).toBeUndefined();
      expect(spawn.mock.calls[0][2]?.env?.NANOBOT_NODE_BIN).toBe('/tmp/resources/node/bin/node');
      expect(spawn.mock.calls[0][0]).toBe('/tmp/resources/python/bin/python3');
    } finally {
      if (previousPythonPath === undefined) delete process.env.PYTHONPATH;
      else process.env.PYTHONPATH = previousPythonPath;
      if (previousResourcesPath) {
        Object.defineProperty(process, 'resourcesPath', previousResourcesPath);
      } else {
        delete (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
      }
    }
  });
});
