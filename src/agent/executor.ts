import type { AgentCheckpoint } from '../shared/agent.ts'

export type ExecutorRequest = {
  prompt: string
  phase: AgentCheckpoint['phase']
  nextChunkIndex: number
  signal: AbortSignal
}

export interface AgentExecutor {
  stream(request: ExecutorRequest): AsyncIterable<string>
}
