import { app, shell, BrowserWindow, ipcMain, systemPreferences, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import fs from 'fs/promises'
import { mkdirSync } from 'fs'
import { exec, spawn } from 'child_process'
import os from 'os'
import { pythonBridge } from './pythonBridge'
import { syncNanobotConfig, type NanobotConfigInput } from './nanobotConfig'
import { MermaidBridge } from './mermaidBridge'
import {
  getMainWindowChrome,
  MAIN_WINDOW_BACKGROUND,
  MAIN_WINDOW_BOUNDS,
  WINDOWS_TITLE_BAR_DARK,
  WINDOWS_TITLE_BAR_HEIGHT,
  WINDOWS_TITLE_BAR_LIGHT,
} from './mainWindowConfig'
import { getOpenDialogProperties } from './dialogOptions'
import { deviceLinkBridge } from './deviceLinkBridge'
import { acquireSingleInstanceLock, restoreAndFocusWindow } from './singleInstance'
import { createWindowsTerminalLaunchSpec } from './terminalLauncher'
import { showDesktopNotification, type DesktopNotificationInput } from './desktopNotification'
import { ensureInstallationId } from './installationIdentity'
import {
  closeToTrayNoticePreferences,
  hasSeenCloseToTrayNoticeForInstallation,
  type WindowPreferences,
} from './installScopedPreferences'
import {
  applicationUserDataPath,
  defaultWorkspacePath,
  migrateLegacyApplicationData,
  migrateLegacyDefaultWorkspace,
  migrateLegacyUserProjects,
  migratePersistedWorkspaceReferences,
  type DirectoryMigrationResult,
} from './appDataMigration'
import {
  DEFAULT_WORKSPACE_DIRECTORY_NAME,
  LEGACY_APPLICATION_DATA_DIRECTORY_NAME,
  LEGACY_DEFAULT_WORKSPACE_DIRECTORY_NAME,
  LEGACY_USER_PROJECTS_DIRECTORY_NAME,
  USER_PROJECTS_DIRECTORY_NAME,
} from '../src/config/appDirectories'

import { electronApp, optimizer } from '@electron-toolkit/utils'

const isDev = typeof app !== 'undefined' ? !app.isPackaged : (process.env.NODE_ENV === 'development')
app.setName('TPACowork')

const mainProcessStartedAt = Date.now() - Math.round(process.uptime() * 1000);

function recordMainStartupEvent(message: string): void {
  const annotated = `${message} (+${Date.now() - mainProcessStartedAt}ms from process start)`;
  console.log(`[Main] ${annotated}`);
  pythonBridge.recordMainStartupEvent(annotated);
}

function reportDirectoryMigration(label: string, result: DirectoryMigrationResult): void {
  if (result.status === 'not-found') return;
  console.log(`[Main] ${label} migration ${result.status}:`, {
    from: result.source,
    to: result.target,
    conflicts: result.conflictsDirectory,
  });
}

const appDataRoot = app.getPath('appData');
const configuredUserDataPath = applicationUserDataPath(appDataRoot);
try {
  reportDirectoryMigration('Application data', migrateLegacyApplicationData(appDataRoot));
} catch (error) {
  console.error('[Main] Failed to migrate legacy application data:', error);
}
mkdirSync(configuredUserDataPath, { recursive: true });
app.setPath('userData', configuredUserDataPath);
recordMainStartupEvent('Main module initialized and userData configured');

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
let mainWindow: BrowserWindow | null = null;
let mainWindowReady = false;
let pendingInstanceActivation = false;
let appTray: Tray | null = null;
let closeToTrayNoticeSeen: boolean | null = null;
let closeToTrayNoticeSending = false;
let installationIdPromise: Promise<string> | null = null;

const windowPreferencesPath = join(configuredUserDataPath, 'window-preferences.json');

function getInstallationId(): Promise<string> {
  if (!installationIdPromise) {
    installationIdPromise = ensureInstallationId(configuredUserDataPath, app.isPackaged)
      .catch((error) => {
        console.warn('[Main] Failed to resolve installation identity:', error);
        return `fallback-installation-${app.getVersion()}`;
      });
  }
  return installationIdPromise;
}

async function hasSeenCloseToTrayNotice(installationId: string): Promise<boolean> {
  if (closeToTrayNoticeSeen !== null) return closeToTrayNoticeSeen;
  try {
    const saved = JSON.parse(
      await fs.readFile(windowPreferencesPath, 'utf-8'),
    ) as WindowPreferences;
    closeToTrayNoticeSeen = hasSeenCloseToTrayNoticeForInstallation(
      saved,
      installationId,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[Main] Failed to read window preferences:', error);
    }
    closeToTrayNoticeSeen = false;
  }
  return closeToTrayNoticeSeen;
}

async function rememberCloseToTrayNotice(installationId: string): Promise<void> {
  closeToTrayNoticeSeen = true;
  try {
    await fs.writeFile(
      windowPreferencesPath,
      `${JSON.stringify(closeToTrayNoticePreferences(installationId), null, 2)}\n`,
      'utf-8',
    );
  } catch (error) {
    console.warn('[Main] Failed to save window preferences:', error);
  }
}

async function handleCloseToTray(win: BrowserWindow): Promise<void> {
  if (closeToTrayNoticeSending || win.isDestroyed()) return;
  closeToTrayNoticeSending = true;
  try {
    const installationId = await getInstallationId();
    const shouldNotify = !(await hasSeenCloseToTrayNotice(installationId));
    if (shouldNotify) await rememberCloseToTrayNotice(installationId);
    if (!win.isDestroyed()) win.hide();
    if (!shouldNotify) return;

    const isChinese = app.getLocale().toLowerCase().startsWith('zh');
    const { Notification } = await import('electron');
    // Do not provide an explicit icon: macOS then uses the compact application
    // badge in the notification header instead of showing a large content icon.
    showDesktopNotification({
      title: isChinese ? 'TPACowork 已在后台运行' : 'TPACowork is running in the background',
      body: isChinese
        ? '窗口已收起到菜单栏，点击图标可随时重新打开。'
        : 'The window is in the menu bar. Click its icon to reopen it anytime.',
    }, {
      supported: Notification.isSupported(),
      create: ({ title, body }) => new Notification({ title, body }),
      activate: () => restoreAndFocusWindow(win),
    });
  } finally {
    closeToTrayNoticeSending = false;
  }
}

function applicationIconPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'app-icon.png');
  return process.platform === 'darwin'
    ? join(process.cwd(), 'resources/icons/TPACowork-macos.png')
    : join(process.cwd(), 'TPACowork-3_512x512.png');
}

