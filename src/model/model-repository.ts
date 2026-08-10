import {
  MODEL_CAPABILITIES,
  ModelDomainError,
  type ModelCapability,
  type ModelProfile,
  type ProviderConnectionSummary,
  type ProviderKind
} from '../shared/model.ts'
import { DatabaseWorkerClient } from '../novel/database-worker.ts'
import { CONTROL_MIGRATIONS } from '../novel/schema.ts'

export type StoredProviderConnection = ProviderConnectionSummary & {
  secretRef: string
}

export type ModelCallOperation =
  | 'test-connection'
  | 'list-models'
  | 'stream-text'
  | 'generate-object'

export type StoredModelCallLog = {
  id: string
  projectId?: string
  connectionId?: string
  profileId?: string
  providerKind: ProviderKind
  modelId: string
  operation: ModelCallOperation
  status: 'succeeded' | 'failed' | 'cancelled'
  latencyMs: number
  inputTokens?: number
  outputTokens?: number
  estimatedCostMicros?: number
  retryCount: number
  errorCode?: string
  providerRequestId?: string
  createdAt: string
}

type ConnectionRow = {
  id: string
  name: string
  kind: ProviderKind
  base_url: string | null
  secret_ref: string
  secret_hint: string
  enabled: number
  created_at: string
  updated_at: string
}

type ProfileRow = {
  id: string
  connection_id: string
  label: string
  model_id: string
  temperature: number
  max_output_tokens: number
  context_window: number
  capabilities_json: string
}

type ModelCallLogRow = {
  id: string
  project_id: string | null
  connection_id: string | null
  profile_id: string | null
  provider_kind: ProviderKind
  model_id: string
  operation: ModelCallOperation
  status: 'succeeded' | 'failed' | 'cancelled'
  latency_ms: number
  input_tokens: number | null
  output_tokens: number | null
  estimated_cost_micros: number | null
  retry_count: number
  error_code: string | null
  provider_request_id: string | null
  created_at: string
}

const databaseFailure = (cause: unknown): ModelDomainError => new ModelDomainError(
  'MODEL_DATABASE_FAILED',
  'Model configuration database operation failed',
  { cause }
)

const connectionFromRow = (row: ConnectionRow): StoredProviderConnection => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  ...(row.base_url === null ? {} : { baseUrl: row.base_url }),
  enabled: row.enabled === 1,
  hasSecret: true,
  secretHint: row.secret_hint,
  secretRef: row.secret_ref,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

const parseCapabilities = (value: string): ModelCapability[] => {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || !parsed.every((item) => (
      typeof item === 'string' && MODEL_CAPABILITIES.includes(item as ModelCapability)
    ))) throw new Error('Invalid capabilities')
    return [...new Set(parsed)] as ModelCapability[]
  } catch (error) {
    throw databaseFailure(error)
  }
}

const profileFromRow = (row: ProfileRow): ModelProfile => ({
  id: row.id,
  connectionId: row.connection_id,
  label: row.label,
  modelId: row.model_id,
  temperature: row.temperature,
  maxOutputTokens: row.max_output_tokens,
  contextWindow: row.context_window,
  capabilities: parseCapabilities(row.capabilities_json)
})

const callLogFromRow = (row: ModelCallLogRow): StoredModelCallLog => ({
  id: row.id,
  ...(row.project_id === null ? {} : { projectId: row.project_id }),
  ...(row.connection_id === null ? {} : { connectionId: row.connection_id }),
  ...(row.profile_id === null ? {} : { profileId: row.profile_id }),
  providerKind: row.provider_kind,
  modelId: row.model_id,
  operation: row.operation,
  status: row.status,
  latencyMs: row.latency_ms,
  ...(row.input_tokens === null ? {} : { inputTokens: row.input_tokens }),
  ...(row.output_tokens === null ? {} : { outputTokens: row.output_tokens }),
  ...(row.estimated_cost_micros === null
    ? {}
    : { estimatedCostMicros: row.estimated_cost_micros }),
  retryCount: row.retry_count,
  ...(row.error_code === null ? {} : { errorCode: row.error_code }),
  ...(row.provider_request_id === null
    ? {}
    : { providerRequestId: row.provider_request_id }),
  createdAt: row.created_at
})

export class ModelRepository {
  readonly #database: DatabaseWorkerClient

  private constructor(database: DatabaseWorkerClient) {
    this.#database = database
  }

  static async open(databasePath: string): Promise<ModelRepository> {
    try {
      return new ModelRepository(
        await DatabaseWorkerClient.open(databasePath, CONTROL_MIGRATIONS)
      )
    } catch (error) {
      throw databaseFailure(error)
    }
  }

