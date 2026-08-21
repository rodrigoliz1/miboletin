ALTER TABLE case_parties
  ADD COLUMN IF NOT EXISTS name_canonical text,
  ADD COLUMN IF NOT EXISTS search_name text,
  ADD COLUMN IF NOT EXISTS party_type text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS confidence numeric(4,3),
  ADD COLUMN IF NOT EXISTS extraction_method text,
  ADD COLUMN IF NOT EXISTS parser_version text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE case_parties
SET name_canonical = COALESCE(name_canonical, name_raw),
    search_name = COALESCE(search_name, name_normalized),
    extraction_method = COALESCE(extraction_method, 'legacy'),
    parser_version = COALESCE(parser_version, 'legacy-1')
WHERE name_canonical IS NULL
   OR search_name IS NULL
   OR extraction_method IS NULL
   OR parser_version IS NULL;

ALTER TABLE case_parties
  ALTER COLUMN name_canonical SET NOT NULL,
  ALTER COLUMN search_name SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'case_parties_party_type_check'
  ) THEN
    ALTER TABLE case_parties ADD CONSTRAINT case_parties_party_type_check
      CHECK (party_type IN ('PERSON', 'COMPANY', 'AUTHORITY', 'UNKNOWN'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'case_parties_confidence_check'
  ) THEN
    ALTER TABLE case_parties ADD CONSTRAINT case_parties_confidence_check
      CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS case_parties_search_name_trgm_idx
  ON case_parties USING GIN (search_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS case_parties_search_name_prefix_idx
  ON case_parties (search_name text_pattern_ops);
CREATE INDEX IF NOT EXISTS case_parties_case_side_type_idx
  ON case_parties (case_id, side, party_type);

CREATE TABLE IF NOT EXISTS case_party_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_party_id uuid NOT NULL REFERENCES case_parties(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES judicial_cases(id) ON DELETE CASCADE,
  publication_id uuid REFERENCES judicial_publications(id) ON DELETE CASCADE,
  snapshot_id uuid REFERENCES source_snapshots(id) ON DELETE SET NULL,
  provider text NOT NULL,
  name_raw text NOT NULL,
  name_normalized text NOT NULL,
  search_name text NOT NULL,
  role_raw text,
  side text NOT NULL,
  party_type text NOT NULL DEFAULT 'UNKNOWN',
  extraction_method text NOT NULL,
  confidence numeric(4,3) NOT NULL,
  source_fragment text,
  source_url text,
  publication_date date,
  parser_version text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (party_type IN ('PERSON', 'COMPANY', 'AUTHORITY', 'UNKNOWN')),
  CHECK (confidence BETWEEN 0 AND 1),
  CHECK (char_length(source_fragment) <= 1000)
);

CREATE UNIQUE INDEX IF NOT EXISTS case_party_mentions_identity_idx
  ON case_party_mentions (
    case_party_id,
    COALESCE(publication_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(snapshot_id, '00000000-0000-0000-0000-000000000000'::uuid),
    name_normalized,
    side,
    extraction_method,
    parser_version
  );
CREATE INDEX IF NOT EXISTS case_party_mentions_case_idx
  ON case_party_mentions (case_id, publication_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS case_party_mentions_party_idx
  ON case_party_mentions (case_party_id, created_at DESC);
CREATE INDEX IF NOT EXISTS case_party_mentions_name_trgm_idx
  ON case_party_mentions USING GIN (search_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS case_party_mentions_provider_idx
  ON case_party_mentions (provider, extraction_method, publication_date DESC);

CREATE TABLE IF NOT EXISTS case_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_case_id uuid NOT NULL REFERENCES judicial_cases(id) ON DELETE CASCADE,
  target_case_id uuid NOT NULL REFERENCES judicial_cases(id) ON DELETE CASCADE,
  relation_type text NOT NULL,
  confidence numeric(4,3) NOT NULL,
  extraction_method text NOT NULL,
  parser_version text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_case_id <> target_case_id),
  CHECK (relation_type IN ('APPEAL_OF', 'ORIGIN_OF', 'AMPARO_FROM', 'REVIEW_OF', 'RELATED_TO')),
  CHECK (confidence BETWEEN 0 AND 1),
  UNIQUE (source_case_id, target_case_id, relation_type)
);

CREATE INDEX IF NOT EXISTS case_relations_source_idx ON case_relations (source_case_id, relation_type);
CREATE INDEX IF NOT EXISTS case_relations_target_idx ON case_relations (target_case_id, relation_type);
CREATE INDEX IF NOT EXISTS case_relations_type_idx ON case_relations (relation_type, confidence DESC);

CREATE TABLE IF NOT EXISTS party_extraction_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id text NOT NULL UNIQUE,
  provider text,
  parser_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  dry_run boolean NOT NULL DEFAULT false,
  cursor_publication_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  snapshots_processed integer NOT NULL DEFAULT 0,
  parties_found integer NOT NULL DEFAULT 0,
  parties_created integer NOT NULL DEFAULT 0,
  mentions_created integer NOT NULL DEFAULT 0,
  relations_created integer NOT NULL DEFAULT 0,
  ambiguous integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS party_extraction_runs_provider_idx
  ON party_extraction_runs (provider, started_at DESC);

CREATE TABLE IF NOT EXISTS watch_rule_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_rule_id uuid NOT NULL REFERENCES watch_rules(id) ON DELETE CASCADE,
  case_party_id uuid NOT NULL REFERENCES case_parties(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES judicial_cases(id) ON DELETE CASCADE,
  publication_id uuid REFERENCES judicial_publications(id) ON DELETE CASCADE,
  match_result match_result NOT NULL,
  score numeric(5,4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (score BETWEEN 0 AND 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS watch_rule_matches_identity_idx
  ON watch_rule_matches (
    watch_rule_id,
    case_party_id,
    COALESCE(publication_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
CREATE INDEX IF NOT EXISTS watch_rule_matches_rule_idx ON watch_rule_matches (watch_rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS watch_rule_matches_case_idx ON watch_rule_matches (case_id, created_at DESC);

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS watch_rule_match_id uuid REFERENCES watch_rule_matches(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_watch_rule_match_idx
  ON notifications (watch_rule_match_id, user_id, channel)
  WHERE watch_rule_match_id IS NOT NULL;
