-- CJ Jalisco identifies a lookup by organ and case number. The descriptive
-- matter returned by its five bulletin families can be more specific than the
-- label supplied at registration, so local linkage intentionally follows that
-- official identity instead of requiring literal case-type equality.
INSERT INTO case_movements (monitored_case_id, publication_id, match_result, detected_at)
SELECT mc.id, jp.id, 'EXACT', now()
FROM monitored_cases mc
JOIN judicial_cases watched ON watched.id = mc.case_id
JOIN judicial_authorities ja ON ja.id = watched.authority_id
JOIN judicial_publications jp
  ON jp.court_id = watched.court_id
 AND jp.case_number_normalized = watched.case_number_normalized
WHERE ja.jurisdiction = 'JALISCO'
  AND mc.active
  AND mc.deleted_at IS NULL
  AND jp.publication_date >= mc.monitor_from
ON CONFLICT (monitored_case_id, publication_id) DO NOTHING;

UPDATE monitored_cases mc
SET source_status = 'PENDING',
    source_message = 'Identidad local conciliada por órgano y número; pendiente de actualización.',
    refresh_started_at = NULL
FROM judicial_cases jc
JOIN judicial_authorities ja ON ja.id = jc.authority_id
WHERE mc.case_id = jc.id
  AND ja.jurisdiction = 'JALISCO'
  AND mc.active
  AND mc.deleted_at IS NULL;
