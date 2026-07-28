import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import type { AgentEvent, AgentResult, AgentRun } from '../shared/agent.ts'
import { isAgentRun } from './validation.ts'

const schemaVersion = 1

type RunSnapshot = {
  schemaVersion: typeof schemaVersion
  run: AgentRun
}

type ReplaceSnapshot = (temporaryPath: string, snapshotPath: string) => Promise<void>

export type RunLoadIssue = {
  id: string
  code: 'CORRUPT_JSON' | 'UNSUPPORTED_SCHEMA' | 'INVALID_RUN' | 'READ_FAILED'
  message: string
}

export type RunList = {
  runs: AgentRun[]
  issues: RunLoadIssue[]
}

export interface RunRepository {
  save(run: AgentRun): Promise<AgentResult<void>>
  get(id: string): Promise<AgentResult<AgentRun | undefined>>
  list(): Promise<RunList>
  getEvents(id: string, afterSequence?: number): Promise<AgentResult<AgentEvent[]>>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const snapshotFileName = (id: string): string => `${encodeURIComponent(id)}.json`

const runIdFromFileName = (fileName: string): string =>
  fileName.slice(0, -'.json'.length)

const invalidRun = (message: string): AgentResult<never> => ({
  ok: false,
  error: { code: 'INVALID_RUN', message }
})

const parseSnapshot = (value: unknown): AgentRun => {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'schemaVersion') ||
    !Object.hasOwn(value, 'run')
  ) {
    throw { code: 'INVALID_RUN' }
  }

  if (value.schemaVersion !== schemaVersion) {
    throw { code: 'UNSUPPORTED_SCHEMA' }
  }

  if (!isAgentRun(value.run)) {
    throw { code: 'INVALID_RUN' }
  }

  return value.run
}

const issueFor = (id: string, error: unknown): RunLoadIssue => {
  if (error instanceof SyntaxError) {
    return { id, code: 'CORRUPT_JSON', message: 'Run snapshot is not valid JSON' }
  }

  if (isRecord(error) && error.code === 'UNSUPPORTED_SCHEMA') {
    return { id, code: 'UNSUPPORTED_SCHEMA', message: 'Run snapshot schema is not supported' }
  }

  if (isRecord(error) && error.code === 'INVALID_RUN') {
    return { id, code: 'INVALID_RUN', message: 'Run snapshot failed validation' }
  }

  return { id, code: 'READ_FAILED', message: 'Unable to load run snapshot' }
}

const loadSnapshot = async (path: string): Promise<AgentRun> =>
  parseSnapshot(JSON.parse(await readFile(path, 'utf8')))

export class JsonRunRepository implements RunRepository {
  private readonly storageRoot: string
  private readonly replaceSnapshot: ReplaceSnapshot

  constructor(storageRoot: string, replaceSnapshot: ReplaceSnapshot = rename) {
    this.storageRoot = storageRoot
    this.replaceSnapshot = replaceSnapshot
  }

  async save(run: AgentRun): Promise<AgentResult<void>> {
    if (!isAgentRun(run)) {
      return invalidRun('Run snapshot failed validation')
    }

    const fileName = snapshotFileName(run.id)
    const temporaryPath = join(this.storageRoot, `.${fileName}.${randomUUID()}.tmp`)
    const snapshotPath = join(this.storageRoot, fileName)

    try {
      await mkdir(this.storageRoot, { recursive: true })
      await writeFile(temporaryPath, JSON.stringify({ schemaVersion, run } satisfies RunSnapshot), 'utf8')
      await this.replaceSnapshot(temporaryPath, snapshotPath)
      return { ok: true, value: undefined }
    } catch {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      return {
        ok: false,
        error: { code: 'EXECUTION_FAILED', message: 'Unable to save run snapshot' }
      }
    }
  }

  async get(id: string): Promise<AgentResult<AgentRun | undefined>> {
    const snapshotPath = join(this.storageRoot, snapshotFileName(id))

    try {
      return { ok: true, value: await loadSnapshot(snapshotPath) }
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT') {
        return { ok: true, value: undefined }
      }

      if (error instanceof SyntaxError) {
        return invalidRun('Run snapshot is not valid JSON')
      }

      if (isRecord(error) && error.code === 'UNSUPPORTED_SCHEMA') {
        return invalidRun('Run snapshot schema is not supported')
      }

      if (isRecord(error) && error.code === 'INVALID_RUN') {
        return invalidRun('Run snapshot failed validation')
      }

      return {
        ok: false,
        error: { code: 'EXECUTION_FAILED', message: 'Unable to load run snapshot' }
      }
    }
  }

  async list(): Promise<RunList> {
    try {
      await mkdir(this.storageRoot, { recursive: true })
    } catch {
      return {
        runs: [],
        issues: [{ id: 'storage', code: 'READ_FAILED', message: 'Unable to load run snapshots' }]
      }
    }

    let fileNames: string[]
    try {
      fileNames = (await readdir(this.storageRoot))
        .filter((fileName) => fileName.endsWith('.json'))
        .sort()
    } catch {
      return {
        runs: [],
        issues: [{ id: 'storage', code: 'READ_FAILED', message: 'Unable to load run snapshots' }]
      }
    }

    const runs: AgentRun[] = []
    const issues: RunLoadIssue[] = []

    for (const fileName of fileNames) {
      try {
        runs.push(await loadSnapshot(join(this.storageRoot, fileName)))
      } catch (error) {
        issues.push(issueFor(runIdFromFileName(fileName), error))
      }
    }

    return { runs, issues }
  }

  async getEvents(id: string, afterSequence = 0): Promise<AgentResult<AgentEvent[]>> {
    const loaded = await this.get(id)
    if (!loaded.ok) {
      return loaded
    }

    return {
      ok: true,
      value: loaded.value?.events.filter((event) => event.sequence > afterSequence) ?? []
    }
  }
}
