ALTER TABLE judicial_documents
  ADD COLUMN IF NOT EXISTS storage_provider text NOT NULL DEFAULT 'DATABASE_LEGACY',
  ADD COLUMN IF NOT EXISTS storage_key text;

ALTER TABLE judicial_documents ALTER COLUMN content DROP NOT NULL;

ALTER TABLE judicial_documents DROP CONSTRAINT IF EXISTS judicial_documents_storage_check;
ALTER TABLE judicial_documents ADD CONSTRAINT judicial_documents_storage_check CHECK (
  (storage_provider = 'DATABASE_LEGACY' AND content IS NOT NULL)
  OR (storage_provider IN ('VERCEL_BLOB', 'LOCAL') AND storage_key IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS judicial_documents_storage_key_unique
  ON judicial_documents (storage_provider, storage_key)
  WHERE storage_key IS NOT NULL;
