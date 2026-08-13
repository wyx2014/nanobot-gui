import { spawn, execFile, ChildProcess } from 'child_process';
import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { DEFAULT_WORKSPACE_DIRECTORY_NAME } from '../src/config/appDirectories';
import { desktopMcpGatewayEnvironment } from './builtinMcpCredentials';

const NANOBOT_PORT = 8900;
const MAX_WAIT_MS = 30_000;  // 30s — Python + asyncio startup on slow systems
const POLL_INTERVAL_MS = 100;
const MAX_RESTARTS = 3;

export class PythonBridge {
  private proc: ChildProcess | null = null;
  private _ready = false;
  private _restarts = 0;
  private _stopping = false;
  private _tokenSecret = '';
  private _startingPromise: Promise<void> | null = null;  // Prevent concurrent starts
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

  async start(): Promise<void> {
    // If already starting, return the same promise to avoid concurrent starts.
    if (this._startingPromise) {
      console.log('[PythonBridge] start() already in progress, awaiting existing promise...');
      return this._startingPromise;
    }
    this._startingPromise = this._doStart();
    try {
      await this._startingPromise;
    } finally {
      this._startingPromise = null;
    }
  }

  private async _doStart(): Promise<void> {
    const startedAt = Date.now();
    this._stopping = false;
    const { pythonBin, nanobotSrc, workspaceDir, configDir, expertTeamsDir } = this.resolvePaths();

    if (!this._tokenSecret) {
      this._tokenSecret = crypto.randomBytes(32).toString('hex');
    }

    console.log('[PythonBridge] Starting nanobot...', { pythonBin, nanobotSrc, workspaceDir });

    if (await this.isNanobotHealthy() && this.proc && !this.proc.killed) {
      console.log('[PythonBridge] Existing managed nanobot API is healthy');
      this._ready = true;
      return;
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
      // The packaged runtime must use the wheel prepared inside standalone
      // Python even when the parent shell happens to export PYTHONPATH.
      delete gatewayEnv.PYTHONPATH;
    } else {
      gatewayEnv.PYTHONPATH = nanobotSrc;
    }

    this.proc = spawn(pythonBin, args, {
      cwd: nanobotSrc,
      env: {
        ...gatewayEnv,
        PYTHONUNBUFFERED: '1',
        // Lets the Python CLI skip interactive terminal-only imports on the
        // desktop gateway path. This matters most on Windows cold starts,
        // where every additional Python module is inspected by Defender.
        NANOBOT_DESKTOP_GATEWAY: '1',
        // Write nanobot's own logs to a file so they don't pollute Electron's stdout
        NANOBOT_LOG_FILE: path.join(app.getPath('userData'), 'nanobot.log'),
        NANOBOT_EXPERT_TEAMS_DIR: expertTeamsDir,
        // Built-in shared MCP credentials are main-process-only. Config uses
        // ${ENV_VAR} references, while a literal key saved by the user takes
        // precedence and no longer depends on these defaults.
        ...desktopMcpGatewayEnvironment(),
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

    this.proc.stdout?.on('data', (d: Buffer) => {
      console.log('[nanobot]', d.toString().trimEnd());
    });

    this.proc.stderr?.on('data', (d: Buffer) => {
      console.error('[nanobot:err]', d.toString().trimEnd());
    });

    this.proc.on('exit', (code, signal) => {
      console.warn('[PythonBridge] nanobot exited', { code, signal });
      this._ready = false;

      // Auto-restart on unexpected exit (not when we killed it intentionally)
      if (!this._stopping && this._restarts < MAX_RESTARTS) {
        this._restarts++;
        console.log(`[PythonBridge] Auto-restarting (${this._restarts}/${MAX_RESTARTS}) in 3s...`);
        setTimeout(() => {
          if (!this._stopping) {
            this.start().catch((err) => {
              console.error('[PythonBridge] Restart failed:', err);
              this._broadcastError(`nanobot failed to restart: ${err.message}`);
            });
          }
        }, 3000);
      } else if (!this._stopping) {
        this._broadcastError('nanobot exited unexpectedly and could not be restarted.');
      }
    });

    this.proc.on('error', (err) => {
      console.error('[PythonBridge] spawn error:', err);
      this._ready = false;
    });

    await this.waitReady();
    this._ready = true;
    this._restarts = 0; // Reset counter on successful start
    console.log(
      '[PythonBridge] nanobot ready on port',
      NANOBOT_PORT,
      `in ${Date.now() - startedAt}ms`,
    );
  }

  async stop(): Promise<void> {
    this._stopping = true;
    this._restarts = MAX_RESTARTS; // Block auto-restart

    if (!this.proc || this.proc.killed) {
      await this.killExternalListener();
      this._ready = false;
      return;
    }

    console.log('[PythonBridge] Stopping nanobot (SIGTERM)...');
    this.proc.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      const forceKill = setTimeout(() => {
        console.warn('[PythonBridge] Force-killing nanobot (SIGKILL)');
        this.proc?.kill('SIGKILL');
        resolve();
      }, 8000);

      this.proc!.once('exit', () => {
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

  private async waitReady(): Promise<void> {
    const deadline = Date.now() + MAX_WAIT_MS;
    while (Date.now() < deadline) {
      if (await this.isNanobotHealthy()) return;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(
      `nanobot did not become ready within ${MAX_WAIT_MS / 1000}s. ` +
      `Check ${path.join(app.getPath('userData'), 'nanobot.log')} for details.`
    );
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

  private async killExternalListener(): Promise<void> {
    if (this.proc && !this.proc.killed) return;

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
