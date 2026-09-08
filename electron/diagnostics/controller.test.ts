// @vitest-environment node
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDiagnosticExporter } from './controller';
import type { PythonBridge } from '../pythonBridge';
import type { OperationalLog } from '../operationalLog';
import * as operational from '../operationalLog';

const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showSaveDialog: vi.fn(), worker: vi.fn(), directory: '', message: vi.fn() }));
vi.mock('electron', () => ({
  app: { getPath: () => mocks.directory, getVersion: () => 'test', isPackaged: false },
  BrowserWindow: {}, dialog: { showSaveDialog: mocks.showSaveDialog, showMessageBox: mocks.message },
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler) },
  shell: { showItemInFolder: vi.fn() },
}));
vi.mock('./exportWorker?nodeWorker', () => ({ default: mocks.worker }));
afterEach(async () => { if (mocks.directory) await rm(mocks.directory, { recursive: true, force: true }); vi.clearAllMocks(); });

async function setup() {
  mocks.directory = await mkdtemp(path.join(os.tmpdir(), 'diagnostic-controller-'));
  const destination = path.join(mocks.directory, 'selected.zip');
  await writeFile(destination, 'existing user file');
  mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination });
  const sender = { mainFrame: {}, isDestroyed: () => false, send: vi.fn() };
  const window = { webContents: sender };
  const controller = createDiagnosticExporter(() => window as never,
    { port: 8900, tokenSecret: 'secret', isReady: false, getOperationalSnapshot: () => ({ ready: false }) } as unknown as PythonBridge,
    { flush: async () => {} } as OperationalLog);
  const request = { export_id: 'export_00000000-0000-4000-8000-000000000000', description: 'problem',
    occurred_at: new Date().toISOString(), window_minutes: 15, scope: 'application', arbitraryPath: '/etc' };
  return { controller, destination, request, event: { sender, senderFrame: sender.mainFrame } };
}

describe('diagnostic export controller', () => {
  it('records the terminal failure of the exporter without exposing exception text', async () => {
    const { request, event } = await setup();
    const record = vi.spyOn(operational, 'recordMainDiagnostic');
    try {
      mocks.worker.mockImplementation(() => { throw new Error('private worker exception'); });
      const result = await mocks.handlers.get('diagnostics:export')!(event, request);
      expect(result).toMatchObject({ status: 'failed', error_code: 'EXPORT_FAILED' });
      expect(record.mock.calls.map(([event]) => event.status)).toEqual(['started', 'failed']);
      expect(JSON.stringify(record.mock.calls)).not.toContain('private worker exception');
    } finally { record.mockRestore(); }
  });
  it('opens the shared renderer dialog from the native Help menu', async () => {
    const { controller, event } = await setup();
    const pending = controller.exportNative();
    expect(event.sender.send).toHaveBeenCalledWith('diagnostics:open-dialog', expect.any(String));
    const id = event.sender.send.mock.calls[0][1];
    await mocks.handlers.get('diagnostics:dialog-opened')!(event, id);
    await pending;
    expect(mocks.showSaveDialog).not.toHaveBeenCalled();
  });

  it('falls back to native save UI when the renderer does not respond', async () => {
    const { controller } = await setup();
    mocks.showSaveDialog.mockResolvedValue({ canceled: true });
    vi.useFakeTimers();
    try {
      const pending = controller.exportNative();
      await vi.advanceTimersByTimeAsync(1500);
      await pending;
      expect(mocks.showSaveDialog).toHaveBeenCalledOnce();
      expect(mocks.worker).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('rejects foreign senders before showing a save dialog', async () => {
    const { request } = await setup();
    const result = await mocks.handlers.get('diagnostics:export')!({ sender: {}, senderFrame: {} }, request);
    expect(result).toEqual({ status: 'failed', error_code: 'UNTRUSTED_SENDER' });
    expect(mocks.showSaveDialog).not.toHaveBeenCalled();
  });

  it('cleans partial output on cancellation and preserves an existing destination', async () => {
    const { request, event, destination, controller } = await setup();
    let entered!: () => void;
    const written = new Promise<void>((resolve) => { entered = resolve; });
    mocks.worker.mockImplementation(({ workerData }) => {
      const worker = new EventEmitter() as EventEmitter & { terminate: () => Promise<number> };
      worker.terminate = async () => { worker.emit('exit', 1); return 1; };
      void writeFile(workerData.tempPath, 'incomplete zip').then(entered);
      return worker;
    });
    const pending = mocks.handlers.get('diagnostics:export')!(event, request);
    await written;
    expect(controller.cancel(request.export_id)).toBe(true);
    expect(await pending).toEqual({ status: 'cancelled' });
    expect(await readFile(destination, 'utf8')).toBe('existing user file');
    expect(await readdir(mocks.directory)).toEqual(['selected.zip']);
  });

  it('publishes only successful worker output and strips unrecognized request fields', async () => {
    const { request, event, destination } = await setup();
    mocks.worker.mockImplementation(({ workerData }) => {
      expect(workerData.request).not.toHaveProperty('arbitraryPath');
      const worker = new EventEmitter() as EventEmitter & { terminate: () => Promise<number> };
      worker.terminate = async () => 0;
      void writeFile(workerData.tempPath, 'complete zip').then(() => worker.emit('message', { result: { status: 'partial', bytes: 12, sources: {} } }));
      return worker;
    });
    const result = await mocks.handlers.get('diagnostics:export')!(event, request);
    expect(result).toMatchObject({ status: 'partial', path: destination });
    expect(await readFile(destination, 'utf8')).toBe('complete zip');
    expect(await readdir(mocks.directory)).toEqual(['selected.zip']);
  });
});
