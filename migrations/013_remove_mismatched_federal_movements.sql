-- Federal case identity includes court, number and case type. A short-lived
-- deployment running the older linker recreated stale relationships after
-- migration 011. Preserve the publications and remove only wrong associations.
DELETE FROM notifications n
USING case_movements cm, monitored_cases mc, judicial_cases watched,
      judicial_authorities authority, judicial_publications publication
WHERE n.movement_id = cm.id
  AND cm.monitored_case_id = mc.id
  AND mc.case_id = watched.id
  AND watched.authority_id = authority.id
  AND cm.publication_id = publication.id
  AND authority.jurisdiction = 'FEDERAL'
  AND publication.case_id IS DISTINCT FROM mc.case_id;

DELETE FROM case_movements cm
USING monitored_cases mc, judicial_cases watched,
      judicial_authorities authority, judicial_publications publication
WHERE cm.monitored_case_id = mc.id
  AND mc.case_id = watched.id
  AND watched.authority_id = authority.id
  AND cm.publication_id = publication.id
  AND authority.jurisdiction = 'FEDERAL'
  AND publication.case_id IS DISTINCT FROM mc.case_id;
