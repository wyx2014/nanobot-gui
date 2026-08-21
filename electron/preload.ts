import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  // Electron 32+ no longer exposes the non-standard `File.path` property to
  // renderer code. Resolve dropped files in preload with the supported API so
  // drag-and-drop and the native file picker both produce absolute paths.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if electron isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in d.ts)
  window.electron = electronAPI
  // @ts-ignore (define in d.ts)
  window.api = api
}

contextBridge.exposeInMainWorld('ipc', {
  send: (channel: string, data: any) => ipcRenderer.send(channel, data),
  invoke: (channel: string, data?: any) => ipcRenderer.invoke(channel, data),
  on: (channel: string, func: (...args: any[]) => void) => {
    const subscription = (_event: any, ...args: any[]) => func(...args)
    ipcRenderer.on(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  }
})