function createWindow(): void {
  const windowStartedAt = Date.now();
  recordMainStartupEvent('Creating BrowserWindow');
  mainWindowReady = false;
  const win = new BrowserWindow({
    ...MAIN_WINDOW_BOUNDS,
    ...getMainWindowChrome(process.platform),
    show: false,
    autoHideMenuBar: true,
    icon: applicationIconPath(),
    backgroundColor: MAIN_WINDOW_BACKGROUND,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      webSecurity: false
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => {
    recordMainStartupEvent(`BrowserWindow ready to show in ${Date.now() - windowStartedAt}ms`);
    mainWindowReady = true;
    win.show()
    if (pendingInstanceActivation) {
      pendingInstanceActivation = false;
      win.focus();
    }
  })

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
      mainWindowReady = false;
    }
  });

  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      void handleCloseToTray(win);
    }
  });

  const publishFullScreenState = () => {
    if (win.isDestroyed()) return;
    win.webContents.send('event:window-full-screen-changed', win.isFullScreen());
  };
  win.on('enter-full-screen', publishFullScreenState);
  win.on('leave-full-screen', publishFullScreenState);

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showMainWindow(): void {
  if (restoreAndFocusWindow(mainWindow)) return;
  createWindow();
}

function activatePrimaryInstance(): void {
  // A second launch can arrive while the primary process is still preparing
  // the gateway and its first BrowserWindow. Defer activation until the
  // existing window is ready instead of creating a competing window.
  if (!mainWindowReady || !mainWindow || mainWindow.isDestroyed()) {
    pendingInstanceActivation = true;
    return;
  }
  showMainWindow();
}

