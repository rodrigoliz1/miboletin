UPDATE monitored_cases mc
SET monitor_from = CASE
  WHEN ja.jurisdiction = 'JALISCO' THEN DATE '1900-01-01'
  WHEN ja.jurisdiction = 'FEDERAL' THEN make_date(jc.year, 1, 1)
  ELSE mc.monitor_from
END
FROM judicial_cases jc
JOIN judicial_authorities ja ON ja.id = jc.authority_id
WHERE mc.case_id = jc.id
  AND (
    (ja.jurisdiction = 'JALISCO' AND mc.monitor_from <> DATE '1900-01-01')
    OR
    (ja.jurisdiction = 'FEDERAL' AND mc.monitor_from <> make_date(jc.year, 1, 1))
  );
