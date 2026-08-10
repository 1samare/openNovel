import {
  RENDERER_FLUSH_IPC_CHANNELS,
  isRendererFlushRequestId,
  type RendererFlushApi
} from '../shared/renderer-flush.ts'

export type RendererFlushIpcRenderer = {
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
  send(channel: string, ...args: unknown[]): void
}

export const createRendererFlushApi = (
  ipcRenderer: RendererFlushIpcRenderer
): RendererFlushApi => ({
  onFlushRequest: (listener) => {
    const handleRequest = (_event: unknown, requestId: unknown): void => {
      if (isRendererFlushRequestId(requestId)) listener(requestId)
    }
    ipcRenderer.on(RENDERER_FLUSH_IPC_CHANNELS.request, handleRequest)
    return () => ipcRenderer.removeListener(RENDERER_FLUSH_IPC_CHANNELS.request, handleRequest)
  },
  completeFlush: (requestId, saved) => {
    if (!isRendererFlushRequestId(requestId) || typeof saved !== 'boolean') return
    ipcRenderer.send(RENDERER_FLUSH_IPC_CHANNELS.result, requestId, saved)
  }
})
