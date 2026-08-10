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
  },
  {
    version: 2,
    name: 'chapter-writing-and-file-exchange',
    sql: `
      CREATE TABLE chapters (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        parent_id TEXT,
        kind TEXT NOT NULL CHECK (kind IN ('volume', 'chapter')),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
        position INTEGER NOT NULL CHECK (position >= 0),
        current_version_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES chapters(id) ON DELETE RESTRICT,
        FOREIGN KEY (current_version_id) REFERENCES chapter_versions(id) ON DELETE SET NULL
          DEFERRABLE INITIALLY DEFERRED,
        UNIQUE (project_id, parent_id, position)
      );
      CREATE TABLE chapter_versions (
        id TEXT PRIMARY KEY,
        chapter_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'confirmed', 'superseded')),
        content TEXT NOT NULL,
        character_count INTEGER NOT NULL CHECK (character_count >= 0),
        source_version_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
        FOREIGN KEY (source_version_id) REFERENCES chapter_versions(id) ON DELETE SET NULL
      );
      CREATE TABLE chapter_drafts (
        chapter_id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
        saved_at TEXT NOT NULL,
        FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
      );
      CREATE TABLE import_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_name TEXT NOT NULL,
        source_format TEXT NOT NULL CHECK (source_format IN ('txt', 'markdown', 'paste')),
        mode TEXT NOT NULL CHECK (mode IN ('reference', 'single-chapter', 'split-chapters')),
        status TEXT NOT NULL CHECK (status IN ('previewed', 'completed', 'failed')),
        preview_json TEXT NOT NULL,
        error_code TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE export_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        format TEXT NOT NULL CHECK (format IN ('txt', 'markdown', 'docx', 'opennovel-zip')),
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
        destination_path TEXT NOT NULL,
        snapshot_hash TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_chapters_project_parent_position
        ON chapters(project_id, parent_id, position);
      CREATE UNIQUE INDEX uq_chapters_sibling_position
        ON chapters(project_id, COALESCE(parent_id, ''), position);
      CREATE INDEX idx_chapter_versions_chapter_created
        ON chapter_versions(chapter_id, created_at DESC);
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
