import type { AgentErrorCode, AgentEventType, RunStatus } from '../shared/agent.ts'

export type AgentOperationLog = {
  operation: string
  runId?: string
  status?: RunStatus
  eventType?: AgentEventType
  durationMs?: number
  errorCode?: AgentErrorCode
  [key: string]: unknown
}

export type SafeAgentOperationLog = {
  operation: string
  runId?: string
  status?: RunStatus
  eventType?: AgentEventType
  durationMs?: number
  errorCode?: AgentErrorCode
}

export type AgentLogger = { operation(details: AgentOperationLog): void }

export const createAgentLogger = (
  sink: (record: SafeAgentOperationLog) => void = (record) => console.info(record)
): AgentLogger => ({
  operation: ({ operation, runId, status, eventType, durationMs, errorCode }) => {
    const record: SafeAgentOperationLog = { operation }
    if (runId !== undefined) record.runId = runId
    if (status !== undefined) record.status = status
    if (eventType !== undefined) record.eventType = eventType
    if (durationMs !== undefined) record.durationMs = durationMs
    if (errorCode !== undefined) record.errorCode = errorCode
    sink(record)
  }
})
