import type { CourtCatalogItem } from "@/lib/domain/types";
import type { IngestionResult } from "@/lib/ingestion/pipeline";
import { db } from "@/lib/db/client";
import { normalizeName } from "@/lib/domain/normalization";
import { invalidateIndexCoverageCache } from "./discovery";

export interface SourceCatalogEntry extends CourtCatalogItem {
  parentExternalId?: string;
  group?: string;
  family?: string;
  sessionCapable?: boolean;
}

export async function syncSourceCatalog(provider: string, entries: SourceCatalogEntry[], completeSnapshot = true): Promise<number> {
  if (!entries.length) return 0;
  const sql = db();
  const seen = new Set<string>();
  const syncStartedAt = new Date().toISOString();
  for (const entry of entries) {
    const parent = entry.parentExternalId ?? "";
    const key = `${entry.externalId}:${parent}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const modes = provider === "jalisco-cjj"
      ? ["PUBLICATIONS_BY_DATE", "CASE_LOOKUP", "PARTY_FIELDS"]
      : provider === "jalisco-stj-chambers"
        ? ["CASE_LOOKUP", "ORIGIN_RELATION"]
        : ["SESSION_LISTS", "CASE_LOOKUP"];
    await sql`
      INSERT INTO judicial_source_catalog (
        provider, external_id, parent_external_id, name, normalized_name,
        group_name, matter, supported_modes, active, last_seen_at, metadata
      ) VALUES (
        ${provider}, ${entry.externalId}, ${parent}, ${entry.name}, ${normalizeName(entry.name)},
        ${entry.group ?? null}, ${entry.matter ?? null}, ${modes}, true, ${syncStartedAt},
        ${sql.json({ family: entry.family ?? null, sessionCapable: entry.sessionCapable ?? null })}
      )
      ON CONFLICT (provider, external_id, parent_external_id) DO UPDATE SET
        name = EXCLUDED.name, normalized_name = EXCLUDED.normalized_name,
        group_name = EXCLUDED.group_name, matter = EXCLUDED.matter,
        supported_modes = EXCLUDED.supported_modes, active = true,
        last_seen_at = EXCLUDED.last_seen_at, metadata = EXCLUDED.metadata
    `;
  }
  if (completeSnapshot) {
    await sql`
      UPDATE judicial_source_catalog
      SET active = false
      WHERE provider = ${provider}
        AND last_seen_at < ${syncStartedAt}
        AND NOT ((external_id || ':' || parent_external_id) = ANY(${[...seen]}::text[]))
    `;
  }
  invalidateIndexCoverageCache();
  return seen.size;
}

export interface CoverageUnitInput {
  provider: string;
  courtExternalId: string;
  parentExternalId?: string;
  date: string;
  resourceKind: string;
  result: IngestionResult;
  metadata?: Record<string, unknown>;
}

function errorCode(result: IngestionResult): string | null {
  const first = result.errors[0];
  if (!first) return null;
  return first.split(":", 1)[0].replace(/[^A-Z0-9_-]/gi, "_").slice(0, 80).toUpperCase();
}

export async function recordCoverageUnit(input: CoverageUnitInput): Promise<void> {
  const sql = db();
  const uniqueCases = new Set(input.result.normalized.map((item) => item.canonicalCaseKey)).size;
  const hasErrors = input.result.errors.length > 0;
  const status = hasErrors ? (input.result.recordsFetched > 0 ? "PARTIAL" : "RETRY") : "COMPLETE";
  const code = errorCode(input.result);
  await sql`
    INSERT INTO judicial_source_coverage (
      provider, court_external_id, parent_external_id, coverage_date, resource_kind, status,
      discovery_completed, fetch_completed, parse_completed, index_completed,
      publications_found, cases_found, names_extracted, attempts,
      first_processed_at, last_processed_at, next_retry_at,
      last_error_code, last_error_message, metadata, updated_at
    ) VALUES (
      ${input.provider}, ${input.courtExternalId}, ${input.parentExternalId ?? ""}, ${input.date},
      ${input.resourceKind}, ${status}, true, ${input.result.recordsFetched > 0 || !hasErrors},
      ${!input.result.errors.some((message) => /PARSER|SCHEMA/i.test(message))}, ${!input.result.dryRun && !hasErrors},
      ${input.result.recordsFetched}, ${uniqueCases}, ${input.result.partiesFound}, 1,
      now(), now(), ${hasErrors ? new Date(Date.now() + 30 * 60_000).toISOString() : null},
      ${code}, ${input.result.errors[0]?.slice(0, 500) ?? null},
      ${sql.json({ ...(input.metadata ?? {}), jobId: input.result.jobId, durationMs: input.result.duration })}, now()
    )
    ON CONFLICT (provider, court_external_id, parent_external_id, coverage_date, resource_kind) DO UPDATE SET
      status = EXCLUDED.status,
      discovery_completed = EXCLUDED.discovery_completed,
      fetch_completed = EXCLUDED.fetch_completed,
      parse_completed = EXCLUDED.parse_completed,
      index_completed = EXCLUDED.index_completed,
      publications_found = EXCLUDED.publications_found,
      cases_found = EXCLUDED.cases_found,
      names_extracted = EXCLUDED.names_extracted,
      attempts = judicial_source_coverage.attempts + 1,
      first_processed_at = COALESCE(judicial_source_coverage.first_processed_at, now()),
      last_processed_at = now(), next_retry_at = EXCLUDED.next_retry_at,
      last_error_code = EXCLUDED.last_error_code,
      last_error_message = EXCLUDED.last_error_message,
      metadata = judicial_source_coverage.metadata || EXCLUDED.metadata,
      updated_at = now()
  `;

  if (input.result.recordsFetched >= 10 && input.result.partiesFound === 0 && input.provider === "jalisco-cjj") {
    await sql`
      INSERT INTO judicial_index_anomalies (
        provider, court_external_id, coverage_date, kind, severity, message, observed_value, expected_value, metadata
      ) VALUES (
        ${input.provider}, ${input.courtExternalId}, ${input.date}, 'ZERO_PARTY_EXTRACTION', 'CRITICAL',
        'La fuente publicó al menos diez registros, pero el parser no extrajo ningún nombre.',
        0, ${input.result.recordsFetched}, ${sql.json({ recordsFetched: input.result.recordsFetched, jobId: input.result.jobId })}
      ) ON CONFLICT DO NOTHING
    `;
  }
  invalidateIndexCoverageCache();
}

export interface CourtCoverageDetail {
  provider: string;
  courtExternalId: string;
  courtName: string;
  groupName?: string;
  matter?: string;
  coveredDays: number;
  completeDays: number;
  incompleteDays: number;
  publications: number;
  cases: number;
  names: number;
  firstDate?: string;
  lastDate?: string;
  lastProcessedAt?: string;
  lastError?: string;
}

function dateValue(value: unknown): string | undefined {
  if (!value) return undefined;
  return (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
}

export async function listCourtCoverage(provider?: string, limit = 300): Promise<CourtCoverageDetail[]> {
  const rows = await db()`
    SELECT catalog.provider, catalog.external_id, catalog.name, catalog.group_name, catalog.matter,
           count(coverage.id)::int AS covered_days,
           count(coverage.id) FILTER (WHERE coverage.status = 'COMPLETE')::int AS complete_days,
           count(coverage.id) FILTER (WHERE coverage.status <> 'COMPLETE')::int AS incomplete_days,
           COALESCE(sum(coverage.publications_found), 0)::int AS publications,
           COALESCE(sum(coverage.cases_found), 0)::int AS cases,
           COALESCE(sum(coverage.names_extracted), 0)::int AS names,
           min(coverage.coverage_date) AS first_date, max(coverage.coverage_date) AS last_date,
           max(coverage.last_processed_at) AS last_processed_at,
           (array_agg(coverage.last_error_message ORDER BY coverage.last_processed_at DESC NULLS LAST)
             FILTER (WHERE coverage.last_error_message IS NOT NULL))[1] AS last_error
    FROM judicial_source_catalog catalog
    LEFT JOIN judicial_source_coverage coverage
      ON coverage.provider = catalog.provider
     AND coverage.court_external_id = catalog.external_id
     AND coverage.parent_external_id = catalog.parent_external_id
    WHERE catalog.active AND (${provider ?? null}::text IS NULL OR catalog.provider = ${provider ?? null})
    GROUP BY catalog.provider, catalog.external_id, catalog.name, catalog.group_name, catalog.matter
    ORDER BY catalog.provider, catalog.group_name NULLS LAST, catalog.name
    LIMIT ${Math.min(1000, Math.max(1, limit))}
  `;
  return rows.map((row) => ({
    provider: String(row.provider), courtExternalId: String(row.external_id), courtName: String(row.name),
    groupName: row.group_name ? String(row.group_name) : undefined, matter: row.matter ? String(row.matter) : undefined,
    coveredDays: Number(row.covered_days), completeDays: Number(row.complete_days), incompleteDays: Number(row.incomplete_days),
    publications: Number(row.publications), cases: Number(row.cases), names: Number(row.names),
    firstDate: dateValue(row.first_date), lastDate: dateValue(row.last_date),
    lastProcessedAt: row.last_processed_at ? (row.last_processed_at instanceof Date ? row.last_processed_at.toISOString() : String(row.last_processed_at)) : undefined,
    lastError: row.last_error ? String(row.last_error) : undefined,
  }));
}

export async function listIndexAnomalies(limit = 30) {
  return db()`
    SELECT id, provider, court_external_id, coverage_date, kind, severity, message, created_at
    FROM judicial_index_anomalies
    WHERE status = 'OPEN'
    ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END, created_at DESC
    LIMIT ${Math.min(100, Math.max(1, limit))}
  `;
}
