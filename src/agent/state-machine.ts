import type { AgentResult, AgentRun, RunStatus } from '../shared/agent.ts'

const legalTransitions: Record<RunStatus, RunStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['awaiting_approval', 'completed', 'cancelled', 'failed', 'interrupted'],
  awaiting_approval: ['running', 'cancelled'],
  completed: [],
  cancelled: [],
  failed: [],
  interrupted: ['running', 'cancelled']
}

export const canTransition = (from: RunStatus, to: RunStatus): boolean =>
  legalTransitions[from].includes(to)

export const transitionRun = (
  run: AgentRun,
  status: RunStatus,
  updatedAt: string
): AgentResult<AgentRun> => {
  if (!canTransition(run.status, status)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_STATE',
        message: `Cannot transition from ${run.status} to ${status}`
      }
    }
  }

  return {
    ok: true,
    value: {
      ...run,
      status,
      updatedAt
    }
  }
}
