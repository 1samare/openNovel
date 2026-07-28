import { randomUUID } from 'node:crypto'

import type {
  AgentCheckpoint,
  AgentError,
  AgentEvent,
  AgentEventType,
  AgentResult,
  AgentRun,
  RunListResult,
  RunStatus
} from '../shared/agent.ts'
import { toAgentError } from './errors.ts'
import type { AgentExecutor } from './executor.ts'
import { MockExecutor } from './mock-executor.ts'
import type { RunRepository } from './repository.ts'
import { transitionRun } from './state-machine.ts'
import { validatePrompt } from './validation.ts'

export type AgentEventListener = (event: AgentEvent) => void

export type AgentOrchestratorOptions = {
  repository: RunRepository
  executor?: AgentExecutor
  clock?: () => string
  id?: () => string
}

const notFound = (): AgentResult<never> => ({
  ok: false,
  error: { code: 'RUN_NOT_FOUND', message: 'Run was not found', retryable: false }
})

const statusError = (from: RunStatus, to: RunStatus): AgentResult<never> => ({
  ok: false,
  error: {
    code: 'INVALID_STATE',
    message: `Cannot transition from ${from} to ${to}`,
    retryable: false
  }
})

const eventFor = (
  run: AgentRun,
  type: AgentEventType,
  timestamp: string,
  payload: AgentEvent['payload']
): AgentEvent => ({
  runId: run.id,
  sequence: run.events.length + 1,
  type,
  timestamp,
  payload
})

const hasApprovalProof = (run: AgentRun): boolean => {
  let lastRequested = -1
  for (let index = 0; index < run.events.length; index += 1) {
    if (run.events[index].type === 'approval.requested') {
      lastRequested = index
    }
  }
  return lastRequested >= 0 && run.events
    .slice(lastRequested + 1)
    .some((event) => event.type === 'approval.resolved')
}

const analysisChunkCount = (run: AgentRun): number =>
  run.events.filter(
    (event) => event.type === 'step.delta' && event.payload.phase === 'analysis'
  ).length

export class AgentOrchestrator {
  private readonly repository: RunRepository
  private readonly executor: AgentExecutor
  private readonly clock: () => string
  private readonly id: () => string
  private readonly runs = new Map<string, AgentRun>()
  private readonly listeners = new Set<AgentEventListener>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly controllers = new Map<string, AbortController>()

  constructor(options: AgentOrchestratorOptions) {
    this.repository = options.repository
    this.executor = options.executor ?? new MockExecutor()
    this.clock = options.clock ?? (() => new Date().toISOString())
    this.id = options.id ?? randomUUID
  }

  async createRun(prompt: unknown): Promise<AgentResult<AgentRun>> {
    const validated = validatePrompt(prompt)
    if (!validated.ok) {
      return validated
    }

    const timestamp = this.clock()
    const run: AgentRun = {
      id: this.id(),
      prompt: validated.data,
      status: 'queued',
      createdAt: timestamp,
      updatedAt: timestamp,
      events: [],
      output: { analysis: '', final: '' },
      checkpoint: { phase: 'analysis', nextChunkIndex: 0 }
    }
    const created = { ...run, events: [eventFor(run, 'run.created', timestamp, {})] }
    const persisted = await this.persist(created)
    if (!persisted.ok) {
      return persisted
    }

    void this.beginPhase(created.id, 'analysis', 'run.started')
    return { ok: true, data: created }
  }

  async getRun(id: string): Promise<AgentResult<AgentRun>> {
    const loaded = await this.loadRun(id)
    if (!loaded.ok) {
      return loaded
    }
    return loaded.data === undefined ? notFound() : { ok: true, data: loaded.data }
  }

  async listRuns(): Promise<AgentResult<RunListResult>> {
    const listed = await this.repository.list()
    return { ok: true, data: listed }
  }

  async getEvents(id: string, afterSequence = 0): Promise<AgentResult<AgentEvent[]>> {
    const loaded = await this.loadRun(id)
    if (!loaded.ok) {
      return loaded
    }
    if (loaded.data === undefined) {
      return notFound()
    }
    return this.repository.getEvents(id, afterSequence)
  }

  async approveRun(id: string): Promise<AgentResult<AgentRun>> {
    const loaded = await this.loadRun(id)
    if (!loaded.ok) {
      return loaded
    }
    if (loaded.data === undefined) {
      return notFound()
    }
    const run = loaded.data
    if (run.status !== 'awaiting_approval') {
      return statusError(run.status, 'running')
    }

    const approved = await this.transitionEvent(id, 'running', 'approval.resolved', {})
    if (approved.ok) {
      void this.streamPhase(id, 'final')
    }
    return approved
  }

