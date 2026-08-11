import { join } from 'node:path'

import { BibleRepository } from '../novel/bible-repository.ts'
import { ProposalService, type StructuredCoauthorPort } from '../novel/proposal-service.ts'
import {
  BibleDomainError,
  type BibleResult,
  type BibleSourceVersion,
  type DecideBibleProposalInput,
  type GenerateBibleProposalsInput,
  type MoveOutlineNodeInput,
  type NovelBibleSnapshot,
  type RestoreBibleVersionInput,
  type SaveBibleEntryInput,
  type SaveNovelProfileInput,
  type SaveOutlineNodeInput,
  type VersionTarget
} from '../shared/novel.ts'
import { ProjectDomainError, type ProjectSummary } from '../shared/project.ts'
import type { AgentSenderPolicy } from './agent-ipc-security.ts'
import type { BibleRuntimePort } from './bible-ipc.ts'

type ProjectAccessor = {
  current(): ProjectSummary | undefined
  subscribe?(listener: (summary: ProjectSummary | undefined) => void): () => void
}

const projectKey = (summary: Pick<ProjectSummary, 'projectId' | 'root'> | undefined): string | undefined =>
  summary === undefined ? undefined : `${summary.projectId}\n${summary.root}`

const safeFailure = (error: unknown): BibleResult<never> => {
  const domain = error instanceof BibleDomainError
    ? error
    : error instanceof ProjectDomainError && error.code === 'PROJECT_NOT_OPEN'
      ? new BibleDomainError('BIBLE_NOT_AVAILABLE', 'No project is open')
      : new BibleDomainError('BIBLE_OPERATION_FAILED', 'Bible operation failed')
  return {
    ok: false,
    error: {
      code: domain.code,
      message: domain.code === 'BIBLE_GENERATION_CANCELLED'
        ? 'Bible generation was cancelled'
        : domain.code === 'BIBLE_NOT_AVAILABLE'
          ? 'No novel project is open'
          : 'Bible operation failed',
      retryable: domain.retryable
    }
  }
}

export const createBibleRuntime = (options: {
  project: ProjectAccessor
  coauthor: StructuredCoauthorPort
  senderPolicy: AgentSenderPolicy
}): BibleRuntimePort & { close(): Promise<void> } => {
  let active: {
    projectId: string
    root: string
    repository: BibleRepository
    proposals: ProposalService
  } | undefined
  let sessionTail: Promise<void> = Promise.resolve()
  const operations = new Set<Promise<unknown>>()
  const generations = new Map<string, { controller: AbortController; pending: Promise<unknown> }>()
  let projectEpoch = 0
  let blockedProjectKey: string | undefined
  let closePromise: Promise<void> | undefined

  const abortGenerations = (): void => {
    for (const generation of generations.values()) generation.controller.abort()
  }

  options.project.subscribe?.((summary) => {
    projectEpoch += 1
    abortGenerations()
    if (projectKey(summary) !== blockedProjectKey) blockedProjectKey = undefined
  })

  const stopGenerations = async (): Promise<void> => {
    const pending = [...generations.values()]
    abortGenerations()
    await Promise.allSettled(pending.map((generation) => generation.pending))
  }

  const withSessionLock = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = sessionTail.then(operation, operation)
    sessionTail = result.then(() => undefined, () => undefined)
    return result
  }

  const session = (): Promise<NonNullable<typeof active>> => withSessionLock(async () => {
    const summary = options.project.current()
    if (summary === undefined) throw new ProjectDomainError('PROJECT_NOT_OPEN', 'No project is open')
    if (projectKey(summary) === blockedProjectKey) {
      throw new ProjectDomainError('PROJECT_NOT_OPEN', 'The current project Bible session is closed')
    }
    const epoch = projectEpoch
    if (active !== undefined && (active.projectId !== summary.projectId || active.root !== summary.root)) {
      await stopGenerations()
      await active.repository.close()
      active = undefined
    }
    if (active === undefined) {
      const repository = await BibleRepository.open(
        join(summary.root, 'project.sqlite3'),
        summary.projectId
      )
      active = {
        projectId: summary.projectId,
        root: summary.root,
        repository,
        proposals: new ProposalService(repository, { coauthor: options.coauthor })
      }
      if (epoch !== projectEpoch || projectKey(options.project.current()) !== projectKey(summary)) {
        const stale = active
        active = undefined
        await stale.repository.close()
        throw new ProjectDomainError('PROJECT_NOT_OPEN', 'The active project changed while opening Bible storage')
      }
    }
    return active
  })

  const run = <T>(operation: () => Promise<T>): Promise<BibleResult<T>> => {
    if (closePromise !== undefined || projectKey(options.project.current()) === blockedProjectKey) {
      return Promise.resolve(safeFailure(new BibleDomainError(
        'BIBLE_NOT_AVAILABLE', 'The Bible runtime is closing'
      )))
    }
    const pending = operation()
      .then((data): BibleResult<T> => ({ ok: true, data }))
      .catch(safeFailure)
    operations.add(pending)
    void pending.finally(() => operations.delete(pending))
    return pending
  }

  return {
    senderPolicy: options.senderPolicy,
    getSnapshot: () => run(async () => (await session()).repository.snapshot()),
    saveProfile: (input: SaveNovelProfileInput) => run(async () => {
      const current = await session()
      await current.repository.saveProfile(input)
      return current.repository.snapshot()
    }),
    saveEntry: (input: SaveBibleEntryInput) => run(async () => {
      const current = await session()
      await current.repository.saveEntry(input)
      return current.repository.snapshot()
    }),
    saveOutlineNode: (input: SaveOutlineNodeInput) => run(async () => {
      const current = await session()
      await current.repository.saveOutlineNode(input)
      return current.repository.snapshot()
    }),
    moveOutlineNode: (input: MoveOutlineNodeInput) => run(async () => {
      const current = await session()
      await current.repository.moveOutlineNode(input)
      return current.repository.snapshot()
    }),
    listVersions: (input: VersionTarget): Promise<BibleResult<BibleSourceVersion[]>> =>
      run(async () => (await session()).repository.listVersions(input)),
    restoreVersion: (input: RestoreBibleVersionInput): Promise<BibleResult<NovelBibleSnapshot>> =>
      run(async () => (await session()).repository.restoreVersion(input)),
    generateProposals: (input: GenerateBibleProposalsInput) => {
      if (generations.has(input.requestId)) {
        return Promise.resolve(safeFailure(new BibleDomainError(
          'BIBLE_INVALID_COMMAND', 'Bible generation request is already active'
        )))
      }
      const controller = new AbortController()
      const pending = run(async () => (
        (await session()).proposals.generateProposals(input, controller.signal)
      ))
      generations.set(input.requestId, { controller, pending })
      return pending.finally(() => {
        if (generations.get(input.requestId)?.pending === pending) generations.delete(input.requestId)
      })
    },
    cancelGeneration: async (requestId: string) => {
      generations.get(requestId)?.controller.abort()
      return { ok: true, data: null }
    },
    decideProposal: (input: DecideBibleProposalInput) =>
      run(async () => (await session()).proposals.decideProposal(input)),
    close: () => {
      if (closePromise !== undefined) return closePromise
      blockedProjectKey = projectKey(options.project.current()) ?? projectKey(active)
      closePromise = (async () => {
        await stopGenerations()
        await Promise.allSettled([...operations])
        await withSessionLock(async () => {
          const closing = active
          active = undefined
          await closing?.repository.close()
        })
      })().finally(() => {
        closePromise = undefined
      })
      return closePromise
    }
  }
}
