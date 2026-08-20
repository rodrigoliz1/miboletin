WITH corrected AS (
  SELECT jp.id,
         CASE extract(isodow FROM jp.agreement_date)::int
           WHEN 5 THEN jp.agreement_date + 3
           WHEN 6 THEN jp.agreement_date + 2
           ELSE jp.agreement_date + 1
         END AS publication_date
  FROM judicial_publications jp
  JOIN judicial_cases jc ON jc.id = jp.case_id
  JOIN judicial_authorities ja ON ja.id = jc.authority_id
  WHERE ja.code = 'jalisco-cjj'
    AND jp.publication_kind = 'AGREEMENT'
    AND jp.agreement_date IS NOT NULL
)
UPDATE judicial_publications jp
SET publication_date = corrected.publication_date
FROM corrected
WHERE jp.id = corrected.id
  AND jp.publication_date IS DISTINCT FROM corrected.publication_date;

UPDATE source_snapshots ss
SET publication_date = publications.publication_date
FROM (
  SELECT snapshot_id, min(publication_date) AS publication_date
  FROM judicial_publications
  WHERE snapshot_id IS NOT NULL
  GROUP BY snapshot_id
) publications
WHERE ss.id = publications.snapshot_id
  AND ss.provider = 'jalisco-cjj'
  AND ss.publication_date IS DISTINCT FROM publications.publication_date;

UPDATE notifications n
SET payload = jsonb_set(n.payload, '{publicationDate}', to_jsonb(jp.publication_date::text), true)
FROM case_movements cm
JOIN judicial_publications jp ON jp.id = cm.publication_id
JOIN judicial_cases jc ON jc.id = jp.case_id
JOIN judicial_authorities ja ON ja.id = jc.authority_id
WHERE n.movement_id = cm.id
  AND ja.code = 'jalisco-cjj'
  AND n.payload ->> 'publicationDate' IS DISTINCT FROM jp.publication_date::text;
