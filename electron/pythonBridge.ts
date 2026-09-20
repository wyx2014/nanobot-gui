import { spawn, execFile, ChildProcess } from 'child_process';
import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { DEFAULT_WORKSPACE_DIRECTORY_NAME } from '../src/config/appDirectories';
import { desktopMcpGatewayEnvironment } from './builtinMcpCredentials';
import { desktopImageExtractGatewayEnvironment } from './builtinImageExtractService';
import {
  NanobotDiagnosticBuffer,
  redactNanobotDiagnosticText,
  type NanobotDiagnosticSource,
} from './nanobotDiagnostics';
import { StartupLog } from './startupLog';
import { appLaunchId, operationalLogHealth, recordMainDiagnostic } from './operationalLog';
import { diagnosticError, diagnosticId } from '../src/shared/diagnostics';

const NANOBOT_PORT = 8900;
// A freshly installed standalone Python runtime can take much longer on
// Windows while Defender scans its modules for the first time.
const MAX_WAIT_MS = process.platform === 'win32' ? 120_000 : 30_000;
const POLL_INTERVAL_MS = 100;
const MAX_RESTARTS = 3;
const RESTART_DELAY_MS = 3000;
const NANOBOT_LOG_TAIL_BYTES = 96 * 1024;

class RetryableNanobotStartupError extends Error {}

export interface NanobotDiagnosticsSnapshot {
  capturedAt: string;
  status: 'ready' | 'starting' | 'running' | 'error' | 'stopped';
  ready: boolean;
  starting: boolean;
  port: number;
  pid: number | null;
  restartCount: number;
  platform: string;
  packaged: boolean;
  pythonBin: string;
  pythonExists: boolean;
  logPath: string;
  logExists: boolean;
  startupLogPath: string;
  startupLogExists: boolean;
  lastError: string | null;
  text: string;
}

export class PythonBridge {
  private proc: ChildProcess | null = null;
  private _ready = false;
  private _restarts = 0;
  private _stopping = false;
  private _tokenSecret = '';
  private _startingPromise: Promise<void> | null = null;  // Prevent concurrent starts
  private readonly _diagnostics = new NanobotDiagnosticBuffer();
  private _startupLog: StartupLog | null = null;
  private _lastError: string | null = null;
  private _lastExit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  private _mermaidRenderer: { url: string; token: string } | null = null;
  private _pdfRenderer: { url: string; token: string } | null = null;
  private _htmlRenderer: { url: string; token: string } | null = null;

  setMermaidRenderer(url: string, token: string): void {
    this._mermaidRenderer = { url, token };
  }

  setPdfRenderer(url: string, token: string): void {
    this._pdfRenderer = { url, token };
  }

  setHtmlRenderer(url: string, token: string): void {
    this._htmlRenderer = { url, token };
  }

  get isReady(): boolean {
    return this._ready;
  }

  get isStarting(): boolean {
    return this._startingPromise !== null;
  }

  get port(): number {
    return NANOBOT_PORT;
  }

  get tokenSecret(): string {
    return this._tokenSecret;
  }

  getOperationalSnapshot(): Record<string, unknown> {
    return { captured_at: new Date().toISOString(), ready: this._ready, starting: this.isStarting,
      pid: this.proc?.pid ?? null, restart_count: this._restarts, port: NANOBOT_PORT,
      last_exit_code: this._lastExit?.code ?? null, last_exit_signal: this._lastExit?.signal ?? null,
      process_running: Boolean(this.proc && this.proc.exitCode === null && !this.proc.killed) };
  }

  recordMainStartupEvent(message: string): void {
    this.recordDiagnostic('main', message);
  }

