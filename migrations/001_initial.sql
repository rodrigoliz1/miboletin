CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TYPE user_role AS ENUM ('OWNER','ADMIN','LAWYER','ASSISTANT','MEMBER');
CREATE TYPE source_health AS ENUM ('ONLINE','DEGRADED','FAILED','STALE','UNAVAILABLE');
CREATE TYPE match_result AS ENUM ('EXACT','PROBABLE','AMBIGUOUS','NO_MATCH');
CREATE TYPE notification_status AS ENUM ('QUEUED','SENT','FAILED','READ');
CREATE TYPE ingestion_status AS ENUM ('RUNNING','SUCCEEDED','PARTIAL','FAILED');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role user_role NOT NULL DEFAULT 'MEMBER',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  plan text NOT NULL DEFAULT 'FREE' CHECK (plan IN ('FREE','PRO','FIRM')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id)
);

CREATE TABLE judicial_authorities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  jurisdiction text NOT NULL,
  source_url text NOT NULL
);

CREATE TABLE judicial_circuits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id uuid NOT NULL REFERENCES judicial_authorities(id),
  external_id text NOT NULL,
  name text NOT NULL,
  UNIQUE (authority_id, external_id)
);

CREATE TABLE judicial_districts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circuit_id uuid REFERENCES judicial_circuits(id),
  external_id text NOT NULL,
  name text NOT NULL,
  UNIQUE (circuit_id, external_id)
);

CREATE TABLE courts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id uuid NOT NULL REFERENCES judicial_authorities(id),
  circuit_id uuid REFERENCES judicial_circuits(id),
  district_id uuid REFERENCES judicial_districts(id),
  external_id text NOT NULL,
  name text NOT NULL,
  matter text,
  city text,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (authority_id, external_id)
);

CREATE TABLE judicial_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id uuid NOT NULL REFERENCES judicial_authorities(id),
  court_id uuid NOT NULL REFERENCES courts(id),
  case_type text NOT NULL,
  case_number_raw text NOT NULL,
  case_number_normalized text NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  year integer NOT NULL CHECK (year BETWEEN 1900 AND 2200),
  canonical_key text NOT NULL UNIQUE,
  matter text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE source_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  external_id text,
  source_url text NOT NULL,
  raw_payload jsonb,
  raw_text text,
  response_headers jsonb NOT NULL DEFAULT '{}',
  content_type text,
  retrieved_at timestamptz NOT NULL,
  sha256 char(64) NOT NULL UNIQUE,
  parser_version text NOT NULL,
  provider_version text NOT NULL,
  immutable boolean NOT NULL DEFAULT true CHECK (immutable)
);

CREATE TABLE judicial_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES judicial_cases(id),
  court_id uuid NOT NULL REFERENCES courts(id),
  snapshot_id uuid NOT NULL REFERENCES source_snapshots(id),
  external_id text,
  case_number_raw text NOT NULL,
  case_number_normalized text NOT NULL,
  case_type text,
  official_text text NOT NULL,
  publication_date date NOT NULL,
  agreement_date date,
  retrieved_at timestamptz NOT NULL,
  content_hash char(64) NOT NULL,
  source_url text NOT NULL,
  UNIQUE (court_id, content_hash)
);

CREATE TABLE case_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES judicial_cases(id) ON DELETE CASCADE,
  name_raw text NOT NULL,
  name_normalized text NOT NULL,
  side text NOT NULL,
  UNIQUE (case_id, name_normalized, side)
);

CREATE TABLE monitored_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES judicial_cases(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  label text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((user_id IS NOT NULL)::int + (organization_id IS NOT NULL)::int = 1),
  UNIQUE (case_id, user_id, organization_id)
);

CREATE TABLE watch_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('CASE','PERSON','COMPANY')),
  value_raw text NOT NULL,
  value_normalized text NOT NULL,
  match_mode text NOT NULL CHECK (match_mode IN ('EXACT','FLEXIBLE')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE case_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitored_case_id uuid NOT NULL REFERENCES monitored_cases(id) ON DELETE CASCADE,
  publication_id uuid NOT NULL REFERENCES judicial_publications(id),
  match_result match_result NOT NULL,
  detected_at timestamptz NOT NULL,
  UNIQUE (monitored_case_id, publication_id)
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movement_id uuid REFERENCES case_movements(id),
  channel text NOT NULL CHECK (channel IN ('IN_APP','EMAIL')),
  status notification_status NOT NULL DEFAULT 'QUEUED',
  subject text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (movement_id, user_id, channel)
);

CREATE TABLE ingestion_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id text NOT NULL UNIQUE,
  provider text NOT NULL,
  status ingestion_status NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  duration_ms integer,
  records_fetched integer NOT NULL DEFAULT 0,
  records_inserted integer NOT NULL DEFAULT 0,
  records_updated integer NOT NULL DEFAULT 0,
  duplicates integer NOT NULL DEFAULT 0,
  matches integer NOT NULL DEFAULT 0,
  notifications integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]',
  dry_run boolean NOT NULL DEFAULT false
);

CREATE TABLE source_health_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  status source_health NOT NULL,
  checked_at timestamptz NOT NULL,
  last_successful_fetch timestamptz,
  last_publication_date date,
  latency_ms integer,
  error_rate numeric(6,5) NOT NULL DEFAULT 0,
  records_fetched integer NOT NULL DEFAULT 0,
  parser_version text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE domain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  organization_id uuid REFERENCES organizations(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  ip_hash char(64),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX publications_date_idx ON judicial_publications (publication_date DESC, court_id);
CREATE INDEX publications_case_number_idx ON judicial_publications (case_number_normalized, court_id);
CREATE INDEX publications_text_fts_idx ON judicial_publications USING GIN (to_tsvector('spanish', official_text));
CREATE INDEX parties_name_trgm_idx ON case_parties USING GIN (name_normalized gin_trgm_ops);
CREATE INDEX courts_name_trgm_idx ON courts USING GIN (name gin_trgm_ops);
CREATE INDEX snapshots_provider_date_idx ON source_snapshots (provider, retrieved_at DESC);
CREATE INDEX runs_provider_date_idx ON ingestion_runs (provider, started_at DESC);
CREATE INDEX health_provider_date_idx ON source_health_checks (provider, checked_at DESC);
CREATE INDEX notifications_user_status_idx ON notifications (user_id, status, created_at DESC);
CREATE INDEX audit_org_date_idx ON audit_logs (organization_id, created_at DESC);
