import type postgres from "postgres";
import { db } from "@/lib/db/client";

type Queryable = postgres.Sql | postgres.TransactionSql;

export type PartyDiscoveryStatus =
  | "PARTIES_FOUND"
  | "NO_PUBLIC_PARTIES"
  | "PARSER_FAILED"
  | "SOURCE_FAILED"
  | "DETAIL_NOT_FETCHED"
  | "DETAIL_UNAVAILABLE"
  | "DETAIL_INVALID";

export interface IndexCoverageRecord {
  provider: string;
  earliestIndexedDate?: string;
  latestIndexedDate?: string;
  snapshotsIndexed: number;
  casesIndexed: number;
  publicationsIndexed: number;
  partiesIndexed: number;
  mentionsIndexed: number;
  partyExtractionRate: number;
  statusCounts: Record<string, number>;
}

function isoDate(value: unknown): string | undefined {
  if (!value) return undefined;
  return (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
}

export async function recomputePartyDiscoveryStatus(
  sql: Queryable,
  caseId: string,
  provider: string,
  parserVersion?: string,
): Promise<void> {
  await recomputePartyDiscoveryStatuses(sql, [caseId], provider, parserVersion);
}

export async function recomputePartyDiscoveryStatuses(
  sql: Queryable,
  caseIds: string[],
  provider: string,
  parserVersion?: string,
): Promise<void> {
  const ids = [...new Set(caseIds)];
  if (!ids.length) return;
  await sql`
    WITH selected AS (
      SELECT id FROM judicial_cases WHERE id = ANY(${ids}::uuid[])
    ), metrics AS (
      SELECT selected.id AS case_id,
             publication_metrics.publications,
             party_metrics.accepted,
             party_metrics.mentions,
             publication_metrics.detail_fetched,
             publication_metrics.history_fetched,
             publication_metrics.list_fetched,
             publication_metrics.candidates,
             publication_metrics.parser_failed
      FROM selected
      JOIN LATERAL (
        SELECT count(DISTINCT jp.id)::int AS publications,
               COALESCE(bool_or(ss.raw_text IS NOT NULL AND length(ss.raw_text) > 100), false) AS detail_fetched,
               COALESCE(bool_or(ss.raw_payload ? 'historyUrl'), false) AS history_fetched,
               COALESCE(bool_or(ss.raw_payload ? 'record' OR ss.raw_payload ? 'directCaseSession'), false) AS list_fetched,
               COALESCE(sum(per.candidates_found), 0)::int AS candidates,
               COALESCE(bool_or(per.status = 'FAILED'), false) AS parser_failed
        FROM judicial_publications jp
        LEFT JOIN source_snapshots ss ON ss.id = jp.snapshot_id
        LEFT JOIN party_extraction_records per ON per.publication_id = jp.id
        WHERE jp.case_id = selected.id
      ) publication_metrics ON true
      JOIN LATERAL (
        SELECT count(DISTINCT cp.id) FILTER (WHERE cp.active)::int AS accepted,
               (SELECT count(*)::int FROM case_party_mentions cpm WHERE cpm.case_id = selected.id) AS mentions
        FROM case_parties cp WHERE cp.case_id = selected.id
      ) party_metrics ON true
    ), classified AS (
      SELECT metrics.*,
             CASE
               WHEN accepted > 0 THEN 'PARTIES_FOUND'
               WHEN parser_failed THEN 'PARSER_FAILED'
               WHEN ${provider} = 'federal-pjf-session-lists' AND NOT detail_fetched AND NOT list_fetched THEN 'DETAIL_NOT_FETCHED'
               ELSE 'NO_PUBLIC_PARTIES'
             END AS discovery_status
      FROM metrics
    )
    INSERT INTO case_party_discovery_status (
      case_id, provider, status, list_fetched, detail_fetched, history_fetched,
      publications_parsed, named_candidates, accepted_parties, rejected_candidates,
      parser_version, last_attempt_at, last_success_at
    )
    SELECT case_id, ${provider}, discovery_status, list_fetched, detail_fetched, history_fetched,
           publications, candidates, accepted, GREATEST(0, candidates - mentions),
           ${parserVersion ?? null}, now(),
           CASE WHEN discovery_status IN ('PARTIES_FOUND','NO_PUBLIC_PARTIES') THEN now() ELSE NULL END
    FROM classified
    ON CONFLICT (case_id, provider) DO UPDATE SET
      status = EXCLUDED.status,
      list_fetched = EXCLUDED.list_fetched,
      detail_fetched = EXCLUDED.detail_fetched,
      history_fetched = EXCLUDED.history_fetched,
      publications_parsed = EXCLUDED.publications_parsed,
      named_candidates = EXCLUDED.named_candidates,
      accepted_parties = EXCLUDED.accepted_parties,
      rejected_candidates = EXCLUDED.rejected_candidates,
      parser_version = COALESCE(EXCLUDED.parser_version, case_party_discovery_status.parser_version),
      last_error_code = NULL,
      last_error_message = NULL,
      last_attempt_at = now(),
      last_success_at = CASE WHEN EXCLUDED.status IN ('PARTIES_FOUND','NO_PUBLIC_PARTIES') THEN now() ELSE case_party_discovery_status.last_success_at END
  `;
}

export async function recordPartyDiscoveryFailure(input: {
  caseId: string;
  provider: string;
  status: Extract<PartyDiscoveryStatus, "SOURCE_FAILED" | "DETAIL_UNAVAILABLE" | "DETAIL_INVALID">;
  errorCode?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db()`
    INSERT INTO case_party_discovery_status (
      case_id, provider, status, last_error_code, last_error_message, metadata, last_attempt_at
    ) VALUES (
      ${input.caseId}, ${input.provider}, ${input.status}, ${input.errorCode ?? null},
      ${input.message?.slice(0, 500) ?? null}, ${db().json((input.metadata ?? {}) as never)}, now()
    )
    ON CONFLICT (case_id, provider) DO UPDATE SET
      status = CASE WHEN case_party_discovery_status.status = 'PARTIES_FOUND' THEN case_party_discovery_status.status ELSE EXCLUDED.status END,
      last_error_code = EXCLUDED.last_error_code,
      last_error_message = EXCLUDED.last_error_message,
      metadata = case_party_discovery_status.metadata || EXCLUDED.metadata,
      last_attempt_at = now()
  `;
}

export async function getIndexCoverage(): Promise<IndexCoverageRecord[]> {
  const rows = await db()`
    WITH providers AS (
      SELECT code AS provider FROM judicial_authorities
      WHERE code IN ('jalisco-cjj','jalisco-stj-chambers','federal-pjf-session-lists')
    ), publication_stats AS (
      SELECT ja.code AS provider,
             min(jp.publication_date) AS earliest_date,
             max(jp.publication_date) AS latest_date,
             count(DISTINCT ss.id)::int AS snapshots,
             count(DISTINCT jc.id)::int AS cases,
             count(DISTINCT jp.id)::int AS publications
      FROM judicial_authorities ja
      LEFT JOIN judicial_cases jc ON jc.authority_id = ja.id
      LEFT JOIN judicial_publications jp ON jp.case_id = jc.id
      LEFT JOIN source_snapshots ss ON ss.id = jp.snapshot_id
      WHERE ja.code IN ('jalisco-cjj','jalisco-stj-chambers','federal-pjf-session-lists')
      GROUP BY ja.code
    ), party_stats AS (
      SELECT ja.code AS provider,
             count(DISTINCT cp.id) FILTER (WHERE cp.active)::int AS parties,
             count(DISTINCT jc.id) FILTER (WHERE cp.id IS NOT NULL AND cp.active)::int AS cases_with_parties
      FROM judicial_authorities ja
      LEFT JOIN judicial_cases jc ON jc.authority_id = ja.id
      LEFT JOIN case_parties cp ON cp.case_id = jc.id
      WHERE ja.code IN ('jalisco-cjj','jalisco-stj-chambers','federal-pjf-session-lists')
      GROUP BY ja.code
    ), mention_stats AS (
      SELECT ja.code AS provider, count(cpm.id)::int AS mentions
      FROM judicial_authorities ja
      LEFT JOIN judicial_cases jc ON jc.authority_id = ja.id
      LEFT JOIN case_party_mentions cpm ON cpm.case_id = jc.id
      WHERE ja.code IN ('jalisco-cjj','jalisco-stj-chambers','federal-pjf-session-lists')
      GROUP BY ja.code
    )
    SELECT p.provider,
           ps.earliest_date, ps.latest_date,
           COALESCE(ps.snapshots, 0)::int AS snapshots,
           COALESCE(ps.cases, 0)::int AS cases,
           COALESCE(ps.publications, 0)::int AS publications,
           COALESCE(pt.parties, 0)::int AS parties,
           COALESCE(ms.mentions, 0)::int AS mentions,
           COALESCE(pt.cases_with_parties, 0)::int AS cases_with_parties,
           COALESCE(statuses.counts, '{}'::jsonb) AS status_counts
    FROM providers p
    LEFT JOIN publication_stats ps ON ps.provider = p.provider
    LEFT JOIN party_stats pt ON pt.provider = p.provider
    LEFT JOIN mention_stats ms ON ms.provider = p.provider
    LEFT JOIN LATERAL (
      SELECT jsonb_object_agg(grouped.status, grouped.total) AS counts
      FROM (
        SELECT status, count(*)::int AS total
        FROM case_party_discovery_status
        WHERE provider = p.provider
        GROUP BY status
      ) grouped
    ) statuses ON true
    ORDER BY p.provider
  `;
  return rows.map((row) => ({
    provider: String(row.provider),
    earliestIndexedDate: isoDate(row.earliest_date),
    latestIndexedDate: isoDate(row.latest_date),
    snapshotsIndexed: Number(row.snapshots),
    casesIndexed: Number(row.cases),
    publicationsIndexed: Number(row.publications),
    partiesIndexed: Number(row.parties),
    mentionsIndexed: Number(row.mentions),
    partyExtractionRate: Number(row.cases) ? Number(row.cases_with_parties) / Number(row.cases) : 0,
    statusCounts: (row.status_counts ?? {}) as Record<string, number>,
  }));
}
