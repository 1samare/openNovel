export const RENDERER_FLUSH_IPC_CHANNELS = {
  request: 'open-novel:lifecycle:flush-request',
  result: 'open-novel:lifecycle:flush-result'
} as const

export type RendererFlushApi = {
  onFlushRequest(listener: (requestId: string) => void): () => void
  completeFlush(requestId: string, saved: boolean): void
}

const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const isRendererFlushRequestId = (value: unknown): value is string =>
  typeof value === 'string' && REQUEST_ID_PATTERN.test(value)
