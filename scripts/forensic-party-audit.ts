import "./load-env";
import { closeDb, db } from "../src/lib/db/client";
import { normalizePartyName, partyTokenSignature } from "../src/lib/parties/normalization";

function option(name: string) {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main() {
  const provider = option("provider") ?? "jalisco-cjj";
  const court = option("court") ?? "M05";
  const from = option("from") ?? "2026-01-01";
  const to = option("to") ?? new Date().toISOString().slice(0, 10);
  const query = option("name") ?? "Josefina Fuentes Corral";
  const normalized = normalizePartyName(query);
  const signature = partyTokenSignature(query);
  const sql = db();
  const [pipeline] = await sql`
    WITH selected_publications AS (
      SELECT jp.id, jp.case_id, jp.snapshot_id
      FROM judicial_publications jp
      JOIN courts c ON c.id = jp.court_id
      JOIN judicial_authorities ja ON ja.id = c.authority_id
      WHERE ja.code = ${provider} AND c.external_id = ${court}
        AND jp.publication_date BETWEEN ${from} AND ${to}
    ), selected_cases AS (
      SELECT DISTINCT case_id FROM selected_publications
    )
    SELECT
      (SELECT count(*)::int FROM selected_publications) AS publications_examined,
      (SELECT count(*)::int FROM selected_cases) AS cases_discovered,
      (SELECT count(*)::int FROM selected_cases sc JOIN judicial_cases jc ON jc.id = sc.case_id) AS cases_persisted,
      (SELECT count(*)::int FROM selected_cases sc WHERE EXISTS (SELECT 1 FROM case_parties cp WHERE cp.case_id = sc.case_id AND cp.active)) AS cases_with_parties,
      (SELECT count(*)::int FROM case_party_mentions cpm WHERE cpm.case_id IN (SELECT case_id FROM selected_cases)) AS names_extracted,
      (SELECT count(*)::int FROM case_parties cp WHERE cp.case_id IN (SELECT case_id FROM selected_cases) AND cp.active) AS names_indexed,
      (SELECT count(*)::int FROM party_extraction_records per WHERE per.publication_id IN (SELECT id FROM selected_publications) AND per.status = 'FAILED') AS extraction_errors
  `;
  const matches = await sql`
    SELECT cp.name_raw, cp.side, cp.party_type, jc.case_number_normalized, c.name AS court_name,
           max(cpm.publication_date) AS last_evidence_date, max(cpm.source_url) AS source_url
    FROM case_parties cp
    JOIN judicial_cases jc ON jc.id = cp.case_id
    JOIN courts c ON c.id = jc.court_id
    LEFT JOIN case_party_mentions cpm ON cpm.case_party_id = cp.id
    WHERE cp.active AND (cp.name_normalized = ${normalized} OR cp.search_name = ${normalized}
      OR cp.token_signature = ${signature} OR cp.name_normalized % ${normalized}
      OR cp.search_name % ${normalized} OR cp.token_signature % ${signature})
    GROUP BY cp.id, jc.case_number_normalized, c.name
    ORDER BY GREATEST(similarity(cp.name_normalized, ${normalized}), similarity(cp.token_signature, ${signature})) DESC
    LIMIT 50
  `;
  const rawMatches = await sql`
    SELECT count(DISTINCT ss.id)::int AS snapshots, count(DISTINCT jp.case_id)::int AS cases
    FROM source_snapshots ss
    JOIN judicial_publications jp ON jp.snapshot_id = ss.id
    JOIN courts c ON c.id = jp.court_id
    JOIN judicial_authorities ja ON ja.id = c.authority_id
    WHERE ja.code = ${provider} AND c.external_id = ${court}
      AND jp.publication_date BETWEEN ${from} AND ${to}
      AND upper(unaccent(COALESCE(ss.raw_payload::text, '') || ' ' || COALESCE(ss.raw_text, ''))) LIKE ${`%${normalized}%`}
  `;
  const coverage = await sql`
    SELECT coverage_date, status, publications_found, cases_found, names_extracted, last_error_code
    FROM judicial_source_coverage
    WHERE provider = ${provider} AND court_external_id = ${court}
      AND coverage_date BETWEEN ${from} AND ${to}
    ORDER BY coverage_date
  `;
  const samples = await sql`
    SELECT jc.case_number_normalized, jc.case_type, count(DISTINCT jp.id)::int AS publications,
           count(DISTINCT cp.id) FILTER (WHERE cp.active)::int AS parties
    FROM judicial_cases jc
    JOIN courts c ON c.id = jc.court_id
    JOIN judicial_authorities ja ON ja.id = jc.authority_id
    JOIN judicial_publications jp ON jp.case_id = jc.id
    LEFT JOIN case_parties cp ON cp.case_id = jc.id
    WHERE ja.code = ${provider} AND c.external_id = ${court}
      AND jp.publication_date BETWEEN ${from} AND ${to}
    GROUP BY jc.id
    ORDER BY parties DESC, publications DESC, jc.case_number_normalized
    LIMIT 10
  `;
  const partySamples = await sql`
    SELECT cp.name_raw, cp.party_type, cp.side, jc.case_number_normalized
    FROM case_parties cp
    JOIN judicial_cases jc ON jc.id = cp.case_id
    JOIN courts c ON c.id = jc.court_id
    JOIN judicial_authorities ja ON ja.id = jc.authority_id
    WHERE cp.active AND ja.code = ${provider} AND c.external_id = ${court}
    ORDER BY cp.updated_at DESC
    LIMIT 10
  `;
  console.log(JSON.stringify({ provider, court, from, to, query, normalized, signature, pipeline, matches, rawMatches: rawMatches[0], coverage, samples, partySamples }, null, 2));
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(closeDb);
