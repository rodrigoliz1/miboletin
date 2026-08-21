import "./load-env";
import { closeDb, db } from "../src/lib/db/client";

async function main() {
  const sql = db();
  const catalog = await sql`
    INSERT INTO judicial_source_catalog (
      provider, external_id, parent_external_id, name, normalized_name, matter,
      supported_modes, active, metadata
    )
    SELECT ja.code, c.external_id, COALESCE(cir.external_id, ''), c.name, c.normalized_name, c.matter,
           CASE WHEN ja.code = 'jalisco-cjj' THEN ARRAY['PUBLICATIONS_BY_DATE','CASE_LOOKUP','PARTY_FIELDS']::text[]
                WHEN ja.code = 'jalisco-stj-chambers' THEN ARRAY['CASE_LOOKUP','ORIGIN_RELATION']::text[]
                ELSE ARRAY['SESSION_LISTS','CASE_LOOKUP']::text[] END,
           true, jsonb_build_object('origin', 'stored-court-reconciliation')
    FROM courts c
    JOIN judicial_authorities ja ON ja.id = c.authority_id
    LEFT JOIN judicial_circuits cir ON cir.id = c.circuit_id
    WHERE ja.code IN ('jalisco-cjj','jalisco-stj-chambers','federal-pjf-session-lists')
    ON CONFLICT (provider, external_id, parent_external_id) DO UPDATE SET
      name = EXCLUDED.name, normalized_name = EXCLUDED.normalized_name, matter = COALESCE(EXCLUDED.matter, judicial_source_catalog.matter),
      active = true, last_seen_at = now()
    RETURNING provider
  `;
  const coverage = await sql`
    INSERT INTO judicial_source_coverage (
      provider, court_external_id, parent_external_id, coverage_date, resource_kind, status,
      discovery_completed, fetch_completed, parse_completed, index_completed,
      publications_found, cases_found, names_extracted, attempts,
      first_processed_at, last_processed_at, metadata
    )
    SELECT runs.provider, runs.court_external_id, COALESCE(runs.circuit_external_id, ''), runs.date_from,
           'PUBLICATIONS', 'COMPLETE', true, true, true, true,
           runs.records_fetched,
           (SELECT count(DISTINCT jc.id)::int FROM judicial_cases jc
             JOIN courts c ON c.id = jc.court_id JOIN judicial_authorities ja ON ja.id = jc.authority_id
             JOIN judicial_publications jp ON jp.case_id = jc.id
             WHERE ja.code = runs.provider AND c.external_id = runs.court_external_id
               AND jp.publication_date = runs.date_from),
           runs.parties_found, 1, runs.started_at, COALESCE(runs.completed_at, runs.started_at),
           jsonb_build_object('reconciledFromRun', runs.job_id)
    FROM global_index_runs runs
    WHERE runs.status = 'SUCCEEDED' AND runs.court_external_id IS NOT NULL
      AND runs.date_from = runs.date_to AND runs.units_failed = 0
    ON CONFLICT (provider, court_external_id, parent_external_id, coverage_date, resource_kind) DO NOTHING
    RETURNING id
  `;
  console.log(JSON.stringify({ catalogRows: catalog.length, coverageUnits: coverage.length }, null, 2));
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(closeDb);
