CREATE TABLE IF NOT EXISTS case_party_discovery_status (
  case_id uuid NOT NULL REFERENCES judicial_cases(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'PARTIES_FOUND', 'NO_PUBLIC_PARTIES', 'PARSER_FAILED', 'SOURCE_FAILED',
    'DETAIL_NOT_FETCHED', 'DETAIL_UNAVAILABLE', 'DETAIL_INVALID'
  )),
  list_fetched boolean NOT NULL DEFAULT false,
  detail_fetched boolean NOT NULL DEFAULT false,
  history_fetched boolean NOT NULL DEFAULT false,
  publications_parsed integer NOT NULL DEFAULT 0 CHECK (publications_parsed >= 0),
  named_candidates integer NOT NULL DEFAULT 0 CHECK (named_candidates >= 0),
  accepted_parties integer NOT NULL DEFAULT 0 CHECK (accepted_parties >= 0),
  rejected_candidates integer NOT NULL DEFAULT 0 CHECK (rejected_candidates >= 0),
  parser_version text,
  last_error_code text,
  last_error_message text,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (case_id, provider)
);

CREATE INDEX IF NOT EXISTS case_party_discovery_provider_status_idx
  ON case_party_discovery_status (provider, status, last_attempt_at DESC);

CREATE TABLE IF NOT EXISTS global_index_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id text NOT NULL UNIQUE,
  provider text NOT NULL CHECK (provider IN (
    'jalisco-cjj', 'federal-pjf-session-lists', 'jalisco-stj-chambers'
  )),
  status text NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  dry_run boolean NOT NULL DEFAULT true,
  date_from date NOT NULL,
  date_to date NOT NULL,
  court_external_id text,
  circuit_external_id text,
  cursor jsonb NOT NULL DEFAULT '{}',
  units_attempted integer NOT NULL DEFAULT 0,
  units_succeeded integer NOT NULL DEFAULT 0,
  units_failed integer NOT NULL DEFAULT 0,
  records_fetched integer NOT NULL DEFAULT 0,
  records_inserted integer NOT NULL DEFAULT 0,
  parties_found integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_error_code text,
  details jsonb NOT NULL DEFAULT '{}',
  CHECK (date_from <= date_to)
);

CREATE INDEX IF NOT EXISTS global_index_runs_resume_idx
  ON global_index_runs (provider, status, started_at DESC);
