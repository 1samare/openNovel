import { randomUUID } from 'node:crypto'

import type {
  AgentCheckpoint,
  AgentError,
  AgentEvent,
  AgentEventType,
  AgentResult,
  AgentRun,
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
    const run = await this.loadRun(id)
    return run === undefined ? notFound() : { ok: true, data: run }
  }

  async listRuns(): Promise<AgentResult<AgentRun[]>> {
    const listed = await this.repository.list()
    for (const run of listed.runs) {
      this.runs.set(run.id, run)
    }
    return { ok: true, data: listed.runs }
  }

  async getEvents(id: string, afterSequence = 0): Promise<AgentResult<AgentEvent[]>> {
    const run = await this.loadRun(id)
    if (run === undefined) {
      return notFound()
    }
    return this.repository.getEvents(id, afterSequence)
  }

  async approveRun(id: string): Promise<AgentResult<AgentRun>> {
    const run = await this.loadRun(id)
    if (run === undefined) {
      return notFound()
    }
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
    const run = await this.loadRun(id)
    if (run === undefined) {
      return notFound()
    }

    this.controllers.get(id)?.abort()
    return this.transitionEvent(id, 'cancelled', 'run.cancelled', {})
  }

  async resumeRun(id: string): Promise<AgentResult<AgentRun>> {
    const run = await this.loadRun(id)
    if (run === undefined) {
      return notFound()
    }
    if (run.status !== 'interrupted') {
      return statusError(run.status, 'running')
    }
    return this.beginPhase(id, run.checkpoint.phase, 'run.resumed')
  }

  async recoverInterruptedRuns(): Promise<AgentResult<AgentRun[]>> {
    const listed = await this.repository.list()
    for (const run of listed.runs) {
      this.runs.set(run.id, run)
    }

    const recovered: AgentRun[] = []
    for (const run of listed.runs) {
      if (run.status !== 'running') {
        recovered.push(run)
        continue
      }
      const interrupted = await this.transitionEvent(run.id, 'interrupted', 'run.interrupted', {})
      if (!interrupted.ok) {
        return interrupted
      }
      recovered.push(interrupted.data)
    }
    return { ok: true, data: recovered }
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
      const started = await this.appendEvent(id, 'step.started', { phase })
      if (!started.ok || signal.aborted) {
        return
      }

      const run = await this.loadRun(id)
      if (run === undefined || run.status !== 'running') {
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
        await this.transitionEvent(id, 'awaiting_approval', 'approval.requested', {})
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
          checkpoint: phase === 'analysis'
            ? { phase: 'final', nextChunkIndex: 0 }
            : run.checkpoint
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
        listener(event)
      }
    }
    return { ok: true, data: run }
  }

  private async loadRun(id: string): Promise<AgentRun | undefined> {
    const inMemory = this.runs.get(id)
    if (inMemory !== undefined) {
      return inMemory
    }
    const loaded = await this.repository.get(id)
    if (!loaded.ok || loaded.data === undefined) {
      return undefined
    }
    this.runs.set(id, loaded.data)
    return loaded.data
  }

  private async enqueue<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    this.queues.set(id, next.then(() => undefined, () => undefined))
    return next
  }
}
