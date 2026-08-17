UPDATE courts c
SET court_type = CASE
  WHEN c.name ~* 'apelaci[oó]n' THEN 'APPEAL'
  WHEN c.name ~* 'colegiado' THEN 'COLLEGIATE'
  WHEN c.name ~* 'pleno regional' THEN 'REGIONAL'
  WHEN c.name ~* 'juzgado .+ distrito|juzgado de distrito|tribunal laboral federal|centro de justicia penal federal' THEN 'DISTRICT'
  ELSE 'OTHER'
END
FROM judicial_authorities ja
WHERE ja.id = c.authority_id
  AND ja.jurisdiction = 'FEDERAL';

UPDATE monitored_cases mc
SET source_status = 'PENDING',
    source_message = 'La integración federal fue actualizada; la nueva revisión separa acuerdos y sesiones.',
    refresh_started_at = NULL
FROM judicial_cases jc
JOIN judicial_authorities ja ON ja.id = jc.authority_id
WHERE jc.id = mc.case_id
  AND ja.jurisdiction = 'FEDERAL'
  AND mc.source_status = 'CHECKING';
