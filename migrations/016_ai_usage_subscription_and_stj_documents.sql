ALTER TABLE stj_case_details
  ADD COLUMN IF NOT EXISTS official_document_count integer CHECK (official_document_count IS NULL OR official_document_count >= 0),
  ADD COLUMN IF NOT EXISTS available_document_count integer NOT NULL DEFAULT 0 CHECK (available_document_count >= 0);

ALTER TABLE stj_case_details DROP CONSTRAINT IF EXISTS stj_case_details_sentence_state_check;
ALTER TABLE stj_case_details ADD CONSTRAINT stj_case_details_sentence_state_check CHECK (sentence_state IN (
  'NOT_EXPECTED', 'PENDING_PUBLICATION', 'AVAILABLE', 'PARTIAL', 'NOT_FOUND', 'UNAVAILABLE', 'ERROR'
));

DROP INDEX IF EXISTS stj_case_sentence_retry_idx;
CREATE INDEX stj_case_sentence_retry_idx
  ON stj_case_details (sentence_state, next_retry_at)
  WHERE sentence_state IN ('PENDING_PUBLICATION', 'PARTIAL', 'NOT_FOUND', 'UNAVAILABLE', 'ERROR');

ALTER TABLE judicial_documents
  ADD COLUMN IF NOT EXISTS document_label text,
  ADD COLUMN IF NOT EXISTS official_toca text,
  ADD COLUMN IF NOT EXISTS document_sequence integer CHECK (document_sequence IS NULL OR document_sequence > 0),
  ADD COLUMN IF NOT EXISTS official_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE judicial_documents DROP CONSTRAINT IF EXISTS judicial_documents_kind_check;
ALTER TABLE judicial_documents ADD CONSTRAINT judicial_documents_kind_check CHECK (kind IN (
  'JUDGMENT', 'CLARIFICATION', 'RELATED'
));

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES assistant_conversations(id) ON DELETE SET NULL,
  provider text NOT NULL,
  model_used text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('fast', 'pro', 'premium')),
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  total_tokens integer CHECK (total_tokens IS NULL OR total_tokens >= 0),
  cached_input_tokens integer CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  fallback_used boolean NOT NULL DEFAULT false,
  fallback_from text,
  request_type text NOT NULL,
  success boolean NOT NULL,
  error_type text,
  estimated_cost_usd numeric(14, 8),
  provider_response_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS ai_usage_events_org_created_idx
  ON ai_usage_events (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_usage_events_request_idx
  ON ai_usage_events (request_id, attempt_number);
