import { MockExecutor } from '../agent/mock-executor.ts'
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
}

export type AgentRuntime = {
  orchestrator: AgentOrchestrator
  senderPolicy: AgentSenderPolicy
  recover(): Promise<AgentResult<RunListResult>>
  attachWebContents(webContents: AgentLiveWebContents): () => void
  dispose(): void
}

export const createAgentRuntime = ({
  storageRoot,
  senderPolicy,
  logger = createAgentLogger()
}: AgentRuntimeOptions): AgentRuntime => {
  const repository = new JsonRunRepository(storageRoot)
  const executor = new MockExecutor()
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
      targets.add(webContents)
      return () => targets.delete(webContents)
    },
    dispose: () => {
      unsubscribe()
      targets.clear()
    }
  }
}
