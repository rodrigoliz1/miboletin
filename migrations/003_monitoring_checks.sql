CREATE TABLE IF NOT EXISTS monitored_case_source_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitored_case_id uuid NOT NULL REFERENCES monitored_cases(id) ON DELETE CASCADE,
  filter_kind text NOT NULL CHECK (filter_kind IN ('lista', 'sesion', 'expediente')),
  checked_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED')),
  records_found integer NOT NULL DEFAULT 0,
  error_message text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (monitored_case_id, filter_kind, checked_date)
);

CREATE INDEX IF NOT EXISTS monitored_case_checks_lookup_idx
  ON monitored_case_source_checks (monitored_case_id, filter_kind, checked_date DESC);