  async start(): Promise<void> {
    // If already starting, return the same promise to avoid concurrent starts.
    if (this._startingPromise) {
      console.log('[PythonBridge] start() already in progress, awaiting existing promise...');
      return this._startingPromise;
    }
    this._stopping = false;
    const request_id = diagnosticId('startup');
    const started = performance.now();
    recordMainDiagnostic({ event_name: 'bridge.start', request_id, status: 'started' });
    this._restarts = 0;
    this._lastError = null;
    this._lastExit = null;
    this._startingPromise = this._startWithRetries();
    try {
      await this._startingPromise;
      recordMainDiagnostic({ event_name: 'bridge.start', request_id, status: 'completed', duration_ms: performance.now() - started });
    } catch (error) {
      recordMainDiagnostic({ event_name: 'bridge.start', request_id, status: 'failed', level: 'error', duration_ms: performance.now() - started, details: diagnosticError(error) });
      const message = error instanceof Error ? error.message : String(error);
      this._ready = false;
      this._lastError = message;
      this.recordDiagnostic('bridge', `Start failed: ${message}`);
      throw error;
    } finally {
      this._startingPromise = null;
    }
  }

  private async _startWithRetries(): Promise<void> {
    let retryCount = 0;

    while (true) {
      try {
        await this._doStart();
        this._restarts = 0;
        return;
      } catch (error) {
        if (
          this._stopping ||
          !(error instanceof RetryableNanobotStartupError) ||
          retryCount >= MAX_RESTARTS
        ) {
          throw error;
        }

        retryCount += 1;
        recordMainDiagnostic({ event_name: 'bridge.start_retry', level: 'warning', details: { attempt: retryCount, delay_ms: RESTART_DELAY_MS } });
        this._restarts = retryCount;
        const message = error instanceof Error ? error.message : String(error);
        const retryMessage =
          `Nanobot startup attempt failed; retrying ` +
          `(${retryCount}/${MAX_RESTARTS}) in ${RESTART_DELAY_MS / 1000}s: ${message}`;
        console.warn(`[PythonBridge] ${retryMessage}`);
        this.recordDiagnostic('bridge', retryMessage);
        await new Promise((resolve) => setTimeout(resolve, RESTART_DELAY_MS));
        if (this._stopping) {
          throw new Error('Nanobot startup was cancelled.');
        }
      }
    }
  }

