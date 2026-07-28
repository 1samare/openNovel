import { onUnmounted, reactive, toRaw } from 'vue'

import type {
  AgentError,
  AgentEvent,
  AgentResult,
  AgentRun,
  RunLoadIssue,
  RunStatus
} from '../../../shared/agent.ts'
import type { AgentApi } from '../../../shared/agent-ipc.ts'

type HarnessAction = 'create' | 'approve' | 'cancel' | 'resume'

type RetryOperation = {
  label: string
  retry: () => Promise<void>
}

export type AgentHarnessState = {
  prompt: string
  promptError?: string
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
  readonly retryLabel: string
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

const unexpectedFailure = (): AgentError => ({
  code: 'EXECUTION_FAILED',
  message: 'Agent operation failed unexpectedly.',
  retryable: true
})

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

const safely = async <T>(operation: () => Promise<AgentResult<T>>): Promise<AgentResult<T>> => {
  try {
    return await operation()
  } catch {
    return { ok: false, error: unexpectedFailure() }
  }
}

export const createAgentHarnessController = (api: AgentApi): AgentHarnessController => {
  const state = reactive<AgentHarnessState>({
    prompt: '',
    runs: [],
    issues: [],
    loading: false
  })
  const eventsByRun = new Map<string, AgentEvent[]>()
  const runVersions = new Map<string, number>()
  const refreshGenerations = new Map<string, number>()
  let unsubscribe: (() => void) | undefined
  let disposed = false
  let eventQueue = Promise.resolve()
  let loadGeneration = 0
  let commandLock: symbol | undefined
  let retryOperation: RetryOperation | undefined

  const runFor = (id: string): AgentRun | undefined => state.runs.find((run) => run.id === id)
  const runVersion = (id: string): number => runVersions.get(id) ?? 0
  const touchRun = (id: string): void => {
    runVersions.set(id, runVersion(id) + 1)
  }

  const clearError = (): void => {
    state.error = undefined
    retryOperation = undefined
  }

  const setError = (error: AgentError, retry?: RetryOperation): void => {
    state.error = structuredClone(error)
    retryOperation = error.retryable ? retry : undefined
  }

  const rememberEvents = (runId: string, events: readonly AgentEvent[]): AgentEvent[] => {
    const merged = mergeEvents(eventsByRun.get(runId) ?? [], events)
    eventsByRun.set(runId, merged)
    return merged
  }

  const replaceRun = (next: AgentRun, invalidatePending = true): AgentRun => {
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
    state.runs = sortRuns([...state.runs.filter((run) => run.id !== next.id), merged])
    if (invalidatePending) touchRun(next.id)
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

  const refreshRun = async (runId: string): Promise<void> => {
    const generation = (refreshGenerations.get(runId) ?? 0) + 1
    const version = runVersion(runId)
    refreshGenerations.set(runId, generation)
    const result = await safely(() => api.getRun(runId))
    if (
      disposed ||
      refreshGenerations.get(runId) !== generation ||
      runVersion(runId) !== version
    ) return

    if (result.ok) {
      replaceRun(result.data, false)
      return
    }
    setError(result.error, {
      label: '重试刷新 Run',
      retry: () => refreshRun(runId)
    })
  }

  const synchronizeGap = async (runId: string, afterSequence: number): Promise<void> => {
    const result = await safely(() => api.getEvents(runId, afterSequence))
    if (disposed) return
    if (!result.ok) {
      setError(result.error, {
        label: '重试同步事件',
        retry: () => synchronizeGap(runId, afterSequence)
      })
      return
    }
    rememberEvents(runId, result.data)
    mergeKnownEvents(runId)
    await refreshRun(runId)
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
      await synchronizeGap(event.runId, last)
      return
    }

    mergeKnownEvents(event.runId)
    if (current === undefined || event.type === 'run.failed') await refreshRun(event.runId)
  }

  const loadRuns = async (): Promise<void> => {
    const generation = ++loadGeneration
    state.loading = true
    clearError()
    try {
      const result = await safely(() => api.listRuns())
      if (disposed || generation !== loadGeneration) return
      if (!result.ok) {
        setError(result.error, { label: '重试加载', retry: loadRuns })
        return
      }
      state.issues = structuredClone(result.data.issues)
      for (const listed of result.data.runs) replaceRun(listed)
      if (state.selectedRunId === undefined && state.runs[0] !== undefined) {
        state.selectedRunId = state.runs[0].id
      }
    } finally {
      if (!disposed && generation === loadGeneration) state.loading = false
    }
  }

  const acquireCommand = (action: HarnessAction): symbol | undefined => {
    if (disposed || commandLock !== undefined) return undefined
    const token = Symbol(action)
    commandLock = token
    state.action = action
    return token
  }

  const releaseCommand = (token: symbol): void => {
    if (commandLock === token) {
      commandLock = undefined
      state.action = undefined
    }
  }

  const isActionAllowed = (id: string, action: Exclude<HarnessAction, 'create'>): boolean => {
    const run = runFor(id)
    return action === 'approve'
      ? run?.status === 'awaiting_approval'
      : action === 'resume'
        ? run?.status === 'interrupted'
        : run !== undefined && !terminalStatuses.has(run.status)
  }

  const performCommand = async (
    id: string,
    action: Exclude<HarnessAction, 'create'>,
    invoke: () => ReturnType<AgentApi['approveRun']>
  ): Promise<boolean> => {
    const token = acquireCommand(action)
    if (token === undefined) return false
    try {
      if (!isActionAllowed(id, action)) {
        setError(invalidState('This Run cannot perform the requested action in its current status.'))
        return false
      }
      clearError()
      const result = await safely(invoke)
      if (disposed || commandLock !== token) return false
      if (!result.ok) {
        setError(result.error, {
          label: action === 'approve' ? '重试审批' : action === 'cancel' ? '重试取消' : '重试恢复执行',
          retry: () => performCommand(id, action, invoke).then(() => undefined)
        })
        return false
      }
      replaceRun(result.data)
      return true
    } finally {
      releaseCommand(token)
    }
  }

  const performCreate = async (prompt: string): Promise<boolean> => {
    const token = acquireCommand('create')
    if (token === undefined) return false
    try {
      clearError()
      const result = await safely(() => api.createRun(prompt))
      if (disposed || commandLock !== token) return false
      if (!result.ok) {
        setError(result.error, {
          label: '重试创建 Run',
          retry: () => performCreate(prompt).then(() => undefined)
        })
        return false
      }
      replaceRun(result.data)
      state.selectedRunId = result.data.id
      state.prompt = ''
      state.promptError = undefined
      return true
    } finally {
      releaseCommand(token)
    }
  }

  const initialize = async (): Promise<void> => {
    if (disposed) return
    if (unsubscribe === undefined) {
      try {
        unsubscribe = api.subscribeEvents((event) => {
          eventQueue = eventQueue
            .catch(() => undefined)
            .then(() => receiveEvent(event))
            .catch(() => {
              if (!disposed) setError(unexpectedFailure())
            })
        })
      } catch {
        setError(unexpectedFailure(), { label: '重试连接', retry: initialize })
        return
      }
    }
    await loadRuns()
    await eventQueue
  }

  const retry = async (): Promise<void> => {
    const operation = retryOperation
    if (disposed) return
    if (operation === undefined) {
      if (state.loading) await loadRuns()
      return
    }
    retryOperation = undefined
    state.error = undefined
    await operation.retry()
  }

  const controller: AgentHarnessController = {
    state,
    get canRetry() {
      return retryOperation !== undefined && state.error?.retryable === true
    },
    get retryLabel() {
      return retryOperation?.label ?? '重试'
    },
    initialize,
    retry,
    dispose() {
      if (disposed) return
      disposed = true
      loadGeneration += 1
      commandLock = undefined
      retryOperation = undefined
      state.loading = false
      state.action = undefined
      unsubscribe?.()
      unsubscribe = undefined
    },
    selectRun(id) {
      if (runFor(id) !== undefined) state.selectedRunId = id
    },
    runFor,
    async create() {
      const prompt = state.prompt.trim()
      if (prompt === '') {
        state.promptError = '请输入 Prompt 后再创建 Run。'
        return false
      }
      state.promptError = undefined
      return performCreate(prompt)
    },
    approve: (id) => performCommand(id, 'approve', () => api.approveRun(id)),
    cancel: (id) => performCommand(id, 'cancel', () => api.cancelRun(id)),
    resume: (id) => performCommand(id, 'resume', () => api.resumeRun(id)),
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
