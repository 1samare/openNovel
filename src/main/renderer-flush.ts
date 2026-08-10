import { randomUUID } from 'node:crypto'
import {
  RENDERER_FLUSH_IPC_CHANNELS,
  isRendererFlushRequestId
} from '../shared/renderer-flush.ts'
import {
  isAllowedAgentIpcSender,
  isAllowedLiveAgentWebContents,
  type AgentIpcSenderEvent,
  type AgentLiveWebContents,
  type AgentSenderPolicy
} from './agent-ipc-security.ts'

type RendererFlushIpcMain = {
  on(channel: string, listener: (event: AgentIpcSenderEvent, ...args: unknown[]) => void): unknown
  removeListener(channel: string, listener: (event: AgentIpcSenderEvent, ...args: unknown[]) => void): unknown
}

type PendingFlush = {
  target: AgentLiveWebContents
  timer: ReturnType<typeof setTimeout>
  resolve(saved: boolean): void
}

export type RendererFlushCoordinator = {
  requestFlush(targets: Iterable<AgentLiveWebContents>): Promise<boolean>
  dispose(): void
}

type ForceCloseWindow = {
  isDestroyed(): boolean
  destroy(): void
}

export const destroyWindowsForForcedExit = (windows: Iterable<ForceCloseWindow>): void => {
  for (const window of windows) {
    if (!window.isDestroyed()) window.destroy()
  }
}

export class RendererFlushError extends Error {
  constructor() {
    super('Renderer did not confirm that all editor changes were saved')
    this.name = 'RendererFlushError'
  }
}

export const createRendererFlushCoordinator = (options: {
  ipcMain: RendererFlushIpcMain
  senderPolicy: AgentSenderPolicy
  timeoutMs?: number
  createRequestId?: () => string
}): RendererFlushCoordinator => {
  const timeoutMs = options.timeoutMs ?? 10_000
  const createRequestId = options.createRequestId ?? randomUUID
  const pending = new Map<string, PendingFlush>()
  let disposed = false

  const settle = (requestId: string, saved: boolean): void => {
    const request = pending.get(requestId)
    if (request === undefined) return
    pending.delete(requestId)
    clearTimeout(request.timer)
    request.resolve(saved)
  }

  const handleResult = (
    event: AgentIpcSenderEvent,
    requestId: unknown,
    saved: unknown
  ): void => {
    if (
      !isRendererFlushRequestId(requestId) ||
      typeof saved !== 'boolean' ||
      !isAllowedAgentIpcSender(event, options.senderPolicy)
    ) return
    const request = pending.get(requestId)
    if (request === undefined || request.target !== event.sender) return
    settle(requestId, saved)
  }

  options.ipcMain.on(RENDERER_FLUSH_IPC_CHANNELS.result, handleResult)

  const requestOne = (target: AgentLiveWebContents): Promise<boolean> => {
    if (disposed || !isAllowedLiveAgentWebContents(target, options.senderPolicy)) {
      return Promise.resolve(false)
    }
    const requestId = createRequestId()
    if (!isRendererFlushRequestId(requestId) || pending.has(requestId)) {
      return Promise.resolve(false)
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(requestId, false), timeoutMs)
      pending.set(requestId, { target, timer, resolve })
      try {
        target.send(RENDERER_FLUSH_IPC_CHANNELS.request, requestId)
      } catch {
        settle(requestId, false)
      }
    })
  }

  return {
    requestFlush: async (targets) => {
      const activeTargets = [...targets].filter((target) => !target.isDestroyed())
      if (activeTargets.length === 0) return true
      const results = await Promise.all(activeTargets.map(requestOne))
      return results.every(Boolean)
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      options.ipcMain.removeListener(RENDERER_FLUSH_IPC_CHANNELS.result, handleResult)
      for (const requestId of [...pending.keys()]) settle(requestId, false)
    }
  }
}
