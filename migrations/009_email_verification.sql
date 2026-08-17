ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

-- Las cuentas creadas antes de introducir OTP se conservan verificadas para no bloquear usuarios existentes.
UPDATE users
SET email_verified_at = COALESCE(email_verified_at, created_at)
WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS email_verification_codes (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
  send_count smallint NOT NULL DEFAULT 1 CHECK (send_count BETWEEN 0 AND 20),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_verification_codes_expiry_idx
  ON email_verification_codes (expires_at)
  WHERE consumed_at IS NULL;
