import { access } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ProjectDomainError,
  type ProjectManifest,
  type ProjectSummary,
  type RecentProjectSummary
} from '../shared/project.ts'
import type {
  AgentRoleBinding,
  GenerationModeDefault,
  ModelBindingConfiguration
} from '../shared/model.ts'
import { DatabaseWorkerClient } from './database-worker.ts'
import {
  CONTROL_MIGRATIONS,
  PROJECT_MIGRATIONS,
  type DatabaseMigration
} from './schema.ts'

type ProjectRow = {
  id: string
  title: string
  created_at: string
  updated_at: string
}

type RecentProjectRow = {
  project_id: string
  title: string
  project_path: string
  last_opened_at: string
  last_backup_path: string | null
}

type ModeDefaultRow = {
  mode: GenerationModeDefault['mode']
  primary_profile_id: string
  fallback_profile_ids_json: string
  allow_cross_provider_fallback: number
}

type RoleBindingRow = {
  role: AgentRoleBinding['role']
  mode: AgentRoleBinding['mode']
  primary_profile_id: string
  fallback_profile_ids_json: string
  allow_cross_provider_fallback: number
}

const parseProfileIds = (value: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
      throw new Error('Invalid profile IDs')
    }
    return parsed
  } catch {
    throw new ProjectDomainError('PROJECT_DATA_MISMATCH', 'Model binding data is invalid')
  }
}

export class ProjectRepository {
  readonly #database: DatabaseWorkerClient

  private constructor(database: DatabaseWorkerClient) {
    this.#database = database
  }

  static async open(
    databasePath: string,
    migrations: readonly DatabaseMigration[] = PROJECT_MIGRATIONS
  ): Promise<ProjectRepository> {
    return new ProjectRepository(await DatabaseWorkerClient.open(databasePath, migrations))
  }

