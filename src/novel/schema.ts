export type DatabaseMigration = {
  version: number
  name: string
  sql: string
}

export const PROJECT_MIGRATIONS: readonly DatabaseMigration[] = [
  {
    version: 1,
    name: 'project-foundation',
    sql: `
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE project_settings (
        project_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, key),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
    `
  }
]

export const CONTROL_MIGRATIONS: readonly DatabaseMigration[] = [
  {
    version: 1,
    name: 'control-projects',
    sql: `
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE recent_projects (
        project_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        project_path TEXT NOT NULL UNIQUE,
        last_opened_at TEXT NOT NULL,
        last_backup_path TEXT
      );
    `
  }
]