  async cancelRun(id: string): Promise<AgentResult<AgentRun>> {
    const loaded = await this.loadRun(id)
    if (!loaded.ok) {
      return loaded
    }
    if (loaded.data === undefined) {
      return notFound()
    }

    this.controllers.get(id)?.abort()
    return this.transitionEvent(id, 'cancelled', 'run.cancelled', {})
  }

  async resumeRun(id: string): Promise<AgentResult<AgentRun>> {
    const loaded = await this.loadRun(id)
    if (!loaded.ok) {
      return loaded
    }
    if (loaded.data === undefined) {
      return notFound()
    }
    const run = loaded.data
    if (run.status !== 'interrupted') {
      return statusError(run.status, 'running')
    }
    if (run.checkpoint.phase === 'final' && !hasApprovalProof(run)) {
      return {
        ok: false,
        error: {
          code: 'INVALID_STATE',
          message: 'Cannot execute final phase before approval is resolved',
          retryable: false
        }
      }
    }
    return this.beginPhase(id, run.checkpoint.phase, 'run.resumed')
  }

  async recoverInterruptedRuns(): Promise<AgentResult<RunListResult>> {
    const listed = await this.repository.list()
    for (const run of listed.runs) {
      this.runs.set(run.id, run)
    }

    const recovered: AgentRun[] = []
    for (const run of listed.runs) {
      if (run.status === 'queued') {
        const started = await this.beginPhase(run.id, 'analysis', 'run.started')
        if (!started.ok) {
          return started
        }
        recovered.push(started.data)
        continue
      }
      if (run.status !== 'running') {
        recovered.push(run)
        continue
      }
      const interrupted = await this.interruptForRecovery(run.id)
      if (!interrupted.ok) {
        return interrupted
      }
      recovered.push(interrupted.data)
    }
    return { ok: true, data: { runs: recovered, issues: listed.issues } }
  }

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async beginPhase(
    id: string,
    phase: AgentCheckpoint['phase'],
    type: 'run.started' | 'run.resumed'
  ): Promise<AgentResult<AgentRun>> {
    const started = await this.transitionEvent(id, 'running', type, {})
    if (started.ok) {
      void this.streamPhase(id, phase)
    }
    return started
  }

  private async streamPhase(id: string, phase: AgentCheckpoint['phase']): Promise<void> {
    const controller = new AbortController()
    this.controllers.set(id, controller)
    const signal = controller.signal

    try {
      const initial = await this.loadRun(id)
      if (
        !initial.ok ||
        initial.data === undefined ||
        initial.data.status !== 'running' ||
        (phase === 'final' && !hasApprovalProof(initial.data))
      ) {
        return
      }

      const started = await this.appendEvent(id, 'step.started', { phase })
      if (!started.ok || signal.aborted) {
        return
      }

      const loaded = await this.loadRun(id)
      if (!loaded.ok || loaded.data === undefined || loaded.data.status !== 'running') {
        return
      }
      const run = loaded.data
      if (phase === 'final' && !hasApprovalProof(run)) {
        return
      }

      for await (const text of this.executor.stream({
        prompt: run.prompt,
        phase,
        nextChunkIndex: run.checkpoint.phase === phase ? run.checkpoint.nextChunkIndex : 0,
        signal
      })) {
        if (signal.aborted) {
          return
        }
        const chunk = await this.appendDelta(id, phase, text)
        if (!chunk.ok || signal.aborted) {
          return
        }
      }

      if (signal.aborted) {
        return
      }
      const completedStep = await this.completeStep(id, phase)
      if (!completedStep.ok || signal.aborted) {
        return
      }

      if (phase === 'analysis') {
        await this.requestApproval(id)
      } else {
        await this.transitionEvent(id, 'completed', 'run.completed', {})
      }
    } catch (error) {
      if (!signal.aborted) {
        const publicError = toAgentError(error)
        await this.failRun(id, publicError)
      }
    } finally {
      if (this.controllers.get(id) === controller) {
        this.controllers.delete(id)
      }
    }
  }

  private async appendDelta(
    id: string,
    phase: AgentCheckpoint['phase'],
    text: string
  ): Promise<AgentResult<AgentRun>> {
    return this.mutate(id, (run) => {
      if (run.status !== 'running') {
        return statusError(run.status, 'running')
      }
      const nextChunkIndex = run.checkpoint.phase === phase
        ? run.checkpoint.nextChunkIndex + 1
        : 1
      const timestamp = this.clock()
      return {
        ok: true,
        data: {
          ...run,
          updatedAt: timestamp,
          events: [...run.events, eventFor(run, 'step.delta', timestamp, { phase, text })],
          output: { ...run.output, [phase]: run.output[phase] + text },
          checkpoint: { phase, nextChunkIndex }
        }
      }
    })
  }

