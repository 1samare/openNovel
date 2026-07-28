export type RunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'interrupted'

export type AgentErrorCode =
  | 'VALIDATION_ERROR'
  | 'RUN_NOT_FOUND'
  | 'INVALID_STATE'
  | 'PERSISTENCE_FAILED'
  | 'EXECUTION_FAILED'
  | 'IPC_FORBIDDEN'

export type AgentError = {
  code: AgentErrorCode
  message: string
  retryable: boolean
}

export type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export type AgentEventType =
  | 'run.created'
  | 'run.started'
  | 'run.interrupted'
  | 'run.resumed'
  | 'run.completed'
  | 'run.cancelled'
  | 'run.failed'
  | 'step.started'
  | 'step.delta'
  | 'step.completed'
  | 'approval.requested'
  | 'approval.resolved'

export type AgentEvent = {
  runId: string
  sequence: number
  type: AgentEventType
  timestamp: string
  payload: { [key: string]: JsonValue }
}

export type AgentOutput = {
  analysis: string
  final: string
}

export type AgentCheckpoint = {
  phase: 'analysis' | 'final'
  nextChunkIndex: number
}

export type AgentRun = {
  id: string
  prompt: string
  status: RunStatus
  createdAt: string
  updatedAt: string
  events: AgentEvent[]
  output: AgentOutput
  checkpoint: AgentCheckpoint
  error?: AgentError
}

export type RunLoadIssue = {
  id: string
  code: 'CORRUPT_JSON' | 'UNSUPPORTED_SCHEMA' | 'INVALID_RUN' | 'READ_FAILED'
  message: string
}

export type RunListResult = {
  runs: AgentRun[]
  issues: RunLoadIssue[]
}

export type AgentResult<T> =
  | {
      ok: true
      data: T
    }
  | {
      ok: false
      error: AgentError
    }
