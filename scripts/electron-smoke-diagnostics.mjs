import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const REDACTED = '[redacted]'
const SENSITIVE_KEYS = new Set([
  'prompt',
  'output',
  'text',
  'stack',
  'snapshot',
  'userData',
  'userDataDir',
  'storagePath',
  'validatedURL'
])

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const bounded = (value, limit = 20000) => {
  const text = String(value ?? '')
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

export const redactText = (value) => bounded(value)
  .replace(/(?:[A-Za-z]:\\|\\\\)[^\r\n"'<> ]+/g, REDACTED)
  .replace(/(?:\/Users\/|\/home\/)[^\r\n"'<> ]+/g, REDACTED)
  .replace(/\b(prompt|output|text|stack|snapshot|userData|storagePath|validatedURL)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,}]+)/gi, '$1=[redacted]')

const sanitize = (value, key = '') => {
  if (SENSITIVE_KEYS.has(key)) return REDACTED
  if (typeof value === 'string') return redactText(value)
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitize(entryValue, entryKey)
    ]))
  }
  return value
}

export const summarizeRun = (run) => {
  const events = Array.isArray(run?.events) ? run.events : []
  const deltas = events.filter((event) => event?.type === 'step.delta')
  const checkpoint = isRecord(run?.checkpoint) &&
    (run.checkpoint.phase === 'analysis' || run.checkpoint.phase === 'final') &&
    Number.isSafeInteger(run.checkpoint.nextChunkIndex)
    ? {
        phase: run.checkpoint.phase,
        nextChunkIndex: run.checkpoint.nextChunkIndex
      }
    : undefined

  return {
    status: typeof run?.status === 'string' ? run.status : 'unknown',
    eventCount: events.length,
    eventSequences: events.map((event) => event?.sequence),
    eventTypes: events.map((event) => event?.type),
    deltaCount: deltas.length,
    deltaLengths: deltas.map((event) => typeof event?.payload?.text === 'string' ? event.payload.text.length : 0),
    ...(checkpoint === undefined ? {} : { checkpoint }),
    ...(typeof run?.error?.code === 'string' ? { errorCode: run.error.code } : {})
  }
}

export const assertContiguousEventSequences = (events, label = 'events') => {
  if (!Array.isArray(events)) throw new Error(`${label} must be an array`)
  events.forEach((event, index) => {
    const expected = index + 1
    if (event?.sequence !== expected) {
      throw new Error(`${label} are not contiguous: expected ${expected}, got ${event?.sequence}`)
    }
  })
}

export const assertUniqueDeltaChunks = (events, label = 'delta chunks') => {
  if (!Array.isArray(events)) throw new Error(`${label} must be an array`)
  const seen = new Set()
  for (const event of events) {
    if (event?.type !== 'step.delta') continue
    const phase = event?.payload?.phase
    const text = event?.payload?.text
    const key = JSON.stringify([phase, text])
    if (seen.has(key)) throw new Error(`${label} contain a duplicate chunk`)
    seen.add(key)
  }
}

export const writeDiagnostics = async (directory, diagnostic) => {
  await mkdir(directory, { recursive: true })
  const safe = sanitize(diagnostic)
  await writeFile(join(directory, 'summary.json'), `${JSON.stringify(safe, null, 2)}\n`, 'utf8')
  for (const [name, value] of [
    ['electron-stdout.txt', diagnostic?.stdout],
    ['electron-stderr.txt', diagnostic?.stderr],
    ['cdp-console.txt', diagnostic?.console]
  ]) {
    if (typeof value === 'string' && value.length > 0) {
      await writeFile(join(directory, name), `${redactText(value)}\n`, 'utf8')
    }
  }
}
