import type { AgentExecutor, ExecutorRequest } from './executor.ts'

export type ExecutorDelay = (signal: AbortSignal) => Promise<void>

export type MockExecutorOptions = {
  analysisChunks?: readonly string[]
  finalChunks?: readonly string[]
  delay?: ExecutorDelay
}

const immediately = async (): Promise<void> => undefined

const defaultAnalysisChunks = [
  'Reviewing the requested direction. ',
  'Planning a concise opening. '
]

const defaultFinalChunks = [
  'The room was quiet before the first sentence. ',
  'Then the story began. '
]

export class MockExecutor implements AgentExecutor {
  private readonly chunks: Record<'analysis' | 'final', readonly string[]>
  private readonly delay: ExecutorDelay

  constructor(options: MockExecutorOptions = {}) {
    this.chunks = {
      analysis: options.analysisChunks ?? defaultAnalysisChunks,
      final: options.finalChunks ?? defaultFinalChunks
    }
    this.delay = options.delay ?? immediately
  }

  async *stream({ phase, nextChunkIndex, signal }: ExecutorRequest): AsyncIterable<string> {
    for (const chunk of this.chunks[phase].slice(nextChunkIndex)) {
      if (signal.aborted) {
        return
      }

      await this.delay(signal)
      if (signal.aborted) {
        return
      }

      yield chunk
    }
  }
}