  private async _doStart(): Promise<void> {
    const startedAt = Date.now();
    const { pythonBin, nanobotSrc, workspaceDir, configDir, expertTeamsDir } = this.resolvePaths();

    if (!this._tokenSecret) {
      this._tokenSecret = crypto.randomBytes(32).toString('hex');
    }

    console.log('[PythonBridge] Starting nanobot...', { pythonBin, nanobotSrc, workspaceDir });
    this.recordDiagnostic(
      'bridge',
      `Starting nanobot (platform=${process.platform}/${process.arch}, packaged=${app.isPackaged}, python=${pythonBin}, workspace=${workspaceDir})`,
    );

    if (await this.isNanobotHealthy() && this.isManagedProcessRunning()) {
      console.log('[PythonBridge] Existing managed nanobot API is healthy');
      this._ready = true;
      return;
    }
    // A startup timeout can leave Python alive without a listening gateway.
    // Dispose of that child before a retry replaces its process handle.
    if (this.isManagedProcessRunning()) {
      await this.stop();
      this._stopping = false;
    }
    if (await this.isPortListening()) {
      console.warn(`[PythonBridge] Port ${NANOBOT_PORT} is already in use; clearing external process before start.`);
      await this.killExternalListener();
      if (await this.isPortListening()) {
        throw new Error(`Port ${NANOBOT_PORT} is already in use and could not be cleared.`);
      }
    }

    // Verify Python binary exists
    if (!fs.existsSync(pythonBin)) {
      this.recordDiagnostic('bridge', `Python binary not found: ${pythonBin}`);
      throw new Error(
        `Python binary not found: ${pythonBin}\n` +
        `In dev mode, run: cd nanobot && python3 -m venv venv && venv/bin/pip install -e ".[desktop]"`
      );
    }

    const args = [
      '-m', 'nanobot', 'desktop-gateway',
      '--webui-port', String(NANOBOT_PORT),
      '--token-issue-secret', this._tokenSecret,
      '--workspace', workspaceDir,
      '--config', path.join(configDir, 'config.json'),
    ];

    const gatewayEnv = { ...process.env };
    if (app.isPackaged) {
      const nodeBin = process.platform === 'win32'
        ? path.join(process.resourcesPath, 'node', 'node.exe')
        : path.join(process.resourcesPath, 'node', 'bin', 'node');
      if (fs.existsSync(nodeBin)) gatewayEnv.NANOBOT_NODE_BIN = nodeBin;
    }
    if (app.isPackaged) {
      // The packaged runtime must use the wheel prepared inside standalone
      // Python even when the parent shell happens to export PYTHONPATH.
      delete gatewayEnv.PYTHONPATH;
    } else {
      gatewayEnv.PYTHONPATH = nanobotSrc;
    }

    const child = spawn(pythonBin, args, {
      cwd: nanobotSrc,
      env: {
        ...gatewayEnv,
        PYTHONUNBUFFERED: '1',
        // Lets the Python CLI skip interactive terminal-only imports on the
        // desktop gateway path. This matters most on Windows cold starts,
        // where every additional Python module is inspected by Defender.
        NANOBOT_DESKTOP_GATEWAY: '1',
        NANOBOT_APP_LAUNCH_ID: appLaunchId,
        // Write nanobot's own logs to a file so they don't pollute Electron's stdout
        NANOBOT_LOG_FILE: path.join(app.getPath('userData'), 'nanobot.log'),
        NANOBOT_EXPERT_TEAMS_DIR: expertTeamsDir,
        // Built-in shared MCP credentials are main-process-only. Config uses
        // ${ENV_VAR} references, while a literal key saved by the user takes
        // precedence and no longer depends on these defaults.
        ...desktopMcpGatewayEnvironment(),
        ...desktopImageExtractGatewayEnvironment(),
        ...(this._mermaidRenderer && {
          NANOBOT_MERMAID_RENDER_URL: this._mermaidRenderer.url,
          NANOBOT_MERMAID_RENDER_TOKEN: this._mermaidRenderer.token,
        }),
        ...(this._pdfRenderer && {
          NANOBOT_PDF_RENDER_URL: this._pdfRenderer.url,
          NANOBOT_PDF_RENDER_TOKEN: this._pdfRenderer.token,
        }),
        ...(this._htmlRenderer && {
          NANOBOT_HTML_RENDER_URL: this._htmlRenderer.url,
          NANOBOT_HTML_RENDER_TOKEN: this._htmlRenderer.token,
        }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.proc = child;
    recordMainDiagnostic({ event_name: 'bridge.spawned', details: { pid: child.pid } });
    let becameReady = false;
    this.recordDiagnostic('bridge', `Spawned nanobot process (pid=${child.pid ?? 'pending'}, port=${NANOBOT_PORT})`);

    child.stdout?.on('data', (d: Buffer) => {
      const output = d.toString().trimEnd();
      console.log('[nanobot]', output);
      this.recordDiagnostic('stdout', output);
    });

    child.stderr?.on('data', (d: Buffer) => {
      const output = d.toString().trimEnd();
      console.error('[nanobot:err]', output);
      this.recordDiagnostic('stderr', output);
    });

    const startupFailure = new Promise<never>((_resolve, reject) => {
      child.once('exit', (code, signal) => {
        reject(new RetryableNanobotStartupError(
          `nanobot exited before becoming ready ` +
          `(code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
        ));
      });
      child.once('error', (error) => {
        reject(new RetryableNanobotStartupError(`Failed to spawn nanobot: ${error.message}`));
      });
    });

    child.on('exit', (code, signal) => {
      recordMainDiagnostic({ event_name: 'bridge.exited', level: this._stopping ? 'info' : 'error', details: { code, signal, intentional: this._stopping } });
      console.warn('[PythonBridge] nanobot exited', { code, signal });
      if (this.proc !== child) return;
      this._ready = false;
      this._lastExit = { code, signal };
      this._lastError = `nanobot exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`;
      this.recordDiagnostic('bridge', this._lastError);

      // Startup failures are retried by _startWithRetries(). Once the child
      // became healthy, preserve automatic recovery for later runtime exits.
      if (!this._stopping && becameReady) {
        this._restarts = Math.min(this._restarts + 1, MAX_RESTARTS);
        console.log(
          `[PythonBridge] Auto-restarting (${this._restarts}/${MAX_RESTARTS}) ` +
          `in ${RESTART_DELAY_MS / 1000}s...`,
        );
        setTimeout(() => {
          if (!this._stopping && this.proc === child) {
            this.start().catch((err) => {
              console.error('[PythonBridge] Restart failed:', err);
              this._broadcastError(`nanobot failed to restart: ${err.message}`);
            });
          }
        }, RESTART_DELAY_MS);
      }
    });

    child.on('error', (err) => {
      console.error('[PythonBridge] spawn error:', err);
      if (this.proc !== child) return;
      this._ready = false;
      this._lastError = `Spawn error: ${err.message}`;
      this.recordDiagnostic('bridge', this._lastError);
    });

    await Promise.race([this.waitReady(child), startupFailure]);
    becameReady = true;
    this._ready = true;
    this._lastError = null;
    this._lastExit = null;
    this._restarts = 0; // Reset counter on successful start
    console.log(
      '[PythonBridge] nanobot ready on port',
      NANOBOT_PORT,
      `in ${Date.now() - startedAt}ms`,
    );
    this.recordDiagnostic('bridge', `Nanobot ready on port ${NANOBOT_PORT} in ${Date.now() - startedAt}ms`);
  }

  getDiagnostics(): NanobotDiagnosticsSnapshot {
    const capturedAt = new Date().toISOString();
    const { pythonBin } = this.resolvePaths();
    const logPath = path.join(app.getPath('userData'), 'nanobot.log');
    const startupLogPath = path.join(app.getPath('userData'), 'startup.log');
    const logTail = this.readLogTail(logPath);
    const startupLogTail = this.readLogTail(startupLogPath);
    const desktopLogTail = this.readLogTail(path.join(app.getPath('userData'), 'desktop-events.jsonl'));
    const exactSecrets = [this._tokenSecret];
    const processRunning = Boolean(this.proc && this.proc.exitCode === null && !this.proc.killed);
    const status: NanobotDiagnosticsSnapshot['status'] = this._ready
      ? 'ready'
      : this.isStarting
        ? 'starting'
        : this._lastError
          ? 'error'
          : processRunning
            ? 'running'
            : 'stopped';
    const lastExit = this._lastExit
      ? `code=${this._lastExit.code ?? 'null'}, signal=${this._lastExit.signal ?? 'null'}`
      : 'none';
    const metadata = [
      'TPCowork diagnostics',
      `captured_at=${capturedAt}`,
      `app_launch_id=${appLaunchId}`,
      `desktop_log_health=${JSON.stringify(operationalLogHealth())}`,
      `status=${status}`,
      `ready=${this._ready}`,
      `starting=${this.isStarting}`,
      `platform=${process.platform}/${process.arch}`,
      `packaged=${app.isPackaged}`,
      `port=${NANOBOT_PORT}`,
      `pid=${this.proc?.pid ?? 'none'}`,
      `process_running=${processRunning}`,
      `restart_count=${this._restarts}/${MAX_RESTARTS}`,
      `last_exit=${lastExit}`,
      `python=${pythonBin}`,
      `python_exists=${fs.existsSync(pythonBin)}`,
      `log=${logPath}`,
      `log_exists=${fs.existsSync(logPath)}`,
      `startup_log=${startupLogPath}`,
      `startup_log_exists=${fs.existsSync(startupLogPath)}`,
      `last_error=${this._lastError ?? 'none'}`,
    ].join('\n');
    const bridgeOutput = this._diagnostics.format(exactSecrets) || '(no bridge output captured yet)';
    const startupFileOutput = startupLogTail || '(startup.log has not been created or is empty)';
    const fileOutput = logTail || '(nanobot.log has not been created or is empty)';
    const text = redactNanobotDiagnosticText(
      `${metadata}\n\n[bridge / process output]\n${bridgeOutput}`
      + `\n\n[startup.log tail]\n${startupFileOutput}`
      + `\n\n[nanobot.log tail]\n${fileOutput}`
      + `\n\n[desktop-events.jsonl tail]\n${desktopLogTail || '(no operational events yet)'}`,
      exactSecrets,
    );

    return {
      capturedAt,
      status,
      ready: this._ready,
      starting: this.isStarting,
      port: NANOBOT_PORT,
      pid: this.proc?.pid ?? null,
      restartCount: this._restarts,
      platform: `${process.platform}/${process.arch}`,
      packaged: app.isPackaged,
      pythonBin,
      pythonExists: fs.existsSync(pythonBin),
      logPath,
      logExists: fs.existsSync(logPath),
      startupLogPath,
      startupLogExists: fs.existsSync(startupLogPath),
      lastError: this._lastError,
      text,
    };
  }

  async stop(): Promise<void> {
    this._stopping = true;
    this._restarts = MAX_RESTARTS; // Block auto-restart

    const child = this.proc;
    if (!child || child.exitCode !== null || child.killed) {
      await this.killExternalListener();
      this._ready = false;
      return;
    }

    console.log('[PythonBridge] Stopping nanobot (SIGTERM)...');
    child.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      const forceKill = setTimeout(() => {
        console.warn('[PythonBridge] Force-killing nanobot (SIGKILL)');
        child.kill('SIGKILL');
        resolve();
      }, 8000);

      child.once('exit', () => {
        clearTimeout(forceKill);
        resolve();
      });
    });

    this._ready = false;
    console.log('[PythonBridge] nanobot stopped');
  }

  async restart(): Promise<void> {
    console.log('[PythonBridge] Restarting nanobot...');
    await this.stop();
    this._restarts = 0;
    this._stopping = false;
    await this.start();
  }

  /** Resolve all relevant paths for dev and production */
  private resolvePaths(): {
    pythonBin: string;
    nanobotSrc: string;
    workspaceDir: string;
    configDir: string;
    expertTeamsDir: string;
  } {
    const workspaceDir = path.join(app.getPath('userData'), DEFAULT_WORKSPACE_DIRECTORY_NAME);
    const configDir = path.join(workspaceDir, '.nanobot');

    // Ensure directories exist
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });

    if (!app.isPackaged) {
      // Development: use nanobot project venv
      // __dirname in electron/ is out/main/ at runtime via electron-vite
      // The monorepo root is: nanobot-pc/
      // In dev mode, electron-vite outputs main to out/main/index.cjs
      // __dirname = nanobot-gui/out/main/
      // Path levels: out/main/ -> out/ -> nanobot-gui/ -> nanobot-pc/ (3 levels up)
      const monorepoRoot = path.resolve(__dirname, '../../..');
      const nanobotSrc = path.join(monorepoRoot, 'nanobot');
      const expertTeamsDir = path.join(monorepoRoot, 'nanobot-gui', 'resources', 'expert-teams');

      const pythonBin = process.platform === 'win32'
        ? path.join(nanobotSrc, 'venv', 'Scripts', 'python.exe')
        : path.join(nanobotSrc, 'venv', 'bin', 'python3');

      return { pythonBin, nanobotSrc, workspaceDir, configDir, expertTeamsDir };
    }

    // Production: use bundled Python from extraResources
    const pythonBin = process.platform === 'win32'
      ? path.join(process.resourcesPath, 'python', 'python.exe')
      : path.join(process.resourcesPath, 'python', 'bin', 'python3');

    // Production runs the wheel installed into the standalone Python runtime
    // during prepare-python. Using the workspace as cwd avoids shadowing that
    // precompiled package with an unpacked source tree.
    const nanobotSrc = workspaceDir;
    const expertTeamsDir = path.join(process.resourcesPath, 'expert-teams');

    return { pythonBin, nanobotSrc, workspaceDir, configDir, expertTeamsDir };
  }

  private async waitReady(child: ChildProcess): Promise<void> {
    const deadline = Date.now() + MAX_WAIT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.killed) {
        throw new RetryableNanobotStartupError(
          `nanobot exited before becoming ready ` +
          `(code=${child.exitCode ?? 'null'}, killed=${child.killed})`,
        );
      }
      if (await this.isNanobotHealthy()) return;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(
      `nanobot did not become ready within ${MAX_WAIT_MS / 1000}s. ` +
      `Check ${path.join(app.getPath('userData'), 'nanobot.log')} for details.`
    );
  }

  private recordDiagnostic(source: NanobotDiagnosticSource, value: unknown): void {
    this._diagnostics.append(source, value);
    // Keep launch history across restarts. Once healthy, nanobot.log owns the
    // long-running Python stream; startup.log only needs main/bridge events.
    if (source === 'main' || source === 'bridge' || !this._ready) {
      if (!this._startupLog) {
        this._startupLog = new StartupLog(path.join(app.getPath('userData'), 'startup.log'));
      }
      this._startupLog.append(source, value, [this._tokenSecret]);
    }
  }

  private readLogTail(logPath: string): string {
    let handle: number | null = null;
    try {
      const size = fs.statSync(logPath).size;
      if (size <= 0) return '';
      const length = Math.min(size, NANOBOT_LOG_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      handle = fs.openSync(logPath, 'r');
      fs.readSync(handle, buffer, 0, length, size - length);
      const decoded = buffer.toString('utf8').replace(/^\uFFFD/, '');
      const firstNewline = size > length ? decoded.indexOf('\n') : -1;
      return (firstNewline >= 0 ? decoded.slice(firstNewline + 1) : decoded).trimEnd();
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return '';
      return `[Could not read nanobot.log: ${error instanceof Error ? error.message : String(error)}]`;
    } finally {
      if (handle !== null) fs.closeSync(handle);
    }
  }

  private async isNanobotHealthy(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      if (this._tokenSecret) {
        headers['X-Nanobot-Auth'] = this._tokenSecret;
      }
      const resp = await fetch(`http://127.0.0.1:${NANOBOT_PORT}/webui/bootstrap`, {
        method: 'GET',
        headers,
      });
      // Process readiness is the authenticated gateway HTTP surface being
      // available. The agent loop has its own runtime readiness signal and may
      // still be warming; treating that as a dead process creates restart
      // loops whenever model/MCP initialization is slow or temporarily offline.
      return resp.ok;
    } catch {
      return false;
    }
  }

  private isManagedProcessRunning(): boolean {
    return Boolean(this.proc && this.proc.exitCode === null && !this.proc.killed);
  }

  private async killExternalListener(): Promise<void> {
    if (this.isManagedProcessRunning()) return;

    const pids = await this.findPortListenerPids();
    if (pids.length === 0) return;

    console.warn(`[PythonBridge] Killing external process(es) on port ${NANOBOT_PORT}: ${pids.join(', ')}`);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGTERM');
      } catch (err) {
        console.warn(`[PythonBridge] Failed to SIGTERM ${pid}:`, err);
      }
    }

    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (!(await this.isPortListening())) return;
      await new Promise((r) => setTimeout(r, 150));
    }

    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGKILL');
      } catch {
        // Process may have exited after SIGTERM.
      }
    }
  }

  private findPortListenerPids(): Promise<string[]> {
    if (process.platform === 'win32') {
      return Promise.resolve([]);
    }

    return new Promise((resolve) => {
      execFile('lsof', ['-nP', `-iTCP:${NANOBOT_PORT}`, '-sTCP:LISTEN', '-t'], (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve([]);
          return;
        }
        resolve(stdout.split(/\s+/).map((pid) => pid.trim()).filter(Boolean));
      });
    });
  }

  private async isPortListening(): Promise<boolean> {
    return (await this.findPortListenerPids()).length > 0;
  }

  private _broadcastError(message: string): void {
    const win = BrowserWindow.getAllWindows()[0];
    win?.webContents.send('event:nanobot-error', message);
  }
}

export const pythonBridge = new PythonBridge();
