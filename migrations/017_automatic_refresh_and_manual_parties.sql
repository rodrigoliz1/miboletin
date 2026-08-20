ALTER TABLE monitored_cases
  ADD COLUMN IF NOT EXISTS manual_plaintiff text,
  ADD COLUMN IF NOT EXISTS manual_defendant text;

CREATE TABLE IF NOT EXISTS scheduled_job_locks (
  job_key text PRIMARY KEY,
  owner_token uuid NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz NOT NULL,
  CHECK (locked_until > locked_at)
);

CREATE INDEX IF NOT EXISTS monitored_cases_automatic_refresh_idx
  ON monitored_cases (last_checked_at NULLS FIRST, created_at)
  WHERE active AND deleted_at IS NULL;