  async listConnections(): Promise<StoredProviderConnection[]> {
    try {
      return (await this.#database.all<ConnectionRow>(`
        SELECT id, name, kind, base_url, secret_ref, secret_hint, enabled, created_at, updated_at
        FROM provider_connections ORDER BY created_at, id
      `)).map(connectionFromRow)
    } catch (error) {
      if (error instanceof ModelDomainError) throw error
      throw databaseFailure(error)
    }
  }

  async getConnection(id: string): Promise<StoredProviderConnection | undefined> {
    try {
      const row = await this.#database.get<ConnectionRow>(`
        SELECT id, name, kind, base_url, secret_ref, secret_hint, enabled, created_at, updated_at
        FROM provider_connections WHERE id = ?
      `, [id])
      return row === undefined ? undefined : connectionFromRow(row)
    } catch (error) {
      throw databaseFailure(error)
    }
  }

  async saveConnection(connection: StoredProviderConnection): Promise<void> {
    try {
      await this.#database.run(`
        INSERT INTO provider_connections (
          id, name, kind, base_url, secret_ref, secret_hint, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          kind = excluded.kind,
          base_url = excluded.base_url,
          secret_ref = excluded.secret_ref,
          secret_hint = excluded.secret_hint,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `, [
        connection.id,
        connection.name,
        connection.kind,
        connection.baseUrl ?? null,
        connection.secretRef,
        connection.secretHint ?? '',
        connection.enabled ? 1 : 0,
        connection.createdAt,
        connection.updatedAt
      ])
    } catch (error) {
      throw databaseFailure(error)
    }
  }

  async listProfiles(): Promise<ModelProfile[]> {
    try {
      return (await this.#database.all<ProfileRow>(`
        SELECT id, connection_id, label, model_id, temperature,
               max_output_tokens, context_window, capabilities_json
        FROM model_profiles ORDER BY created_at, id
      `)).map(profileFromRow)
    } catch (error) {
      if (error instanceof ModelDomainError) throw error
      throw databaseFailure(error)
    }
  }

  async getProfile(id: string): Promise<ModelProfile | undefined> {
    try {
      const row = await this.#database.get<ProfileRow>(`
        SELECT id, connection_id, label, model_id, temperature,
               max_output_tokens, context_window, capabilities_json
        FROM model_profiles WHERE id = ?
      `, [id])
      return row === undefined ? undefined : profileFromRow(row)
    } catch (error) {
      if (error instanceof ModelDomainError) throw error
      throw databaseFailure(error)
    }
  }

  async saveProfile(profile: ModelProfile, timestamp: string): Promise<void> {
    try {
      await this.#database.run(`
        INSERT INTO model_profiles (
          id, connection_id, label, model_id, temperature,
          max_output_tokens, context_window, capabilities_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          connection_id = excluded.connection_id,
          label = excluded.label,
          model_id = excluded.model_id,
          temperature = excluded.temperature,
          max_output_tokens = excluded.max_output_tokens,
          context_window = excluded.context_window,
          capabilities_json = excluded.capabilities_json,
          updated_at = excluded.updated_at
      `, [
        profile.id,
        profile.connectionId,
        profile.label,
        profile.modelId,
        profile.temperature,
        profile.maxOutputTokens,
        profile.contextWindow,
        JSON.stringify(profile.capabilities),
        timestamp,
        timestamp
      ])
    } catch (error) {
      throw databaseFailure(error)
    }
  }

  async saveCallLog(record: StoredModelCallLog): Promise<void> {
    try {
      await this.#database.run(`
        INSERT INTO model_call_logs (
          id, project_id, connection_id, profile_id, provider_kind, model_id,
          operation, status, latency_ms, input_tokens, output_tokens,
          estimated_cost_micros, retry_count, error_code, provider_request_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        record.id,
        record.projectId ?? null,
        record.connectionId ?? null,
        record.profileId ?? null,
        record.providerKind,
        record.modelId,
        record.operation,
        record.status,
        record.latencyMs,
        record.inputTokens ?? null,
        record.outputTokens ?? null,
        record.estimatedCostMicros ?? null,
        record.retryCount,
        record.errorCode ?? null,
        record.providerRequestId ?? null,
        record.createdAt
      ])
    } catch (error) {
      throw databaseFailure(error)
    }
  }

  async listCallLogs(limit = 100): Promise<StoredModelCallLog[]> {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 500) {
      throw new ModelDomainError('MODEL_INVALID_COMMAND', 'Model log limit is invalid')
    }
    try {
      return (await this.#database.all<ModelCallLogRow>(`
        SELECT id, project_id, connection_id, profile_id, provider_kind, model_id,
               operation, status, latency_ms, input_tokens, output_tokens,
               estimated_cost_micros, retry_count, error_code, provider_request_id, created_at
        FROM model_call_logs ORDER BY created_at DESC, id DESC LIMIT ?
      `, [limit])).map(callLogFromRow)
    } catch (error) {
      throw databaseFailure(error)
    }
  }

  async close(): Promise<void> {
    try {
      await this.#database.close()
    } catch (error) {
      throw databaseFailure(error)
    }
  }
}
