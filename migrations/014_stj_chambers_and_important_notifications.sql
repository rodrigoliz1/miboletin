CREATE TABLE IF NOT EXISTS stj_case_details (
  judicial_case_id uuid PRIMARY KEY REFERENCES judicial_cases(id) ON DELETE CASCADE,
  chamber_external_id text NOT NULL,
  origin_case_number text,
  origin_court text,
  judicial_district text,
  appeal_type text,
  proceeding text,
  sentence_state text NOT NULL DEFAULT 'NOT_EXPECTED' CHECK (sentence_state IN (
    'NOT_EXPECTED', 'PENDING_PUBLICATION', 'AVAILABLE', 'NOT_FOUND', 'UNAVAILABLE', 'ERROR'
  )),
  possible_sentence_at timestamptz,
  next_retry_at timestamptz,
  last_attempt_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0,
  judgment_external_id text,
  unavailable_reason text,
  official_search_url text NOT NULL DEFAULT 'https://publicacionsentencias.stjjalisco.gob.mx/sentencias',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stj_case_sentence_retry_idx
  ON stj_case_details (sentence_state, next_retry_at)
  WHERE sentence_state IN ('PENDING_PUBLICATION', 'NOT_FOUND', 'UNAVAILABLE', 'ERROR');

CREATE TABLE IF NOT EXISTS judicial_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  judicial_case_id uuid NOT NULL REFERENCES judicial_cases(id) ON DELETE CASCADE,
  provider text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('JUDGMENT')),
  official_external_id text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 4),
  sha256 char(64) NOT NULL,
  content bytea NOT NULL,
  source_url text NOT NULL,
  published_at timestamptz,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, official_external_id, sha256)
);

CREATE INDEX IF NOT EXISTS judicial_documents_case_idx
  ON judicial_documents (judicial_case_id, retrieved_at DESC);

CREATE TABLE IF NOT EXISTS document_retrieval_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  judicial_case_id uuid NOT NULL REFERENCES judicial_cases(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL CHECK (status IN ('AVAILABLE', 'NOT_FOUND', 'UNAVAILABLE', 'ERROR', 'INVALID_DOCUMENT')),
  http_status integer,
  message text,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_retrieval_attempts_case_idx
  ON document_retrieval_attempts (judicial_case_id, attempted_at DESC);

-- No agotar Brevo con resoluciones ordinarias que ya estuvieran en cola.
DELETE FROM notifications n
USING case_movements cm, judicial_publications jp
WHERE n.movement_id = cm.id
  AND cm.publication_id = jp.id
  AND n.channel = 'EMAIL'
  AND n.status = 'QUEUED'
  AND jp.publication_kind NOT IN ('SESSION_LISTED', 'SESSION_RESULT', 'STJ_JUDGMENT')
  AND jp.official_text !~* '(^|[^[:alpha:]])sentencias?([^[:alpha:]]|$)';
