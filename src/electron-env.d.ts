export interface IpcBridge {
  send: (channel: string, data: any) => void;
  invoke: <T>(channel: string, data?: any) => Promise<T>;
  on: (channel: string, func: (...args: any[]) => void) => () => void;
}

export interface DesktopApiBridge {
  getPathForFile: (file: File) => string;
}

declare global {
  interface Window {
    ipc: IpcBridge;
    electron: any; // From @electron-toolkit/preload
    api: DesktopApiBridge;
  }
}
