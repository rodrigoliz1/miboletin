-- A publication belongs to a monitored matter only when both reference the
-- same canonical judicial case (jurisdiction + provider + court + case type + number).
-- Older linking code used court + number and could mix different case types.
DELETE FROM notifications n
USING case_movements cm, monitored_cases mc, judicial_cases jc, judicial_authorities ja, judicial_publications jp
WHERE n.movement_id = cm.id
  AND cm.monitored_case_id = mc.id
  AND mc.case_id = jc.id
  AND jc.authority_id = ja.id
  AND cm.publication_id = jp.id
  AND ja.jurisdiction = 'FEDERAL'
  AND jp.case_id IS DISTINCT FROM mc.case_id;

DELETE FROM case_movements cm
USING monitored_cases mc, judicial_cases jc, judicial_authorities ja, judicial_publications jp
WHERE cm.monitored_case_id = mc.id
  AND mc.case_id = jc.id
  AND jc.authority_id = ja.id
  AND cm.publication_id = jp.id
  AND ja.jurisdiction = 'FEDERAL'
  AND jp.case_id IS DISTINCT FROM mc.case_id;

UPDATE monitored_cases mc
SET source_status = 'PENDING',
    source_message = 'Identidad del asunto reforzada; pendiente de una comprobación oficial exacta.',
    refresh_started_at = NULL
FROM judicial_cases jc
JOIN judicial_authorities ja ON ja.id = jc.authority_id
WHERE mc.case_id = jc.id
  AND ja.jurisdiction = 'FEDERAL'
  AND mc.active
  AND mc.deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS publications_exact_case_period_idx
  ON judicial_publications (case_id, publication_date DESC);
