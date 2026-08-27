/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * IPC Factory - Abstracts the communication layer for Electron.
 */

interface IPCBridge {
  invoke<T>(channel: string, args?: any): Promise<T>;
  on(channel: string, callback: (...args: any[]) => void): () => void;
}

export const isElectron = true;

const electronBridge: IPCBridge = {
  invoke: async <T>(channel: string, args?: any): Promise<T> => {
    console.log(`[Electron IPC] Invoking ${channel}`, args);
    return window.ipc.invoke(channel, args);
  },
  on: (channel: string, callback: (...args: any[]) => void) => {
    return window.ipc.on(channel, callback);
  }
};

export const ipc = electronBridge;

export const fsBridge = {
  readTextFile: async (path: string): Promise<string> => {
    return window.ipc.invoke('fs:readTextFile', path);
  },
  writeTextFile: async (path: string, content: string): Promise<void> => {
    return window.ipc.invoke('fs:writeTextFile', { path, content });
  },
  mkdir: async (path: string, options?: { recursive?: boolean }): Promise<void> => {
    return window.ipc.invoke('fs:mkdir', { path, options });
  },
  remove: async (path: string, options?: { recursive?: boolean }): Promise<void> => {
    return window.ipc.invoke('fs:remove', { path, options });
  },
  readFile: async (path: string): Promise<Uint8Array> => {
    return window.ipc.invoke('fs:readFile', path);
  },
  writeFile: async (path: string, data: Uint8Array): Promise<void> => {
    return window.ipc.invoke('fs:writeFile', { path, data: Array.from(data) });
  },
  readDir: async (path: string): Promise<any[]> => {
    return window.ipc.invoke('fs:readDir', path);
  },
  exists: async (path: string): Promise<boolean> => {
    return window.ipc.invoke('fs:exists', path);
  },
  watch: async (path: string, callback: (event: any) => void, _options?: { recursive?: boolean }): Promise<() => void> => {
    return window.ipc.on(`fs:watch:${path}`, callback);
  },
  lstat: async (path: string): Promise<any> => {
    return window.ipc.invoke('fs:lstat', path);
  }
};

export const osBridge = {
  platform: async (): Promise<string> => {
    const p = await window.ipc.invoke('os:platform') as string;
    if (p === 'darwin') return 'macos';
    if (p === 'win32') return 'windows';
    return p;
  },
  homeDir: async (): Promise<string> => {
    return window.ipc.invoke('os:homeDir');
  },
  desktopDir: async (): Promise<string> => {
    return window.ipc.invoke('os:desktopDir');
  },
  documentDir: async (): Promise<string> => {
    return window.ipc.invoke('os:documentDir');
  },
  downloadDir: async (): Promise<string> => {
    return window.ipc.invoke('os:downloadDir');
  },
  appDataDir: async (): Promise<string> => {
    return window.ipc.invoke('os:appDataDir');
  },
  resolve: async (path: string): Promise<string> => {
    return window.ipc.invoke('os:resolve', path);
  },
  resolveResource: async (path: string): Promise<string> => {
    return window.ipc.invoke('os:resolveResource', path);
  },
  openTerminal: async (cwd?: string): Promise<void> => {
    return window.ipc.invoke('shell:openTerminal', cwd);
  }
};

export type MicrophonePermissionStatus =
  | 'not-determined'
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'unknown'
  | 'not-applicable';

export const mediaBridge = {
  requestMicrophoneAccess: async (): Promise<{
    granted: boolean;
    status: MicrophonePermissionStatus;
    development?: boolean;
  }> => {
    return window.ipc.invoke('media:requestMicrophoneAccess');
  },
  openMicrophoneSettings: async (): Promise<boolean> => {
    return window.ipc.invoke('media:openMicrophoneSettings');
  },
};

export const dialogBridge = {
  open: async (options: any): Promise<any> => {
    return window.ipc.invoke('dialog:open', options);
  },
  save: async (options: any): Promise<any> => {
    return window.ipc.invoke('dialog:save', options);
  }
};

export const shellBridge = {
  open: async (url: string): Promise<void> => {
    return window.ipc.invoke('shell:open', url);
  },
  openPath: async (path: string): Promise<void> => {
    return window.ipc.invoke('shell:openPath', path);
  },
  revealItemInDir: async (path: string): Promise<void> => {
    return window.ipc.invoke('shell:reveal', path);
  }
};

export const notificationBridge = {
  sendNotification: async (options: string | { title: string; body?: string; conversationId?: string; scheduleTaskId?: string; runId?: string }): Promise<{ shown: boolean; reason?: string }> => {
    return window.ipc.invoke('notification:send', options);
  },
  isPermissionGranted: async (): Promise<boolean> => {
    return window.ipc.invoke('notification:is-supported');
  },
  requestPermission: async (): Promise<string> => {
    const supported = await window.ipc.invoke<boolean>('notification:is-supported');
    return supported ? 'granted' : 'denied';
  }
};

export const clipboardBridge = {
  writeText: async (text: string): Promise<void> => {
    return window.ipc.invoke('clipboard:writeText', text);
  },
  readText: async (): Promise<string> => {
    return window.ipc.invoke('clipboard:readText');
  }
};

export type EditCommand = 'undo' | 'cut' | 'copy' | 'paste' | 'selectAll';

export const windowBridge = {
  getInstallationId: async (): Promise<string> => {
    return window.ipc.invoke('app:installationId');
  },
  setTitle: async (title: string): Promise<void> => {
    return window.ipc.invoke('window:setTitle', title);
  },
  setBackgroundColor: async (color: string): Promise<void> => {
    return window.ipc.invoke('window:setBackgroundColor', color);
  },
  setTitleBarOverlayTheme: async (dark: boolean): Promise<boolean> => {
    return window.ipc.invoke('window:setTitleBarOverlayTheme', dark);
  },
  isFullScreen: async (): Promise<boolean> => {
    return window.ipc.invoke('window:isFullScreen');
  },
  onFullScreenChanged: (callback: (isFullScreen: boolean) => void): (() => void) => {
    return window.ipc.on('event:window-full-screen-changed', callback);
  },
  performEditCommand: async (command: EditCommand): Promise<boolean> => {
    return window.ipc.invoke('window:performEditCommand', command);
  },
  closeWindow: async (): Promise<boolean> => {
    return window.ipc.invoke('window:close');
  },
  openLogsDirectory: async (): Promise<boolean> => {
    return window.ipc.invoke('window:openLogsDirectory');
  },
};

// Event bridge for listening to system-wide events.
export const eventBridge = {
  listen: async (event: string, handler: (payload: any) => void): Promise<() => void> => {
    return window.ipc.on(`event:${event}`, handler);
  }
};
