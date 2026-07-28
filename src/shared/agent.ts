export type RunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'interrupted'

export type AgentErrorCode =
  | 'INVALID_PROMPT'
  | 'INVALID_STATE'
  | 'INVALID_RUN'
  | 'EXECUTION_FAILED'
  | 'UNEXPECTED_ERROR'

export type AgentError = {
  code: AgentErrorCode
  message: string
}

export type AgentEvent =
  | {
      sequence: number
      type: 'status_changed'
      at: string
      status: RunStatus
    }
  | {
      sequence: number
      type: 'chunk'
      at: string
      phase: 'analysis' | 'final'
      text: string
    }
  | {
      sequence: number
      type: 'approval_requested'
      at: string
    }
  | {
      sequence: number
      type: 'failed'
      at: string
      error: AgentError
    }

export type AgentRun = {
  id: string
  prompt: string
  status: RunStatus
  createdAt: string
  updatedAt: string
  events: AgentEvent[]
  result?: string
  error?: AgentError
}

export type AgentResult<T> =
  | {
      ok: true
      value: T
    }
  | {
      ok: false
      error: AgentError
    }
