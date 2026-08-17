ALTER TABLE monitored_cases
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id);

CREATE TABLE IF NOT EXISTS monitored_case_folders (
  monitored_case_id uuid NOT NULL REFERENCES monitored_cases(id) ON DELETE CASCADE,
  folder_id uuid NOT NULL REFERENCES case_folders(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (monitored_case_id, folder_id)
);

INSERT INTO monitored_case_folders (monitored_case_id, folder_id)
SELECT id, folder_id
FROM monitored_cases
WHERE folder_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS monitored_case_folders_folder_idx
  ON monitored_case_folders (folder_id, monitored_case_id);

CREATE TABLE IF NOT EXISTS billing_customers (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  stripe_subscription_id text UNIQUE,
  stripe_price_id text,
  status text NOT NULL DEFAULT 'incomplete' CHECK (status IN (
    'trialing', 'active', 'past_due', 'canceled', 'unpaid',
    'incomplete', 'incomplete_expired', 'paused'
  )),
  currency char(3),
  unit_amount integer CHECK (unit_amount IS NULL OR unit_amount >= 0),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at timestamptz,
  last_invoice_id text,
  last_payment_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_subscriptions_status_idx
  ON billing_subscriptions (status, current_period_end);

CREATE TABLE IF NOT EXISTS billing_events (
  stripe_event_id text PRIMARY KEY,
  event_type text NOT NULL,
  livemode boolean NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactional_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL UNIQUE,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  kind text NOT NULL,
  recipient_hash char(64) NOT NULL,
  provider_message_id text,
  status text NOT NULL CHECK (status IN ('SENT', 'SKIPPED', 'FAILED')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transactional_email_log_org_idx
  ON transactional_email_log (organization_id, created_at DESC);
