import { MockExecutor, type ExecutorDelay } from '../agent/mock-executor.ts'
import { AgentOrchestrator } from '../agent/orchestrator.ts'
import { JsonRunRepository } from '../agent/repository.ts'
import type { AgentResult, RunListResult } from '../shared/agent.ts'
import { AGENT_IPC_CHANNELS } from '../shared/agent-ipc.ts'
import { createAgentLogger, type AgentLogger } from './agent-logger.ts'
import {
  isAllowedLiveAgentWebContents,
  type AgentLiveWebContents,
  type AgentSenderPolicy
} from './agent-ipc-security.ts'

export type AgentRuntimeOptions = {
  storageRoot: string
  senderPolicy: AgentSenderPolicy
  logger?: AgentLogger
  executorDelay?: ExecutorDelay
}

export type AgentRuntime = {
  orchestrator: AgentOrchestrator
  senderPolicy: AgentSenderPolicy
  recover(): Promise<AgentResult<RunListResult>>
  attachWebContents(webContents: AgentLiveWebContents): () => void
  dispose(): void
}

type AgentLifecycleRuntime = Pick<AgentRuntime, 'recover' | 'dispose'>

export type AgentRuntimeInitialization = {
  runtime: AgentLifecycleRuntime
  registerIpc(): () => void
  createWindow(): void
  onRecoveryFailure(): void
}

export type AgentWindowWebContents = AgentLiveWebContents & {
  on(event: 'did-finish-load' | 'destroyed', listener: () => void): unknown
}

export type AgentRuntimeWindow = {
  webContents: AgentWindowWebContents
  once(event: 'closed', listener: () => void): unknown
}

type AgentEventRuntime = Pick<AgentRuntime, 'senderPolicy' | 'attachWebContents'>

export const initializeAgentRuntime = async ({
  runtime,
  registerIpc,
  createWindow,
  onRecoveryFailure
}: AgentRuntimeInitialization): Promise<() => void> => {
  try {
    const recovered = await runtime.recover()
    if (typeof recovered === 'object' && recovered !== null && 'ok' in recovered && recovered.ok === false) {
      onRecoveryFailure()
    }
  } catch {
    onRecoveryFailure()
  }

  const disposeIpc = registerIpc()
  createWindow()
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    disposeIpc()
    runtime.dispose()
  }
}

export const bindAgentWindowForwarding = (
  window: AgentRuntimeWindow,
  runtime: AgentEventRuntime
): (() => void) => {
  let detach: (() => void) | undefined
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    detach?.()
    detach = undefined
  }
  const attachAfterLoad = (): void => {
    if (disposed) return
    detach?.()
    detach = undefined
    if (!isAllowedLiveAgentWebContents(window.webContents, runtime.senderPolicy)) return
    detach = runtime.attachWebContents(window.webContents)
  }

  window.webContents.on('did-finish-load', attachAfterLoad)
  window.webContents.on('destroyed', dispose)
  window.once('closed', dispose)
  return dispose
}

export const createAgentRuntime = ({
  storageRoot,
  senderPolicy,
  logger = createAgentLogger(),
  executorDelay
}: AgentRuntimeOptions): AgentRuntime => {
  const repository = new JsonRunRepository(storageRoot)
  const executor = new MockExecutor(executorDelay === undefined ? {} : { delay: executorDelay })
  const orchestrator = new AgentOrchestrator({ repository, executor })
  const targets = new Set<AgentLiveWebContents>()
  const unsubscribe = orchestrator.subscribe((event) => {
    logger.operation({ runId: event.runId, eventType: event.type, operation: 'event.forwarded' })
    for (const webContents of targets) {
      if (!isAllowedLiveAgentWebContents(webContents, senderPolicy)) {
        targets.delete(webContents)
        continue
      }
      try {
        webContents.send(AGENT_IPC_CHANNELS.event, structuredClone(event))
      } catch {
        targets.delete(webContents)
      }
    }
  })

  return {
    orchestrator,
    senderPolicy,
    async recover(): Promise<AgentResult<RunListResult>> {
      const startedAt = Date.now()
      const result = await orchestrator.recoverInterruptedRuns()
      logger.operation({
        operation: 'runtime.recover',
        durationMs: Date.now() - startedAt,
        errorCode: result.ok ? undefined : result.error.code
      })
      return result
    },
    attachWebContents: (webContents: AgentLiveWebContents): (() => void) => {
      if (!isAllowedLiveAgentWebContents(webContents, senderPolicy)) return () => undefined
      targets.add(webContents)
      return () => targets.delete(webContents)
    },
    dispose: () => {
      unsubscribe()
      targets.clear()
    }
  }
}
