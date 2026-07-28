import { onUnmounted, reactive, toRaw } from 'vue'

import type {
  AgentError,
  AgentEvent,
  AgentRun,
  RunLoadIssue,
  RunStatus
} from '../../../shared/agent.ts'
import type { AgentApi } from '../../../shared/agent-ipc.ts'

type HarnessAction = 'create' | 'approve' | 'cancel' | 'resume'

export type AgentHarnessState = {
  prompt: string
  runs: AgentRun[]
  issues: RunLoadIssue[]
  selectedRunId?: string
  loading: boolean
  action?: HarnessAction
  error?: AgentError
}

export type AgentHarnessController = {
  state: AgentHarnessState
  initialize(): Promise<void>
  retry(): Promise<void>
  dispose(): void
  selectRun(id: string): void
  runFor(id: string): AgentRun | undefined
  create(): Promise<boolean>
  approve(id: string): Promise<boolean>
  cancel(id: string): Promise<boolean>
  resume(id: string): Promise<boolean>
  canApprove(run?: AgentRun): boolean
  canCancel(run?: AgentRun): boolean
  canResume(run?: AgentRun): boolean
  readonly canRetry: boolean
}

const terminalStatuses = new Set<RunStatus>(['completed', 'cancelled', 'failed'])

const eventStatus: Partial<Record<AgentEvent['type'], RunStatus>> = {
  'run.created': 'queued',
  'run.started': 'running',
  'run.interrupted': 'interrupted',
  'run.resumed': 'running',
  'approval.requested': 'awaiting_approval',
  'approval.resolved': 'running',
  'run.completed': 'completed',
  'run.cancelled': 'cancelled',
  'run.failed': 'failed'
}

const invalidState = (message: string): AgentError => ({
  code: 'INVALID_STATE',
  message,
  retryable: false
})

const cloneRun = (run: AgentRun): AgentRun => structuredClone(toRaw(run))

const cloneEvent = (event: AgentEvent): AgentEvent => structuredClone(toRaw(event))

const latestSequence = (events: readonly AgentEvent[]): number =>
  events.reduce((latest, event) => Math.max(latest, event.sequence), 0)

const mergeEvents = (...eventLists: readonly (readonly AgentEvent[])[]): AgentEvent[] => {
  const bySequence = new Map<number, AgentEvent>()
  for (const events of eventLists) {
    for (const event of events) {
      if (!bySequence.has(event.sequence)) {
        bySequence.set(event.sequence, cloneEvent(event))
      }
    }
  }
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence)
}

const applyEvent = (run: AgentRun, event: AgentEvent): AgentRun => {
  if (event.sequence <= latestSequence(run.events)) return run

  const status = eventStatus[event.type] ?? run.status
  const output = { ...run.output }
  if (
    event.type === 'step.delta' &&
    (event.payload.phase === 'analysis' || event.payload.phase === 'final') &&
    typeof event.payload.text === 'string'
  ) {
    output[event.payload.phase] += event.payload.text
  }

  return {
    ...run,
    status,
    updatedAt: event.timestamp,
    output,
    events: [...run.events, cloneEvent(event)]
  }
}

const sortRuns = (runs: AgentRun[]): AgentRun[] =>
  [...runs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))

