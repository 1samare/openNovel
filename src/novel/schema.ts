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
  },
  {
    version: 3,
    name: 'model-role-bindings',
    sql: `
      CREATE TABLE generation_mode_defaults (
        mode TEXT PRIMARY KEY CHECK (mode IN ('quick', 'standard', 'deep')),
        primary_profile_id TEXT NOT NULL,
        fallback_profile_ids_json TEXT NOT NULL DEFAULT '[]',
        allow_cross_provider_fallback INTEGER NOT NULL DEFAULT 0
          CHECK (allow_cross_provider_fallback IN (0, 1)),
        updated_at TEXT NOT NULL
      );
      CREATE TABLE agent_role_bindings (
        role TEXT NOT NULL CHECK (
          role IN ('editor', 'setting', 'character', 'plot', 'writer', 'reviewer')
        ),
        mode TEXT NOT NULL CHECK (mode IN ('quick', 'standard', 'deep')),
        primary_profile_id TEXT NOT NULL,
        fallback_profile_ids_json TEXT NOT NULL DEFAULT '[]',
        allow_cross_provider_fallback INTEGER NOT NULL DEFAULT 0
          CHECK (allow_cross_provider_fallback IN (0, 1)),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (role, mode)
      );
      CREATE INDEX idx_agent_role_bindings_profile
        ON agent_role_bindings(primary_profile_id);
    `
  },
  {
    version: 4,
    name: 'novel-bible-and-structured-coauthoring',
    sql: `
      CREATE TABLE bible_source_versions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        entity_type TEXT NOT NULL CHECK (entity_type IN (
          'novel-profile', 'world-setting', 'location', 'faction', 'item',
          'character', 'relationship', 'character-state', 'timeline-event',
          'foreshadow', 'story', 'volume', 'stage', 'chapter-plan'
        )),
        entity_id TEXT NOT NULL,
        version_number INTEGER NOT NULL CHECK (version_number > 0),
        authority_status TEXT NOT NULL CHECK (authority_status IN ('user_confirmed', 'approved')),
        source_kind TEXT NOT NULL CHECK (source_kind IN ('user', 'agent', 'restore')),
        source_run_id TEXT,
        proposal_id TEXT,
        snapshot_json TEXT NOT NULL,
        supersedes_version_id TEXT,
        restored_from_version_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (supersedes_version_id) REFERENCES bible_source_versions(id) ON DELETE SET NULL,
        FOREIGN KEY (restored_from_version_id) REFERENCES bible_source_versions(id) ON DELETE SET NULL,
        UNIQUE (entity_type, entity_id, version_number)
      );
      CREATE TABLE novel_profiles (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL UNIQUE,
        genre TEXT NOT NULL CHECK (genre IN ('urban-campus', 'sci-fi-future')),
        audience TEXT NOT NULL,
        theme TEXT NOT NULL,
        narrative_pov TEXT NOT NULL,
        tone TEXT NOT NULL,
        style_sample TEXT NOT NULL,
        banned_expressions_json TEXT NOT NULL DEFAULT '[]',
        authority_status TEXT NOT NULL CHECK (authority_status IN ('user_confirmed', 'approved')),
        current_version_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE world_settings (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
        fields_json TEXT NOT NULL DEFAULT '[]', related_entity_ids_json TEXT NOT NULL DEFAULT '[]',
        authority_status TEXT NOT NULL CHECK (authority_status IN ('user_confirmed', 'approved')),
        current_version_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE locations (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
        fields_json TEXT NOT NULL DEFAULT '[]', related_entity_ids_json TEXT NOT NULL DEFAULT '[]',
        authority_status TEXT NOT NULL CHECK (authority_status IN ('user_confirmed', 'approved')),
        current_version_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE factions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
        fields_json TEXT NOT NULL DEFAULT '[]', related_entity_ids_json TEXT NOT NULL DEFAULT '[]',
        authority_status TEXT NOT NULL CHECK (authority_status IN ('user_confirmed', 'approved')),
        current_version_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE items (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
        fields_json TEXT NOT NULL DEFAULT '[]', related_entity_ids_json TEXT NOT NULL DEFAULT '[]',
        authority_status TEXT NOT NULL CHECK (authority_status IN ('user_confirmed', 'approved')),
        current_version_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE characters (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
        fields_json TEXT NOT NULL DEFAULT '[]', related_entity_ids_json TEXT NOT NULL DEFAULT '[]',
        authority_status TEXT NOT NULL CHECK (authority_status IN ('user_confirmed', 'approved')),
        current_version_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE character_relationships (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
        fields_json TEXT NOT NULL DEFAULT '[]', related_entity_ids_json TEXT NOT NULL DEFAULT '[]',
        authority_status TEXT NOT NULL CHECK (authority_status IN ('user_confirmed', 'approved')),
        current_version_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE character_states (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
        fields_json TEXT NOT NULL DEFAULT '[]', related_entity_ids_json TEXT NOT NULL DEFAULT '[]',
        authority_status TEXT NOT NULL CHECK (authority_status IN ('user_confirmed', 'approved')),
        current_version_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE timeline_events (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
        fields_json TEXT NOT NULL DEFAULT '[]', related_entity_ids_json TEXT NOT NULL DEFAULT '[]',
        authority_status TEXT NOT NULL CHECK (authority_status IN ('user_confirmed', 'approved')),
        current_version_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE foreshadows (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
        fields_json TEXT NOT NULL DEFAULT '[]', related_entity_ids_json TEXT NOT NULL DEFAULT '[]',
        authority_status TEXT NOT NULL CHECK (authority_status IN ('user_confirmed', 'approved')),
        current_version_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE TABLE story_outlines (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
        goal TEXT NOT NULL, conflict TEXT NOT NULL, turning_point TEXT NOT NULL, hook TEXT NOT NULL,
        target_words INTEGER NOT NULL CHECK (target_words >= 0),
        participant_character_ids_json TEXT NOT NULL DEFAULT '[]', position INTEGER NOT NULL CHECK (position >= 0),
        authority_status TEXT NOT NULL CHECK (authority_status IN ('user_confirmed', 'approved')),
        current_version_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE (project_id, position)
      );
      CREATE TABLE story_volumes (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, story_outline_id TEXT NOT NULL,
        title TEXT NOT NULL, summary TEXT NOT NULL, goal TEXT NOT NULL, conflict TEXT NOT NULL,
        turning_point TEXT NOT NULL, hook TEXT NOT NULL, target_words INTEGER NOT NULL CHECK (target_words >= 0),
        participant_character_ids_json TEXT NOT NULL DEFAULT '[]', position INTEGER NOT NULL CHECK (position >= 0),
        authority_status TEXT NOT NULL CHECK (authority_status IN ('user_confirmed', 'approved')),
        current_version_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (story_outline_id) REFERENCES story_outlines(id) ON DELETE CASCADE,
        UNIQUE (story_outline_id, position)
      );
      CREATE TABLE story_stages (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, story_volume_id TEXT NOT NULL,
        title TEXT NOT NULL, summary TEXT NOT NULL, goal TEXT NOT NULL, conflict TEXT NOT NULL,
        turning_point TEXT NOT NULL, hook TEXT NOT NULL, target_words INTEGER NOT NULL CHECK (target_words >= 0),
        participant_character_ids_json TEXT NOT NULL DEFAULT '[]', position INTEGER NOT NULL CHECK (position >= 0),
        authority_status TEXT NOT NULL CHECK (authority_status IN ('user_confirmed', 'approved')),
        current_version_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (story_volume_id) REFERENCES story_volumes(id) ON DELETE CASCADE,
        UNIQUE (story_volume_id, position)
      );
      CREATE TABLE chapter_plans (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, story_stage_id TEXT NOT NULL, chapter_id TEXT,
        title TEXT NOT NULL, summary TEXT NOT NULL, goal TEXT NOT NULL, conflict TEXT NOT NULL,
        turning_point TEXT NOT NULL, hook TEXT NOT NULL, target_words INTEGER NOT NULL CHECK (target_words >= 0),
        participant_character_ids_json TEXT NOT NULL DEFAULT '[]', position INTEGER NOT NULL CHECK (position >= 0),
        authority_status TEXT NOT NULL CHECK (authority_status IN ('user_confirmed', 'approved')),
        current_version_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (story_stage_id) REFERENCES story_stages(id) ON DELETE CASCADE,
        FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL,
        UNIQUE (story_stage_id, position)
      );
      CREATE TABLE bible_proposals (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_run_id TEXT NOT NULL,
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        domain TEXT NOT NULL CHECK (domain IN ('setting', 'character', 'plot')),
        status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected', 'superseded')),
        target_entity_type TEXT NOT NULL, target_entity_id TEXT, source_version_id TEXT,
        source_version_ids_json TEXT NOT NULL DEFAULT '[]', candidate_json TEXT NOT NULL,
        decided_at TEXT, superseded_by_id TEXT, created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (superseded_by_id) REFERENCES bible_proposals(id) ON DELETE SET NULL
      );
      CREATE TABLE bible_proposal_conflicts (
        id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL, field TEXT NOT NULL,
        old_value TEXT NOT NULL, new_value TEXT NOT NULL, source_version_id TEXT NOT NULL,
        affected_entity_ids_json TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY (proposal_id) REFERENCES bible_proposals(id) ON DELETE CASCADE
      );
      CREATE TABLE bible_proposal_impacts (
        proposal_id TEXT NOT NULL, entity_id TEXT NOT NULL,
        PRIMARY KEY (proposal_id, entity_id),
        FOREIGN KEY (proposal_id) REFERENCES bible_proposals(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_bible_versions_entity ON bible_source_versions(entity_type, entity_id, version_number DESC);
      CREATE INDEX idx_bible_versions_project_status ON bible_source_versions(project_id, authority_status);
      CREATE INDEX idx_bible_proposals_project_status ON bible_proposals(project_id, status, created_at DESC);
      CREATE INDEX idx_world_settings_project ON world_settings(project_id, updated_at DESC);
      CREATE INDEX idx_characters_project ON characters(project_id, updated_at DESC);
      CREATE INDEX idx_timeline_events_project ON timeline_events(project_id, updated_at DESC);
      CREATE INDEX idx_foreshadows_project ON foreshadows(project_id, updated_at DESC);
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
  },
  {
    version: 2,
    name: 'model-connections-profiles-and-logs',
    sql: `
      CREATE TABLE provider_connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        kind TEXT NOT NULL CHECK (kind IN ('openai-compatible', 'anthropic', 'gemini')),
        base_url TEXT,
        secret_ref TEXT NOT NULL UNIQUE,
        secret_hint TEXT NOT NULL CHECK (length(secret_hint) BETWEEN 1 AND 16),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE model_profiles (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL,
        label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
        model_id TEXT NOT NULL CHECK (length(model_id) BETWEEN 1 AND 256),
        temperature REAL NOT NULL CHECK (temperature >= 0 AND temperature <= 2),
        max_output_tokens INTEGER NOT NULL CHECK (max_output_tokens > 0),
        context_window INTEGER NOT NULL CHECK (context_window > 0),
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (connection_id) REFERENCES provider_connections(id) ON DELETE RESTRICT,
        UNIQUE (connection_id, model_id, label)
      );
      CREATE TABLE model_call_logs (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        connection_id TEXT,
        profile_id TEXT,
        provider_kind TEXT NOT NULL CHECK (
          provider_kind IN ('openai-compatible', 'anthropic', 'gemini')
        ),
        model_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'cancelled')),
        latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
        input_tokens INTEGER,
        output_tokens INTEGER,
        estimated_cost_micros INTEGER,
        retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
        error_code TEXT,
        provider_request_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_model_profiles_connection
        ON model_profiles(connection_id);
      CREATE INDEX idx_model_call_logs_created
        ON model_call_logs(created_at DESC);
    `
  }
]
