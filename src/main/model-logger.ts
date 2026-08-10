import type { StoredModelCallLog } from '../model/model-repository.ts'

export type SafeModelCallLog = StoredModelCallLog

export type ModelLogger = {
  record(input: SafeModelCallLog): Promise<void>
}

export const createModelLogger = (
  sink: (record: SafeModelCallLog) => void | Promise<void> = (record) => console.info(record)
): ModelLogger => ({
  async record(input) {
    const record: SafeModelCallLog = {
      id: input.id,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
      ...(input.profileId === undefined ? {} : { profileId: input.profileId }),
      providerKind: input.providerKind,
      modelId: input.modelId,
      operation: input.operation,
      status: input.status,
      latencyMs: input.latencyMs,
      ...(input.inputTokens === undefined ? {} : { inputTokens: input.inputTokens }),
      ...(input.outputTokens === undefined ? {} : { outputTokens: input.outputTokens }),
      ...(input.estimatedCostMicros === undefined
        ? {}
        : { estimatedCostMicros: input.estimatedCostMicros }),
      retryCount: input.retryCount,
      ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
      ...(input.providerRequestId === undefined
        ? {}
        : { providerRequestId: input.providerRequestId }),
      createdAt: input.createdAt
    }
    await sink(record)
  }
})
