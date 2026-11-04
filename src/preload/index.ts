import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppEvent, Bridge } from '../shared/types'
const bridge: Bridge = {
  async attachFiles(projectId, files) {
    return bridge.invoke({
      op: 'attachment.read',
      projectId,
      paths: files.map((file) => webUtils.getPathForFile(file)),
    })
  },
  async invoke<T>(request: Record<string, unknown>): Promise<T> {
    const result = (await ipcRenderer.invoke('agenthub:invoke', request)) as {
      ok: boolean
      value?: T
      error?: string
    }
    if (!result.ok) throw new Error(result.error || 'Host operation failed')
    return result.value as T
  },
  subscribe(callback) {
    const listener = (_event: Electron.IpcRendererEvent, payload: AppEvent) => callback(payload)
    ipcRenderer.on('agenthub:event', listener)
    return () => ipcRenderer.removeListener('agenthub:event', listener)
  },
}
contextBridge.exposeInMainWorld('agenthub', bridge)
