import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import fs from 'fs/promises'
import { exec, spawn } from 'child_process'
import os from 'os'
import { pythonBridge } from './pythonBridge'
import { syncNanobotConfig, type NanobotConfigInput } from './nanobotConfig'
import { MermaidBridge } from './mermaidBridge'

import { electronApp, optimizer } from '@electron-toolkit/utils'

const isDev = typeof app !== 'undefined' ? !app.isPackaged : (process.env.NODE_ENV === 'development')

// Keep GPU acceleration enabled by default. Individual deployments can opt
// into the conservative software-rendering path if a device/driver proves
// unstable, without penalising every other machine.
app.commandLine.appendSwitch('log-level', '3');
if (process.env.TPARUYI_DISABLE_GPU === '1') {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-rasterization');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  console.warn('[Main] GPU acceleration disabled by TPARUYI_DISABLE_GPU');
}

let isQuitting = false;

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      webSecurity: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.webContents.send('event:close-requested');
    }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  console.log('[Main] app.whenReady fired');
  
  app.on('before-quit', async (e) => {
    if (!isQuitting) {
      isQuitting = true;
      e.preventDefault();
      console.log('[Main] Gracefully stopping nanobot before quit...');
      await pythonBridge.stop();
      app.quit();
    }
  });
  const userData = app.getPath('userData');
  const mermaidBridge = new MermaidBridge();
  await mermaidBridge.start();
  pythonBridge.setMermaidRenderer(mermaidBridge.url, mermaidBridge.token);
  console.log('[Main] UserData Path:', userData);

  // Ensure models directory exists
  const modelsDirPath = join(userData, 'models');
  fs.mkdir(modelsDirPath, { recursive: true }).then(async () => {
    console.log('[Main] Models directory verified at:', modelsDirPath);
  }).catch(err => {
    console.error('[Main] Failed to create or access models directory:', err);
  });

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.tparuyi.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  function formatLogData(data: any): string {
    if (data === undefined || data === null) return '';
    if (Array.isArray(data)) {
      if (data.length === 0) return '';
      if (data.length > 10) {
        return `[${data.slice(0, 5).map(v => typeof v === 'number' ? v.toFixed(4) : JSON.stringify(v)).join(', ')}, ... ${data.length} items]`;
      }
      return JSON.stringify(data);
    }
    if (typeof data === 'object') {
      const keys = Object.keys(data);
      if (keys.length === 0) return '';
      if (keys.length > 20) return `{ ... ${keys.length} keys }`;
      const result: any = {};
      for (const key of keys) {
        const val = data[key];
        if (typeof val === 'string' && val.length > 200) {
          result[key] = val.substring(0, 100) + '... (truncated)';
        } else if (Array.isArray(val) && val.length > 10) {
          result[key] = `[Array(${val.length})]`;
        } else if (val && typeof val === 'object' && !Array.isArray(val)) {
          result[key] = '{...}';
        } else {
          result[key] = val;
        }
      }
      return JSON.stringify(result);
    }
    if (typeof data === 'string' && data.length > 500) {
      return data.substring(0, 200) + '... (truncated)';
    }
    return JSON.stringify(data);
  }

  const SILENT_CHANNELS = new Set(['os:homeDir', 'os:resolve', 'fs:exists']);

  const safeInvoke = (channel: string, handler: (args: any) => Promise<any>) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, data: any) => {
      const formattedData = formatLogData(data);
      if (!SILENT_CHANNELS.has(channel)) {
        console.log(`[IPC] ${channel}${formattedData ? ' called with: ' + formattedData : ''}`);
      }
      try {
        return await handler(data);
      } catch (error: any) {
        if (error?.code === 'ENOENT') {
          console.warn(`[IPC] NOT FOUND: ${data?.path || data}`);
        } else {
          console.error(`[IPC] Error in ${channel}:`, error);
        }
        throw error;
      }
    });
  };

  safeInvoke('fs:readDir', async (data) => {
    const path = typeof data === 'string' ? data : data?.path;
    if (!path) throw new Error('fs:readDir failed: path is missing');
    const entries = await fs.readdir(path, { withFileTypes: true });
    return entries.map(e => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      isFile: e.isFile(),
      isSymbolicLink: e.isSymbolicLink()
    }));
  });

  safeInvoke('fs:readTextFile', async (data) => {
    const path = typeof data === 'string' ? data : data?.path;
    if (!path) throw new Error('fs:readTextFile failed: path is missing');
    return await fs.readFile(path, 'utf-8');
  });

  safeInvoke('fs:writeTextFile', async (data) => {
    const { path, content } = typeof data === 'string' ? { path: data, content: '' } : data;
    if (!path) throw new Error('fs:writeTextFile failed: path is missing');
    const { dirname } = await import('path');
    await fs.mkdir(dirname(path), { recursive: true });
    return await fs.writeFile(path, content);
  });

  safeInvoke('fs:mkdir', async (data) => {
    const { path, options } = typeof data === 'string' ? { path: data, options: undefined } : data;
    if (!path) throw new Error('fs:mkdir failed: path is missing');
    return await fs.mkdir(path, options);
  });

  safeInvoke('fs:remove', async (data) => {
    const { path, options } = typeof data === 'string' ? { path: data, options: undefined } : data;
    if (!path) throw new Error('fs:remove failed: path is missing');
    if (options?.recursive) {
      return await fs.rm(path, { recursive: true, force: true });
    }
    return await fs.unlink(path);
  });

  safeInvoke('fs:exists', async (data) => {
    const path = typeof data === 'string' ? data : data?.path;
    if (!path) return false;
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  });

  safeInvoke('fs:readFile', async (data) => {
    const path = typeof data === 'string' ? data : data?.path;
    if (!path) throw new Error('fs:readFile failed: path is missing');
    const buffer = await fs.readFile(path);
    return new Uint8Array(buffer);
  });

  safeInvoke('skills:readPackage', async (data) => {
    const skillPath = typeof data === 'string' ? data : data?.path;
    if (!skillPath) throw new Error('skills:readPackage failed: path is missing');
    const pathMod = await import('path');
    const root = pathMod.dirname(skillPath);
    const skipDirs = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv']);
    const files: Array<{ path: string; content: Uint8Array }> = [];
    const walk = async (dir: string) => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || (entry.isDirectory() && skipDirs.has(entry.name))) continue;
        const abs = pathMod.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(abs);
        } else if (entry.isFile()) {
          files.push({
            path: pathMod.relative(root, abs).split(pathMod.sep).join('/'),
            content: new Uint8Array(await fs.readFile(abs)),
          });
        }
      }
    };
    await walk(root);
    return files;
  });

  safeInvoke('skills:writePackage', async (data) => {
    const name = typeof data?.name === 'string' ? data.name.trim() : '';
    const files = Array.isArray(data?.files) ? data.files : [];
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) throw new Error('invalid skill name');
    if (!files.some((file: any) => String(file?.path).toLowerCase() === 'skill.md')) {
      throw new Error('skill package must include SKILL.md');
    }
    const pathMod = await import('path');
    const root = pathMod.join(app.getPath('userData'), 'nanobot-workspace', 'skills', name);
    await fs.rm(root, { recursive: true, force: true });
    for (const file of files) {
      const rel = String(file?.path ?? '').replace(/\\/g, '/');
      if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) throw new Error('invalid skill file path');
      const target = pathMod.join(root, rel);
      await fs.mkdir(pathMod.dirname(target), { recursive: true });
      await fs.writeFile(target, String(file?.content ?? ''), 'utf-8');
    }
  });

  ipcMain.handle('shell:open', async (_, url: string) => {
    shell.openExternal(url)
  })

  ipcMain.handle('shell:openPath', async (_, path: string) => {
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  })

  ipcMain.handle('shell:reveal', async (_, path: string) => {
    shell.showItemInFolder(path)
  })

  ipcMain.handle('notification:send', async (_, options: string | { title: string; body?: string }) => {
    const { Notification } = await import('electron')
    const title = typeof options === 'string' ? options : options.title
    const body = typeof options === 'object' ? options.body : undefined
    new Notification({ title, body }).show()
  })

  ipcMain.handle('clipboard:writeText', async (_, text: string) => {
    const { clipboard } = await import('electron')
    clipboard.writeText(text)
  })

  ipcMain.handle('clipboard:readText', async () => {
    const { clipboard } = await import('electron')
    return clipboard.readText()
  })

  ipcMain.handle('mermaid:render-result', (_, result) => {
    mermaidBridge.complete(result?.id, result);
  })

  ipcMain.handle('dialog:open', async (event, options: any) => {
    const { dialog } = await import('electron')
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const electronOptions: any = {
      title: options.title,
      defaultPath: options.defaultPath,
      buttonLabel: options.buttonLabel,
      filters: options.filters,
      properties: options.properties || []
    }
    if (options.directory && !electronOptions.properties.includes('openDirectory')) {
      electronOptions.properties.push('openDirectory')
    }
    if (options.multiple && !electronOptions.properties.includes('multiSelections')) {
      electronOptions.properties.push('multiSelections')
    }
    if (electronOptions.properties.length === 0) {
      electronOptions.properties.push('openFile')
    }
    const result = await dialog.showOpenDialog(win, electronOptions)
    if (result.canceled) return null
    return options.multiple ? result.filePaths : result.filePaths[0]
  })

  safeInvoke('os:homeDir', async () => os.homedir());
  safeInvoke('os:platform', async () => process.platform);
  safeInvoke('os:appDataDir', async () => app.getPath('userData'));
  safeInvoke('os:desktopDir', async () => app.getPath('desktop'));
  safeInvoke('os:documentDir', async () => app.getPath('documents'));
  safeInvoke('os:downloadDir', async () => app.getPath('downloads'));
  safeInvoke('get_env_vars', async (data) => {
    const names = data?.names || []
    const result: Record<string, string> = {}
    for (const name of names) {
      if (process.env[name]) result[name] = process.env[name]!
    }
    return result
  });

  safeInvoke('log_to_main', async (data) => {
    const { level, message } = data || {};
    const label = level ? level.toUpperCase() : 'INFO';
    console.log(`[Bridge:${label}] ${message}`);
    return true;
  });

  safeInvoke('app:fetch', async (data) => {
    const { url, options } = data || {}
    if (!url) throw new Error('app:fetch failed: URL is missing')
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options?.headers,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
    });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body
    };
  });

  ipcMain.handle('window:setTitle', (event, title: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.setTitle(title)
  })

  ipcMain.handle('app_exit', () => app.quit())
  ipcMain.handle('window_hide', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.hide()
  })

  safeInvoke('os:resolve', async (data) => {
    const p = typeof data === 'string' ? data : data?.path;
    if (!p) throw new Error('os:resolve failed: path is missing');
    const pathMod = await import('path')
    const osMod = await import('os')
    if (pathMod.isAbsolute(p)) return p
    return pathMod.resolve(osMod.homedir(), p)
  });

  safeInvoke('os:resolveResource', async (data) => {
    const p = typeof data === 'string' ? data : data?.path;
    if (!p) throw new Error('os:resolveResource failed: path is missing');
    const rPath = app.isPackaged 
      ? process.resourcesPath 
      : join(__dirname, '../../resources')
    return join(rPath, p)
  });

  safeInvoke('fs:lstat', async (data) => {
    const pathStr = typeof data === 'string' ? data : data?.path;
    if (!pathStr) throw new Error('fs:lstat failed: path is missing');
    const fsNode = await import('fs/promises');
    const stats = await fsNode.lstat(pathStr);
    return {
      isSymbolicLink: stats.isSymbolicLink(),
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    }
  });

  ipcMain.handle('window_show', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.show()
  })

  ipcMain.on('ping', () => console.log('pong'))

  safeInvoke('run_shell_command', async (data) => {
    const { command, cwd, background, timeout } = data || {}
    return new Promise((resolve) => {
      console.log(`[Main] Executing shell command: ${command}`)
      if (!command) return resolve({ stdout: '', stderr: 'Command missing', code: 1 });
      if (background) {
        const child = spawn(command, { shell: true, cwd: cwd || os.homedir(), detached: true, stdio: 'pipe' });
        let stdout = '';
        child.stdout?.on('data', (d) => { stdout += d.toString() });
        setTimeout(() => resolve({ stdout: stdout || 'Started', stderr: '', code: 0 }), 2000);
        child.unref();
        return;
      }
      exec(command, { cwd: cwd || os.homedir(), timeout: (timeout || 30) * 1000 }, (error: any, stdout: string, stderr: string) => {
        resolve({ stdout, stderr: stderr || (error ? error.message : ''), code: error ? (error.code || 1) : 0 });
      });
    })
  });

  // ── nanobot Python bridge IPC handlers ──────────────────────────────────

  // Query nanobot process status (called by renderer on startup)
  ipcMain.handle('nanobot:status', () => ({
    ready: pythonBridge.isReady,
    port: pythonBridge.port,
    tokenSecret: pythonBridge.tokenSecret,
  }));

  // Renderer pushes settings → main syncs to nanobot config and (re)starts bridge
  ipcMain.handle('nanobot:sync-config', async (_, settings: NanobotConfigInput) => {
    try {
      const changed = await syncNanobotConfig(settings);
      if (pythonBridge.isReady && changed) {
        await pythonBridge.restart();
      } else if (!pythonBridge.isReady) {
        await pythonBridge.start();
      }
      return { ok: true };
    } catch (err: any) {
      console.error('[Main] nanobot:sync-config error:', err);
      return { ok: false, error: err.message };
    }
  });

  // Non-streaming HTTP proxy for nanobot API (GET/POST for status/memory queries)
  ipcMain.handle('nanobot:request', async (_, {
    method,
    path: urlPath,
    body,
  }: { method?: string; path: string; body?: unknown }) => {
    const url = `http://127.0.0.1:${pythonBridge.port}${urlPath}`;
    const resp = await fetch(url, {
      method: method ?? 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    return { status: resp.status, data: await resp.json().catch(() => null) };
  });

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // ── Early nanobot startup (best-effort) ────────────────────────────────
  // If a config.json from a previous session exists, start nanobot NOW so
  // that it is ready (or nearly ready) by the time the renderer asks for it.
  // The renderer's nanobot:sync-config call will still run later; if the
  // config hasn't changed, isReady will already be true and no restart happens.
  const earlyConfigPath = join(app.getPath('userData'), 'nanobot-workspace', '.nanobot', 'config.json');
  fs.access(earlyConfigPath).then(() => {
    console.log('[Main] Config found — pre-starting nanobot bridge...');
    pythonBridge.start().then(() => {
      console.log('[Main] nanobot bridge pre-started successfully');
    }).catch((err) => {
      console.warn('[Main] nanobot bridge pre-start failed (renderer will retry via sync-config):', err.message);
    });
  }).catch(() => {
    console.log('[Main] No existing config, waiting for renderer to push settings via nanobot:sync-config');
  });

})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
