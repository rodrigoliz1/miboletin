CREATE OR REPLACE FUNCTION public.judicial_name_token_signature(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(string_agg(token, ' ' ORDER BY token), '')
  FROM (
    SELECT DISTINCT token
    FROM regexp_split_to_table(
      upper(unaccent(regexp_replace(COALESCE(value, ''), '[^[:alnum:]ÁÉÍÓÚÜÑ]+', ' ', 'g'))),
      '\s+'
    ) AS token
    WHERE length(token) > 1
      AND token NOT IN ('C', 'LIC', 'LICENCIADO', 'LICENCIADA')
  ) tokens;
$$;

ALTER TABLE case_parties
  ADD COLUMN IF NOT EXISTS token_signature text;

ALTER TABLE case_party_mentions
  ADD COLUMN IF NOT EXISTS token_signature text;

UPDATE case_parties
SET token_signature = public.judicial_name_token_signature(search_name)
WHERE token_signature IS NULL OR token_signature = '';

UPDATE case_party_mentions
SET token_signature = public.judicial_name_token_signature(search_name)
WHERE token_signature IS NULL OR token_signature = '';

ALTER TABLE case_parties ALTER COLUMN token_signature SET NOT NULL;
ALTER TABLE case_party_mentions ALTER COLUMN token_signature SET NOT NULL;

CREATE OR REPLACE FUNCTION public.complete_case_party_search_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.name_canonical := COALESCE(
    NULLIF(btrim(NEW.name_canonical), ''),
    NULLIF(btrim(NEW.name_raw), ''),
    NULLIF(btrim(NEW.name_normalized), '')
  );
  NEW.search_name := COALESCE(
    NULLIF(btrim(NEW.search_name), ''),
    NULLIF(btrim(NEW.name_normalized), ''),
    NEW.name_canonical
  );
  NEW.token_signature := public.judicial_name_token_signature(NEW.search_name);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_case_party_mention_signature()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.token_signature := public.judicial_name_token_signature(NEW.search_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS case_party_mentions_complete_signature ON case_party_mentions;
CREATE TRIGGER case_party_mentions_complete_signature
BEFORE INSERT OR UPDATE OF search_name
ON case_party_mentions
FOR EACH ROW
EXECUTE FUNCTION public.complete_case_party_mention_signature();

CREATE INDEX IF NOT EXISTS case_parties_token_signature_idx
  ON case_parties (token_signature) WHERE active;
CREATE INDEX IF NOT EXISTS case_parties_token_signature_trgm_idx
  ON case_parties USING GIN (token_signature gin_trgm_ops) WHERE active;
CREATE INDEX IF NOT EXISTS case_parties_provider_lookup_idx
  ON case_parties (case_id, active, updated_at DESC);
CREATE INDEX IF NOT EXISTS case_party_mentions_publication_date_idx
  ON case_party_mentions (provider, publication_date DESC, case_id);

CREATE TABLE IF NOT EXISTS judicial_source_catalog (
  provider text NOT NULL,
  external_id text NOT NULL,
  parent_external_id text NOT NULL DEFAULT '',
  name text NOT NULL,
  normalized_name text NOT NULL,
  group_name text,
  matter text,
  supported_modes text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (provider, external_id, parent_external_id)
);

CREATE INDEX IF NOT EXISTS judicial_source_catalog_provider_active_idx
  ON judicial_source_catalog (provider, active, group_name, normalized_name);

CREATE TABLE IF NOT EXISTS judicial_source_coverage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  court_external_id text NOT NULL,
  parent_external_id text NOT NULL DEFAULT '',
  coverage_date date NOT NULL,
  resource_kind text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'PENDING', 'PROCESSING', 'COMPLETE', 'PARTIAL', 'FAILED', 'RETRY', 'UNSUPPORTED'
  )),
  discovery_completed boolean NOT NULL DEFAULT false,
  fetch_completed boolean NOT NULL DEFAULT false,
  parse_completed boolean NOT NULL DEFAULT false,
  index_completed boolean NOT NULL DEFAULT false,
  publications_found integer NOT NULL DEFAULT 0 CHECK (publications_found >= 0),
  cases_found integer NOT NULL DEFAULT 0 CHECK (cases_found >= 0),
  documents_processed integer NOT NULL DEFAULT 0 CHECK (documents_processed >= 0),
  names_extracted integer NOT NULL DEFAULT 0 CHECK (names_extracted >= 0),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  first_processed_at timestamptz,
  last_processed_at timestamptz,
  next_retry_at timestamptz,
  lease_owner text,
  lease_until timestamptz,
  checksum text,
  last_error_code text,
  last_error_message text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, court_external_id, parent_external_id, coverage_date, resource_kind)
);

CREATE INDEX IF NOT EXISTS judicial_source_coverage_status_idx
  ON judicial_source_coverage (status, next_retry_at, coverage_date, provider);
CREATE INDEX IF NOT EXISTS judicial_source_coverage_provider_court_date_idx
  ON judicial_source_coverage (provider, court_external_id, coverage_date DESC, resource_kind);
CREATE INDEX IF NOT EXISTS judicial_source_coverage_incomplete_idx
  ON judicial_source_coverage (provider, coverage_date, court_external_id)
  WHERE status IN ('PENDING', 'PARTIAL', 'FAILED', 'RETRY');

CREATE TABLE IF NOT EXISTS judicial_deep_search_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_hash text NOT NULL,
  query_raw text NOT NULL,
  query_normalized text NOT NULL,
  token_signature text NOT NULL,
  provider text,
  jurisdiction text CHECK (jurisdiction IS NULL OR jurisdiction IN ('JALISCO', 'FEDERAL')),
  court_external_id text,
  date_from date NOT NULL,
  date_to date NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETE', 'PARTIAL', 'FAILED', 'CANCELLED')),
  cursor jsonb NOT NULL DEFAULT '{}',
  units_total integer NOT NULL DEFAULT 0,
  units_processed integer NOT NULL DEFAULT 0,
  units_succeeded integer NOT NULL DEFAULT 0,
  units_failed integer NOT NULL DEFAULT 0,
  results_before integer NOT NULL DEFAULT 0,
  results_after integer NOT NULL DEFAULT 0,
  lease_owner text,
  lease_until timestamptz,
  last_error_code text,
  last_error_message text,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (date_from <= date_to)
);

CREATE UNIQUE INDEX IF NOT EXISTS judicial_deep_search_jobs_active_identity_idx
  ON judicial_deep_search_jobs (organization_id, request_hash)
  WHERE status IN ('PENDING', 'RUNNING', 'PARTIAL');
CREATE INDEX IF NOT EXISTS judicial_deep_search_jobs_queue_idx
  ON judicial_deep_search_jobs (status, lease_until, created_at);

CREATE TABLE IF NOT EXISTS judicial_index_anomalies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  court_external_id text,
  coverage_date date,
  kind text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  message text NOT NULL,
  observed_value numeric,
  expected_value numeric,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS judicial_index_anomalies_open_idx
  ON judicial_index_anomalies (status, severity, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS judicial_index_anomalies_unit_kind_idx
  ON judicial_index_anomalies (provider, COALESCE(court_external_id, ''), COALESCE(coverage_date, '0001-01-01'::date), kind)
  WHERE status = 'OPEN';
