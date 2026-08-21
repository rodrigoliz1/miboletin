ALTER TABLE case_parties
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS case_parties_active_search_idx
  ON case_parties (case_id, side, party_type)
  WHERE active;
