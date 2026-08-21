CREATE TABLE IF NOT EXISTS party_extraction_records (
  publication_id uuid NOT NULL REFERENCES judicial_publications(id) ON DELETE CASCADE,
  parser_version text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL CHECK (status IN ('EXTRACTED', 'NO_CANDIDATES', 'FAILED')),
  candidates_found integer NOT NULL DEFAULT 0 CHECK (candidates_found >= 0),
  details jsonb NOT NULL DEFAULT '{}',
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (publication_id, parser_version)
);

CREATE INDEX IF NOT EXISTS party_extraction_records_provider_idx
  ON party_extraction_records (provider, parser_version, status, processed_at DESC);