  async initialize(manifest: ProjectManifest, auditId: string): Promise<void> {
    await this.#database.transaction([
      {
        sql: 'INSERT INTO projects (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
        params: [manifest.projectId, manifest.title, manifest.createdAt, manifest.updatedAt]
      },
      {
        sql: `INSERT INTO audit_events (id, project_id, event_type, payload_json, created_at)
              VALUES (?, ?, ?, ?, ?)`,
        params: [auditId, manifest.projectId, 'project.created', null, manifest.createdAt]
      }
    ])
  }

  async load(projectId: string, root: string): Promise<ProjectSummary> {
    const row = await this.#database.get<ProjectRow>(
      'SELECT id, title, created_at, updated_at FROM projects WHERE id = ?',
      [projectId]
    )
    if (row === undefined) {
      throw new ProjectDomainError('PROJECT_NOT_FOUND', 'Project data is missing')
    }
    return {
      projectId: row.id,
      title: row.title,
      root,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  async rename(
    projectId: string,
    title: string,
    updatedAt: string,
    auditId: string
  ): Promise<void> {
    await this.#database.transaction([
      {
        sql: 'UPDATE projects SET title = ?, updated_at = ? WHERE id = ?',
        params: [title, updatedAt, projectId]
      },
      {
        sql: `INSERT INTO audit_events (id, project_id, event_type, payload_json, created_at)
              VALUES (?, ?, ?, ?, ?)`,
        params: [auditId, projectId, 'project.renamed', JSON.stringify({ title }), updatedAt]
      }
    ])
  }

  async listModelBindings(): Promise<ModelBindingConfiguration> {
    const [modeRows, roleRows] = await Promise.all([
      this.#database.all<ModeDefaultRow>(`
        SELECT mode, primary_profile_id, fallback_profile_ids_json,
               allow_cross_provider_fallback
        FROM generation_mode_defaults ORDER BY mode
      `),
      this.#database.all<RoleBindingRow>(`
        SELECT role, mode, primary_profile_id, fallback_profile_ids_json,
               allow_cross_provider_fallback
        FROM agent_role_bindings ORDER BY mode, role
      `)
    ])
    return {
      modeDefaults: modeRows.map((row) => ({
        mode: row.mode,
        primaryProfileId: row.primary_profile_id,
        fallbackProfileIds: parseProfileIds(row.fallback_profile_ids_json),
        allowCrossProviderFallback: row.allow_cross_provider_fallback === 1
      })),
      roleBindings: roleRows.map((row) => ({
        role: row.role,
        mode: row.mode,
        primaryProfileId: row.primary_profile_id,
        fallbackProfileIds: parseProfileIds(row.fallback_profile_ids_json),
        allowCrossProviderFallback: row.allow_cross_provider_fallback === 1
      }))
    }
  }

  async saveModelBindings(
    configuration: ModelBindingConfiguration,
    updatedAt: string
  ): Promise<void> {
    await this.#database.transaction([
      { sql: 'DELETE FROM agent_role_bindings' },
      { sql: 'DELETE FROM generation_mode_defaults' },
      ...configuration.modeDefaults.map((route) => ({
        sql: `INSERT INTO generation_mode_defaults (
                mode, primary_profile_id, fallback_profile_ids_json,
                allow_cross_provider_fallback, updated_at
              ) VALUES (?, ?, ?, ?, ?)`,
        params: [
          route.mode,
          route.primaryProfileId,
          JSON.stringify(route.fallbackProfileIds),
          route.allowCrossProviderFallback ? 1 : 0,
          updatedAt
        ]
      })),
      ...configuration.roleBindings.map((route) => ({
        sql: `INSERT INTO agent_role_bindings (
                role, mode, primary_profile_id, fallback_profile_ids_json,
                allow_cross_provider_fallback, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?)`,
        params: [
          route.role,
          route.mode,
          route.primaryProfileId,
          JSON.stringify(route.fallbackProfileIds),
          route.allowCrossProviderFallback ? 1 : 0,
          updatedAt
        ]
      }))
    ])
  }

  health() {
    return this.#database.health()
  }

  backupTo(destination: string): Promise<void> {
    return this.#database.backupTo(destination)
  }

  close(): Promise<void> {
    return this.#database.close()
  }
}

export class ControlProjectRepository {
  readonly #database: DatabaseWorkerClient

  private constructor(database: DatabaseWorkerClient) {
    this.#database = database
  }

  static async open(databasePath: string): Promise<ControlProjectRepository> {
    return new ControlProjectRepository(
      await DatabaseWorkerClient.open(databasePath, CONTROL_MIGRATIONS)
    )
  }

  async recordOpened(
    project: ProjectSummary,
    openedAt: string,
    lastBackupPath?: string
  ): Promise<void> {
    await this.#database.transaction([
      {
        sql: 'DELETE FROM recent_projects WHERE project_path = ? AND project_id <> ?',
        params: [project.root, project.projectId]
      },
      {
        sql: `INSERT INTO recent_projects (
               project_id, title, project_path, last_opened_at, last_backup_path
             ) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(project_id) DO UPDATE SET
               title = excluded.title,
               project_path = excluded.project_path,
               last_opened_at = excluded.last_opened_at,
               last_backup_path = COALESCE(
                 excluded.last_backup_path,
                 recent_projects.last_backup_path
               )`,
        params: [
          project.projectId,
          project.title,
          project.root,
          openedAt,
          lastBackupPath ?? null
        ]
      }
    ])
  }

  async list(): Promise<RecentProjectSummary[]> {
    const rows = await this.#database.all<RecentProjectRow>(
      `SELECT project_id, title, project_path, last_opened_at, last_backup_path
       FROM recent_projects ORDER BY last_opened_at DESC`
    )
    return Promise.all(rows.map(async (row) => ({
      projectId: row.project_id,
      title: row.title,
      projectPath: row.project_path,
      lastOpenedAt: row.last_opened_at,
      ...(row.last_backup_path === null ? {} : { lastBackupPath: row.last_backup_path }),
      pathAvailable: await Promise.all([
        access(join(row.project_path, 'open-novel.json')),
        access(join(row.project_path, 'project.sqlite3'))
      ]).then(() => true, () => false)
    })))
  }

  async setBackup(projectId: string, backupPath: string): Promise<void> {
    await this.#database.run(
      'UPDATE recent_projects SET last_backup_path = ? WHERE project_id = ?',
      [backupPath, projectId]
    )
  }

  async remove(projectId: string): Promise<void> {
    await this.#database.run('DELETE FROM recent_projects WHERE project_id = ?', [projectId])
  }

  close(): Promise<void> {
    return this.#database.close()
  }
}
