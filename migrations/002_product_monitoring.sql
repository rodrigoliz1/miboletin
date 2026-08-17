ALTER TABLE courts ADD COLUMN IF NOT EXISTS normalized_name text;
ALTER TABLE courts ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE courts ADD COLUMN IF NOT EXISTS court_type text;
ALTER TABLE courts ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE TABLE IF NOT EXISTS case_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  color text NOT NULL DEFAULT 'BURGUNDY',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

ALTER TABLE monitored_cases ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES case_folders(id) ON DELETE SET NULL;
ALTER TABLE monitored_cases ADD COLUMN IF NOT EXISTS monitor_from date NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE monitored_cases ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE monitored_cases ADD COLUMN IF NOT EXISTS last_successful_check_at timestamptz;
ALTER TABLE monitored_cases ADD COLUMN IF NOT EXISTS source_status text NOT NULL DEFAULT 'PENDING';
ALTER TABLE monitored_cases ADD COLUMN IF NOT EXISTS source_message text;

ALTER TABLE judicial_publications ADD COLUMN IF NOT EXISTS promotion_date date;
ALTER TABLE judicial_publications ADD COLUMN IF NOT EXISTS publication_kind text NOT NULL DEFAULT 'AGREEMENT';

ALTER TABLE source_snapshots ADD COLUMN IF NOT EXISTS court_external_id text;
ALTER TABLE source_snapshots ADD COLUMN IF NOT EXISTS publication_date date;
ALTER TABLE source_snapshots ADD COLUMN IF NOT EXISTS request_method text NOT NULL DEFAULT 'GET';
ALTER TABLE source_snapshots ADD COLUMN IF NOT EXISTS http_status integer;

CREATE TABLE IF NOT EXISTS federal_session_details (
  publication_id uuid PRIMARY KEY REFERENCES judicial_publications(id) ON DELETE CASCADE,
  neun text,
  row_external_id text,
  filter_kind text NOT NULL CHECK (filter_kind IN ('lista','sesion')),
  session_type text NOT NULL CHECK (session_type IN ('ORDINARY','EXTRAORDINARY')),
  list_date date NOT NULL,
  session_date date,
  result text,
  rapporteur text,
  project_secretary text,
  responsible_authority text,
  judgment text,
  project_publicity text,
  source_file text
);

ALTER TABLE ingestion_runs ADD COLUMN IF NOT EXISTS courts_attempted integer NOT NULL DEFAULT 0;
ALTER TABLE ingestion_runs ADD COLUMN IF NOT EXISTS courts_successful integer NOT NULL DEFAULT 0;
ALTER TABLE ingestion_runs ADD COLUMN IF NOT EXISTS courts_failed integer NOT NULL DEFAULT 0;
ALTER TABLE ingestion_runs ADD COLUMN IF NOT EXISTS last_snapshot_hash char(64);

CREATE UNIQUE INDEX IF NOT EXISTS monitored_cases_org_case_unique
  ON monitored_cases (case_id, organization_id) WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS monitored_cases_user_case_unique
  ON monitored_cases (case_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS folders_org_name_idx ON case_folders (organization_id, name);
CREATE INDEX IF NOT EXISTS monitored_folder_active_idx ON monitored_cases (folder_id, active);
CREATE INDEX IF NOT EXISTS monitored_source_check_idx ON monitored_cases (source_status, last_checked_at);
CREATE INDEX IF NOT EXISTS publications_source_period_idx ON judicial_publications (publication_kind, publication_date DESC, court_id);
CREATE INDEX IF NOT EXISTS federal_session_date_idx ON federal_session_details (session_date DESC, filter_kind);
CREATE INDEX IF NOT EXISTS snapshots_court_date_idx ON source_snapshots (provider, court_external_id, publication_date, retrieved_at DESC);

