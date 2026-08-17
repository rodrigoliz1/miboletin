ALTER TABLE monitored_cases
  ADD COLUMN IF NOT EXISTS refresh_started_at timestamptz;

UPDATE monitored_cases
SET source_status = 'PENDING',
    source_message = 'La revisión se reanudará al abrir el asunto.',
    refresh_started_at = NULL
WHERE source_status = 'CHECKING';

CREATE INDEX IF NOT EXISTS monitored_refresh_state_idx
  ON monitored_cases (source_status, refresh_started_at)
  WHERE active;
