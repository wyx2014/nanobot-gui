/// <reference types="electron-vite/node" />
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Worker } from 'node:worker_threads';
import createExportWorker from './exportWorker?nodeWorker';
import type { PythonBridge } from '../pythonBridge';
import { appLaunchId, operationalLogHealth, recordMainDiagnostic, type OperationalLog } from '../operationalLog';
import { validateExportRequest, type DiagnosticExportRequest, type DiagnosticExportResult, type ExportStage } from '../../src/shared/diagnosticBundle';

export function createDiagnosticExporter(getWindow: () => BrowserWindow | null, bridge: PythonBridge, log: OperationalLog) {
  let active: { id: string; cancelled: boolean; committing: boolean; worker?: Worker } | undefined;
  let pendingDialog: { id: string; acknowledge: () => void } | undefined;
  const trusted = (event: Electron.IpcMainInvokeEvent) => event.sender === getWindow()?.webContents
    && event.senderFrame === event.sender.mainFrame;

  async function run(request: DiagnosticExportRequest, notify: (stage: ExportStage) => void): Promise<DiagnosticExportResult> {
    if (active) return { status: 'failed', error_code: 'EXPORT_ALREADY_RUNNING' };
    const task = { id: request.export_id, cancelled: false, committing: false, worker: undefined as Worker | undefined };
    active = task;
    let tempPath: string | undefined;
    const incidentId = `incident_${randomUUID()}`;
    try {
      const options: Electron.SaveDialogOptions = { title: '导出诊断包',
        defaultPath: path.join(app.getPath('downloads'), `TPCowork-diagnostics-${new Date().toISOString().slice(0, 10)}-${incidentId}.zip`),
        filters: [{ name: '诊断包 ZIP', extensions: ['zip'] }] };
      const win = getWindow();
      const selected = await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options));
      if (selected.canceled || !selected.filePath || task.cancelled) return { status: 'cancelled' };
      const destination = selected.filePath;
      tempPath = path.join(path.dirname(destination), `.tpcowork-diagnostics-${randomUUID()}.tmp`);
      recordMainDiagnostic({ event_name: 'main.diagnostic_export', request_id: task.id, status: 'started' });
      notify('collecting');
      await Promise.race([log.flush(), new Promise<void>((resolve) => setTimeout(resolve, 250))]);
      if (task.cancelled) return { status: 'cancelled' };
      const worker = createExportWorker({ workerData: {
        request, incidentId, tempPath, userData: app.getPath('userData'),
        environment: { app_version: app.getVersion(), app_launch_id: appLaunchId, packaged: app.isPackaged,
          platform: process.platform, arch: process.arch, os_release: os.release(),
          electron_version: process.versions.electron, chrome_version: process.versions.chrome, node_version: process.versions.node,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, uptime_seconds: process.uptime(), rss_bytes: process.memoryUsage().rss,
          desktop_collection: operationalLogHealth(), gateway: bridge.getOperationalSnapshot() },
        gateway: { port: bridge.port, secret: bridge.tokenSecret, ready: bridge.isReady },
      } });
      task.worker = worker;
      const result = await new Promise<DiagnosticExportResult>((resolve) => {
        const timer = setTimeout(() => {
          resolve({ status: 'failed', error_code: 'EXPORT_TIMEOUT' });
          void worker.terminate();
        }, 35_000);
        const finish = (value: DiagnosticExportResult) => { clearTimeout(timer); resolve(value); };
        worker.on('message', (message: { stage?: ExportStage; result?: DiagnosticExportResult }) => {
          if (message.stage) notify(message.stage);
          if (message.result) finish(message.result);
        });
        worker.once('error', () => finish({ status: 'failed', error_code: 'EXPORT_WORKER_FAILED' }));
        worker.once('exit', () => finish({ status: 'failed', error_code: 'EXPORT_WORKER_EXITED' }));
      });
      await worker.terminate();
      task.worker = undefined;
      if (task.cancelled) return { status: 'cancelled' };
      if (result.status !== 'ready' && result.status !== 'partial') return result;
      // Cancellation stops at commit; the user-selected destination is changed only here.
      task.committing = true;
      await fs.rename(tempPath, destination);
      tempPath = undefined;
      recordMainDiagnostic({ event_name: 'main.diagnostic_export', request_id: task.id, status: 'completed', details: { bytes: result.bytes } });
      return { ...result, path: destination };
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException)?.code;
      return { status: 'failed', error_code: typeof code === 'string' && /^[A-Z_]+$/.test(code) ? code : 'EXPORT_FAILED' };
    } finally {
      if (task.worker) await task.worker.terminate();
      if (tempPath) await fs.rm(tempPath, { force: true }).catch(() => {});
      active = undefined;
    }
  }

  function cancel(id?: string) {
    if (!active || active.committing || (id && active.id !== id)) return false;
    active.cancelled = true;
    void active.worker?.terminate();
    return true;
  }

  ipcMain.handle('diagnostics:export', async (event, value: unknown) => {
    if (!trusted(event)) return { status: 'failed', error_code: 'UNTRUSTED_SENDER' };
    let request;
    try { request = validateExportRequest(value); }
    catch { return { status: 'failed', error_code: 'INVALID_EXPORT_REQUEST' }; }
    return run(request, (stage) => {
      if (!event.sender.isDestroyed()) event.sender.send('diagnostics:export-progress', { export_id: request.export_id, stage });
    });
  });
  ipcMain.handle('diagnostics:cancel-export', (event, id: unknown) => trusted(event) && typeof id === 'string' && cancel(id));
  ipcMain.handle('diagnostics:dialog-opened', (event, id: unknown) => {
    if (!trusted(event) || !pendingDialog || pendingDialog.id !== id) return false;
    pendingDialog.acknowledge();
    return true;
  });

  async function exportNative() {
    if (pendingDialog) return;
    const webContents = getWindow()?.webContents;
    if (webContents && !webContents.isDestroyed()) {
      const opened = await new Promise<boolean>((resolve) => {
        const id = randomUUID();
        const timer = setTimeout(() => { pendingDialog = undefined; resolve(false); }, 1500);
        pendingDialog = { id, acknowledge: () => { clearTimeout(timer); pendingDialog = undefined; resolve(true); } };
        webContents.send('diagnostics:open-dialog', id);
      });
      if (opened) return;
    }
    // If the renderer cannot open a dialog, use native save UI independently.
    const result = await run({ export_id: `export_${randomUUID()}`, description: '',
      occurred_at: new Date().toISOString(), window_minutes: 15, scope: 'application' }, () => {});
    if (result.status === 'cancelled') return;
    const success = result.status === 'ready' || result.status === 'partial';
    const response = await dialog.showMessageBox({ type: success ? 'info' : 'error', title: '诊断包',
      message: success ? (result.status === 'partial' ? '诊断包已保存，部分信息未能收集' : '诊断包已保存') : '诊断包导出失败',
      detail: success ? `问题编号：${result.incident_id}\n${result.path}\n可将 ZIP 发给技术支持。` : `错误代码：${result.error_code}`,
      buttons: success ? ['打开所在文件夹', '关闭'] : ['关闭'] });
    if (success && response.response === 0 && result.path) shell.showItemInFolder(result.path);
  }
  return { exportNative, cancel };
}