export const createAgentHarnessController = (api: AgentApi): AgentHarnessController => {
  const state = reactive<AgentHarnessState>({
    prompt: '',
    runs: [],
    issues: [],
    loading: false
  })
  const eventsByRun = new Map<string, AgentEvent[]>()
  let unsubscribe: (() => void) | undefined
  let disposed = false
  let eventQueue = Promise.resolve()

  const runFor = (id: string): AgentRun | undefined => state.runs.find((run) => run.id === id)

  const rememberEvents = (runId: string, events: readonly AgentEvent[]): AgentEvent[] => {
    const merged = mergeEvents(eventsByRun.get(runId) ?? [], events)
    eventsByRun.set(runId, merged)
    return merged
  }

  const replaceRun = (next: AgentRun): AgentRun => {
    const current = runFor(next.id)
    const base = current !== undefined && latestSequence(current.events) > latestSequence(next.events)
      ? cloneRun(current)
      : cloneRun(next)
    const known = new Set(base.events.map((event) => event.sequence))
    const events = rememberEvents(next.id, mergeEvents(current?.events ?? [], next.events))
    let merged = base
    for (const event of events) {
      if (!known.has(event.sequence)) {
        merged = applyEvent(merged, event)
      }
    }
    state.runs = sortRuns([
      ...state.runs.filter((run) => run.id !== next.id),
      merged
    ])
    return merged
  }

  const mergeKnownEvents = (runId: string): void => {
    const current = runFor(runId)
    if (current === undefined) return
    const known = new Set(current.events.map((event) => event.sequence))
    let merged = cloneRun(current)
    for (const event of eventsByRun.get(runId) ?? []) {
      if (!known.has(event.sequence)) {
        merged = applyEvent(merged, event)
        known.add(event.sequence)
      }
    }
    replaceRun(merged)
  }

  const setError = (error: AgentError): void => {
    state.error = structuredClone(error)
  }

  const refreshRun = async (runId: string): Promise<void> => {
    const result = await api.getRun(runId)
    if (disposed) return
    if (result.ok) {
      replaceRun(result.data)
    } else {
      setError(result.error)
    }
  }

  const receiveEvent = async (event: AgentEvent): Promise<void> => {
    if (disposed) return
    const current = runFor(event.runId)
    const last = current === undefined
      ? latestSequence(eventsByRun.get(event.runId) ?? [])
      : latestSequence(current.events)
    if (event.sequence <= last) return

    rememberEvents(event.runId, [event])
    if (event.sequence > last + 1) {
      const backfill = await api.getEvents(event.runId, last)
      if (disposed) return
      if (backfill.ok) {
        rememberEvents(event.runId, backfill.data)
        mergeKnownEvents(event.runId)
      } else {
        setError(backfill.error)
      }
      await refreshRun(event.runId)
      return
    }

    mergeKnownEvents(event.runId)
    if (current === undefined) {
      await refreshRun(event.runId)
    }
  }

  const loadRuns = async (): Promise<void> => {
    state.loading = true
    state.error = undefined
    const result = await api.listRuns()
    if (disposed) return
    state.loading = false
    if (!result.ok) {
      setError(result.error)
      return
    }

    state.issues = structuredClone(result.data.issues)
    for (const listed of result.data.runs) {
      replaceRun(listed)
    }
    if (state.selectedRunId === undefined && state.runs[0] !== undefined) {
      state.selectedRunId = state.runs[0].id
    }
  }

  const isActionAllowed = (id: string, action: Exclude<HarnessAction, 'create'>): boolean => {
    const run = runFor(id)
    const allowed = action === 'approve'
      ? run?.status === 'awaiting_approval'
      : action === 'resume'
        ? run?.status === 'interrupted'
        : run !== undefined && !terminalStatuses.has(run.status)
    if (!allowed) {
      setError(invalidState('This Run cannot perform the requested action in its current status.'))
    }
    return allowed
  }

  const command = async (
    id: string,
    action: Exclude<HarnessAction, 'create'>,
    invoke: () => ReturnType<AgentApi['approveRun']>
  ): Promise<boolean> => {
    if (!isActionAllowed(id, action)) return false
    state.action = action
    state.error = undefined
    const result = await invoke()
    if (!disposed) {
      state.action = undefined
      if (result.ok) {
        replaceRun(result.data)
      } else {
        setError(result.error)
      }
    }
    return result.ok
  }

  const controller: AgentHarnessController = {
    state,
    get canRetry() {
      return state.error?.retryable === true
    },
    async initialize() {
      if (unsubscribe === undefined) {
        unsubscribe = api.subscribeEvents((event) => {
          eventQueue = eventQueue.then(() => receiveEvent(event))
        })
      }
      await loadRuns()
      await eventQueue
    },
    async retry() {
      await loadRuns()
    },
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe?.()
      unsubscribe = undefined
    },
    selectRun(id) {
      if (runFor(id) !== undefined) {
        state.selectedRunId = id
      }
    },
    runFor,
    async create() {
      const prompt = state.prompt.trim()
      if (prompt === '') {
        setError({ code: 'VALIDATION_ERROR', message: 'Prompt is required before creating a Run.', retryable: false })
        return false
      }
      state.action = 'create'
      state.error = undefined
      const result = await api.createRun(prompt)
      if (!disposed) {
        state.action = undefined
        if (result.ok) {
          replaceRun(result.data)
          state.selectedRunId = result.data.id
          state.prompt = ''
        } else {
          setError(result.error)
        }
      }
      return result.ok
    },
    approve: (id) => command(id, 'approve', () => api.approveRun(id)),
    cancel: (id) => command(id, 'cancel', () => api.cancelRun(id)),
    resume: (id) => command(id, 'resume', () => api.resumeRun(id)),
    canApprove: (run) => run?.status === 'awaiting_approval',
    canCancel: (run) => run !== undefined && !terminalStatuses.has(run.status),
    canResume: (run) => run?.status === 'interrupted'
  }

  return controller
}

export const useAgentHarness = (): AgentHarnessController => {
  const controller = createAgentHarnessController(window.openNovel.agent)
  onUnmounted(controller.dispose)
  return controller
}
