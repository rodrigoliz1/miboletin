ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;
ALTER TABLE judicial_publications ADD COLUMN IF NOT EXISTS notebook text;

UPDATE judicial_publications jp
SET notebook = NULLIF(ss.raw_payload->'agreement'->>'notebook', '')
FROM source_snapshots ss
WHERE ss.id = jp.snapshot_id AND jp.notebook IS NULL;

CREATE TABLE IF NOT EXISTS password_reset_codes (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  send_count integer NOT NULL DEFAULT 1 CHECK (send_count > 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_codes_expiry_idx
  ON password_reset_codes (expires_at) WHERE consumed_at IS NULL;