function createTray(): void {
  if (appTray) return;
  let icon = nativeImage.createFromPath(applicationIconPath());
  if (process.platform === 'darwin') {
    // macOS menu bar expects a small icon; resize to a reasonable size.
    icon = icon.resize({ width: 18, height: 18 });
  }
  const tray = new Tray(icon);
  appTray = tray;
  tray.setToolTip('TPACowork');
  tray.on('click', showMainWindow);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主界面', click: showMainWindow },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]));
}

const isPrimaryInstance = acquireSingleInstanceLock(app, activatePrimaryInstance);

if (isPrimaryInstance) {
  try {
    reportDirectoryMigration(
      'Default workspace',
      migrateLegacyDefaultWorkspace(configuredUserDataPath),
    );
  } catch (error) {
    console.error('[Main] Failed to migrate legacy default workspace:', error);
  }
}

async function startApplication(): Promise<void> {
  await app.whenReady();
  recordMainStartupEvent('app.whenReady fired');

  const workspacePreparationStartedAt = Date.now();
  try {
    reportDirectoryMigration('User projects', migrateLegacyUserProjects(app.getPath('documents')));
  } catch (error) {
    console.error('[Main] Failed to migrate legacy user projects:', error);
  }

  try {
    const workspace = defaultWorkspacePath(configuredUserDataPath);
    const pathMigration = migratePersistedWorkspaceReferences(workspace, [
      {
        source: join(
          appDataRoot,
          LEGACY_APPLICATION_DATA_DIRECTORY_NAME,
          LEGACY_DEFAULT_WORKSPACE_DIRECTORY_NAME,
        ),
        target: workspace,
      },
      {
        source: join(configuredUserDataPath, LEGACY_DEFAULT_WORKSPACE_DIRECTORY_NAME),
        target: workspace,
      },
      {
        source: join(app.getPath('documents'), LEGACY_USER_PROJECTS_DIRECTORY_NAME),
        target: join(app.getPath('documents'), USER_PROJECTS_DIRECTORY_NAME),
      },
    ]);
    if (pathMigration.updatedFiles > 0) {
      console.log('[Main] Persisted workspace path migration completed:', pathMigration);
    }
  } catch (error) {
    console.error('[Main] Failed to migrate persisted workspace paths:', error);
  }
  recordMainStartupEvent(
    `Startup workspace preparation finished in ${Date.now() - workspacePreparationStartedAt}ms`,
  );

  if (process.platform === 'darwin' && isDev) {
    app.dock.setIcon(applicationIconPath());
  }
  
  app.on('before-quit', async (e) => {
    if (!isQuitting) {
      isQuitting = true;
      e.preventDefault();
      console.log('[Main] Gracefully stopping nanobot before quit...');
      appTray?.destroy();
      appTray = null;
      deviceLinkBridge.stop();
      await pythonBridge.stop();
      app.quit();
    }
  });
  const userData = app.getPath('userData');
  const mermaidBridge = new MermaidBridge();
  const mermaidStartedAt = Date.now();
  await mermaidBridge.start();
  recordMainStartupEvent(`Local render bridge started in ${Date.now() - mermaidStartedAt}ms`);
  pythonBridge.setMermaidRenderer(mermaidBridge.url, mermaidBridge.token);
  pythonBridge.setPdfRenderer(mermaidBridge.pdfUrl, mermaidBridge.token);
  pythonBridge.setHtmlRenderer(mermaidBridge.htmlUrl, mermaidBridge.token);
  console.log('[Main] UserData Path:', userData);

  // Start the Python runtime as soon as its renderer endpoints are known.
  // IPC registration and BrowserWindow loading continue in parallel, so the
  // renderer no longer has to begin the expensive Python cold start itself.
  const earlyConfigPath = join(
    userData,
    DEFAULT_WORKSPACE_DIRECTORY_NAME,
    '.nanobot',
    'config.json',
  );
  void fs.access(earlyConfigPath).then(() => {
    console.log('[Main] Config found — pre-starting nanobot bridge...');
    return pythonBridge.start();
  }).then(() => {
    console.log('[Main] nanobot bridge pre-started successfully');
  }).catch((err) => {
    if (err?.code === 'ENOENT') {
      console.log('[Main] No existing config, waiting for renderer to push settings via nanobot:sync-config');
      return;
    }
    console.warn('[Main] nanobot bridge pre-start failed (renderer will retry via sync-config):', err?.message ?? err);
  });

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

  safeInvoke('fs:writeFile', async (data) => {
    const path = data?.path;
    const bytes = data?.data;
    if (!path) throw new Error('fs:writeFile failed: path is missing');
    if (!Array.isArray(bytes)) throw new Error('fs:writeFile failed: data must be a byte array');
    const { dirname } = await import('path');
    await fs.mkdir(dirname(path), { recursive: true });
    return await fs.writeFile(path, Buffer.from(bytes));
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

  safeInvoke('device-link:configure', async (data) => {
    const baseUrl = typeof data?.baseUrl === 'string' ? data.baseUrl : '';
    const token = typeof data?.token === 'string' ? data.token : '';
    return deviceLinkBridge.configure(baseUrl && token ? { baseUrl, token } : null);
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
    const root = pathMod.join(
      app.getPath('userData'),
      DEFAULT_WORKSPACE_DIRECTORY_NAME,
      'skills',
      name,
    );
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

  // Open a system terminal in the given directory (falls back to home).
  ipcMain.handle('shell:openTerminal', async (_, cwd?: string) => {
    const target = cwd?.trim();
    let dir = target && target.length > 0 ? target : os.homedir();
    try {
      const stat = await fs.stat(dir);
      if (!stat.isDirectory()) dir = os.homedir();
    } catch {
      dir = os.homedir();
    }

    if (process.platform === 'darwin') {
      // Prefer iTerm2 if installed, otherwise the built-in Terminal.
      const iTerm = '/Applications/iTerm.app';
      const terminal = fs.access(iTerm).then(() => 'iTerm').catch(() => 'Terminal');
      const appName = await terminal;
      spawn('open', ['-a', appName, dir], { stdio: 'ignore', detached: true }).unref();
    } else if (process.platform === 'win32') {
      const launch = createWindowsTerminalLaunchSpec(dir);
      spawn(launch.command, launch.args, launch.options).unref();
    } else {
      // Linux: try common terminal emulators with a working-directory flag.
      const launchers: Array<[string, string[]]> = [
        ['x-terminal-emulator', ['--working-directory', dir]],
        ['gnome-terminal', ['--working-directory', dir]],
        ['konsole', ['--workdir', dir]],
        ['xfce4-terminal', ['--working-directory', dir]],
      ];
      for (const [bin, args] of launchers) {
        try {
          const child = spawn(bin, args, { stdio: 'ignore', detached: true });
          child.on('error', () => {});
          child.unref();
          return;
        } catch {
          // try next
        }
      }
    }
  })

  ipcMain.handle('shell:reveal', async (_, path: string) => {
    shell.showItemInFolder(path)
  })

  ipcMain.handle('notification:is-supported', async () => {
    const { Notification } = await import('electron')
    return Notification.isSupported()
  })

  ipcMain.handle('notification:send', async (event, options: string | DesktopNotificationInput) => {
    const { Notification } = await import('electron')
    const sourceWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    return showDesktopNotification(options, {
      supported: Notification.isSupported(),
      activeWindow: Boolean(
        sourceWindow
        && !sourceWindow.isDestroyed()
        && sourceWindow.isVisible()
        && sourceWindow.isFocused()
      ),
      create: ({ title, body }) => new Notification({
        title,
        body,
      }),
      activate: (conversationId) => {
        const targetWindow = sourceWindow && !sourceWindow.isDestroyed()
          ? sourceWindow
          : mainWindow
        restoreAndFocusWindow(targetWindow)
        if (conversationId && targetWindow && !targetWindow.isDestroyed()) {
          targetWindow.webContents.send('notification:open-conversation', { conversationId })
        }
      },
    })
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
      properties: getOpenDialogProperties(options)
    }
    const result = await dialog.showOpenDialog(win, electronOptions)
    if (result.canceled) return null
    return options.multiple ? result.filePaths : result.filePaths[0]
  })

  safeInvoke('os:homeDir', async () => os.homedir());
  safeInvoke('os:platform', async () => process.platform);
  safeInvoke('app:installationId', async () => getInstallationId());
  safeInvoke('os:appDataDir', async () => app.getPath('userData'));
  safeInvoke('os:desktopDir', async () => app.getPath('desktop'));
  safeInvoke('os:documentDir', async () => app.getPath('documents'));
  safeInvoke('os:downloadDir', async () => app.getPath('downloads'));
  safeInvoke('media:requestMicrophoneAccess', async () => {
    if (process.platform !== 'darwin') {
      return { granted: true, status: 'not-applicable', development: !app.isPackaged };
    }
    let status = systemPreferences.getMediaAccessStatus('microphone');
    console.log('[Media] microphone permission before request', {
      status,
      appName: app.getName(),
      appPath: app.getAppPath(),
      packaged: app.isPackaged,
    });
    if (status === 'not-determined' || status === 'unknown') {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      status = systemPreferences.getMediaAccessStatus('microphone');
      console.log('[Media] microphone permission after request', { granted, status });
      return { granted, status, development: !app.isPackaged };
    }
    return {
      granted: status === 'granted',
      status,
      development: !app.isPackaged,
    };
  });
  safeInvoke('media:openMicrophoneSettings', async () => {
    if (process.platform !== 'darwin') return false;
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    );
    return true;
  });
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

  // Keep the native window background in sync with the renderer theme so the
  // window's composited background layer never flashes the other palette
  // during a theme switch (especially OS-triggered changes in "system" mode).
  ipcMain.handle('window:setBackgroundColor', (event, color: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) {
      win.setBackgroundColor(color)
    }
  })

  ipcMain.handle('window:setTitleBarOverlayTheme', (event, dark: boolean) => {
    if (process.platform !== 'win32') return false
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || typeof dark !== 'boolean') return false
    const colors = dark ? WINDOWS_TITLE_BAR_DARK : WINDOWS_TITLE_BAR_LIGHT
    win.setTitleBarOverlay({ ...colors, height: WINDOWS_TITLE_BAR_HEIGHT })
    return true
  })

  ipcMain.handle('window:isFullScreen', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false
  })

  ipcMain.handle('window:performEditCommand', (event, command: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    switch (command) {
      case 'undo':
        win.webContents.undo()
        break
      case 'cut':
        win.webContents.cut()
        break
      case 'copy':
        win.webContents.copy()
        break
      case 'paste':
        win.webContents.paste()
        break
      case 'selectAll':
        win.webContents.selectAll()
        break
      default:
        return false
    }
    return true
  })

  ipcMain.handle('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    win.close()
    return true
  })

  ipcMain.handle('window:openLogsDirectory', async () => {
    const error = await shell.openPath(app.getPath('userData'))
    if (error) throw new Error(error)
    return true
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

  // Process-lifetime diagnostics are recorded from launch; this call only
  // reveals the already-running buffer and the current nanobot.log tail.
  ipcMain.handle('nanobot:diagnostics', () => pythonBridge.getDiagnostics());

  // Renderer pushes settings → main syncs to nanobot config and (re)starts bridge
  ipcMain.handle('nanobot:sync-config', async (_, settings: NanobotConfigInput) => {
    try {
      const changed = await syncNanobotConfig(settings);
      let restarted = false;
      // A pre-start may already have read the previous config. Wait for that
      // shared start before restarting, otherwise restart() can race the
      // in-flight readiness poll and leave the renderer on stale settings.
      if (changed && pythonBridge.isStarting) {
        await pythonBridge.start();
      }
      if (pythonBridge.isReady && changed) {
        await pythonBridge.restart();
        restarted = true;
      } else if (!pythonBridge.isReady) {
        await pythonBridge.start();
      }
      return { ok: true, changed, restarted };
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
  createTray()

  app.on('activate', function () {
    // Re-show the existing window instead of recreating it, so the app can
    // be reopened from the Dock / taskbar after being hidden to the tray.
    showMainWindow()
  })

}

if (isPrimaryInstance) {
  void startApplication();
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