  private async completeStep(
    id: string,
    phase: AgentCheckpoint['phase']
  ): Promise<AgentResult<AgentRun>> {
    return this.mutate(id, (run) => {
      if (run.status !== 'running') {
        return statusError(run.status, 'running')
      }
      const timestamp = this.clock()
      return {
        ok: true,
        data: {
          ...run,
          updatedAt: timestamp,
          events: [...run.events, eventFor(run, 'step.completed', timestamp, { phase })],
          checkpoint: run.checkpoint
        }
      }
    })
  }

  private async transitionEvent(
    id: string,
    status: RunStatus,
    type: AgentEventType,
    payload: AgentEvent['payload']
  ): Promise<AgentResult<AgentRun>> {
    return this.mutate(id, (run) => {
      const timestamp = this.clock()
      const transitioned = transitionRun(run, status, timestamp)
      if (!transitioned.ok) {
        return transitioned
      }
      return {
        ok: true,
        data: {
          ...transitioned.data,
          events: [...run.events, eventFor(run, type, timestamp, payload)]
        }
      }
    })
  }

  private async requestApproval(id: string): Promise<AgentResult<AgentRun>> {
    return this.mutate(id, (run) => {
      const timestamp = this.clock()
      const transitioned = transitionRun(run, 'awaiting_approval', timestamp)
      if (!transitioned.ok) {
        return transitioned
      }
      return {
        ok: true,
        data: {
          ...transitioned.data,
          events: [...run.events, eventFor(run, 'approval.requested', timestamp, {})],
          checkpoint: { phase: 'final', nextChunkIndex: 0 }
        }
      }
    })
  }

  private async interruptForRecovery(id: string): Promise<AgentResult<AgentRun>> {
    return this.mutate(id, (run) => {
      const timestamp = this.clock()
      const transitioned = transitionRun(run, 'interrupted', timestamp)
      if (!transitioned.ok) {
        return transitioned
      }
      const checkpoint = run.checkpoint.phase === 'final' && !hasApprovalProof(run)
        ? { phase: 'analysis' as const, nextChunkIndex: analysisChunkCount(run) }
        : run.checkpoint
      return {
        ok: true,
        data: {
          ...transitioned.data,
          checkpoint,
          events: [...run.events, eventFor(run, 'run.interrupted', timestamp, {})]
        }
      }
    })
  }

  private async failRun(id: string, error: AgentError): Promise<AgentResult<AgentRun>> {
    return this.mutate(id, (run) => {
      if (run.status !== 'running') {
        return statusError(run.status, 'failed')
      }
      const timestamp = this.clock()
      return {
        ok: true,
        data: {
          ...run,
          status: 'failed',
          updatedAt: timestamp,
          error,
          events: [...run.events, eventFor(run, 'run.failed', timestamp, { code: error.code })]
        }
      }
    })
  }

  private async appendEvent(
    id: string,
    type: AgentEventType,
    payload: AgentEvent['payload']
  ): Promise<AgentResult<AgentRun>> {
    return this.mutate(id, (run) => {
      if (run.status !== 'running') {
        return statusError(run.status, 'running')
      }
      const timestamp = this.clock()
      return {
        ok: true,
        data: {
          ...run,
          updatedAt: timestamp,
          events: [...run.events, eventFor(run, type, timestamp, payload)]
        }
      }
    })
  }

  private async mutate(
    id: string,
    change: (run: AgentRun) => AgentResult<AgentRun>
  ): Promise<AgentResult<AgentRun>> {
    return this.enqueue(id, async () => {
      const current = this.runs.get(id)
      if (current === undefined) {
        return notFound()
      }
      const next = change(current)
      if (!next.ok) {
        return next
      }
      return this.persist(next.data)
    })
  }

  private async persist(run: AgentRun): Promise<AgentResult<AgentRun>> {
    const saved = await this.repository.save(run)
    if (!saved.ok) {
      return saved
    }
    this.runs.set(run.id, run)
    const event = run.events.at(-1)
    if (event !== undefined) {
      for (const listener of this.listeners) {
        try {
          listener(structuredClone(event))
        } catch {
          // Subscriber failures and mutations must not affect the committed Run.
        }
      }
    }
    return { ok: true, data: run }
  }

  private async loadRun(id: string): Promise<AgentResult<AgentRun | undefined>> {
    const inMemory = this.runs.get(id)
    if (inMemory !== undefined) {
      return { ok: true, data: inMemory }
    }
    const loaded = await this.repository.get(id)
    if (!loaded.ok) {
      return loaded
    }
    if (loaded.data === undefined) {
      return loaded
    }
    this.runs.set(id, loaded.data)
    return loaded
  }

  private async enqueue<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    this.queues.set(id, next.then(() => undefined, () => undefined))
    return next
  }
}
