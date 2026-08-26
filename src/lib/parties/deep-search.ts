import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import { sha256 } from "@/lib/domain/normalization";
import { runIngestion } from "@/lib/ingestion/pipeline";
import { dateInMexicoCity } from "@/lib/product/query";
import { JaliscoProvider } from "@/lib/providers/jalisco/provider";
import { normalizePartyName, partyTokenSignature } from "./normalization";
import { recordCoverageUnit } from "./coverage";
import { loadJaliscoCatalog } from "./jalisco-catalog";

export type DeepSearchStatus = "PENDING" | "RUNNING" | "COMPLETE" | "PARTIAL" | "FAILED" | "CANCELLED";

export interface DeepSearchJob {
  id: string;
  status: DeepSearchStatus;
  query: string;
  dateFrom: string;
  dateTo: string;
  unitsTotal: number;
  unitsProcessed: number;
  unitsSucceeded: number;
  unitsFailed: number;
  resultsBefore: number;
  resultsAfter: number;
  lastError?: string;
  updatedAt: string;
  details: Record<string, unknown>;
}

export interface DeepSearchRequest {
  organizationId: string;
  userId: string;
  query: string;
  provider?: string;
  jurisdiction?: "JALISCO" | "FEDERAL";
  courtExternalId?: string;
  from?: string;
  to?: string;
  currentResults?: number;
  action?: "DEEP_SEARCH" | "BACKFILL" | "RETRY_PERIOD" | "REINDEX_COURT";
}

function isoDate(value: unknown): string {
  return (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
}

function mapJob(row: Record<string, unknown>): DeepSearchJob {
  return {
    id: String(row.id), status: row.status as DeepSearchStatus, query: String(row.query_raw),
    dateFrom: isoDate(row.date_from), dateTo: isoDate(row.date_to),
    unitsTotal: Number(row.units_total), unitsProcessed: Number(row.units_processed),
    unitsSucceeded: Number(row.units_succeeded), unitsFailed: Number(row.units_failed),
    resultsBefore: Number(row.results_before), resultsAfter: Number(row.results_after),
    lastError: row.last_error_message ? String(row.last_error_message) : undefined,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    details: (row.details ?? {}) as Record<string, unknown>,
  };
}

function businessDatesDescending(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${to}T12:00:00Z`);
  const start = new Date(`${from}T12:00:00Z`);
  while (cursor >= start) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates;
}

async function ensureJaliscoCatalog() {
  return (await loadJaliscoCatalog()).courts;
}

function jaliscoPriority(matter?: string) {
  return matter === "Mercantil" ? 0 : matter === "Civil" ? 1 : matter === "Familiar" ? 2 : 3;
}

export async function enqueueDeepSearch(input: DeepSearchRequest): Promise<DeepSearchJob> {
  const normalized = normalizePartyName(input.query);
  if (normalized.length < 3) throw new Error("Escribe al menos tres caracteres para ampliar la búsqueda");
  const today = dateInMexicoCity();
  const currentYear = today.slice(0, 4);
  const from = input.from ?? `${currentYear}-01-01`;
  const to = input.to ?? today;
  const requestedProvider = input.provider;
  const supportsGlobalEnumeration = !requestedProvider || requestedProvider === "jalisco-cjj";
  const courts = supportsGlobalEnumeration ? await ensureJaliscoCatalog() : [];
  const selectedCourts = courts.filter((court) => !input.courtExternalId || court.externalId === input.courtExternalId);
  const total = businessDatesDescending(from, to).length * selectedCourts.length;
  const signature = partyTokenSignature(input.query);
  const action = input.action ?? "DEEP_SEARCH";
  const requestHash = sha256(JSON.stringify({ action, normalized, signature, provider: requestedProvider ?? null, jurisdiction: input.jurisdiction ?? null, court: input.courtExternalId ?? null, from, to }));
  const [recent] = await db()`
    SELECT * FROM judicial_deep_search_jobs
    WHERE organization_id = ${input.organizationId} AND request_hash = ${requestHash}
      AND updated_at > now() - interval '24 hours'
    ORDER BY updated_at DESC LIMIT 1
  `;
  if (recent) return mapJob(recent);
  const limitations = [
    ...((!requestedProvider || requestedProvider === "jalisco-stj-chambers") ? ["STJ: consulta pública por toca y Sala; no existe enumeración global por nombre o fecha."] : []),
    ...((!requestedProvider || requestedProvider === "federal-pjf-session-lists") ? ["PJF: las listas públicas no muestran de forma uniforme los nombres de las partes."] : []),
  ];
  const status: DeepSearchStatus = total ? "PENDING" : "COMPLETE";
  const [row] = await db()`
    INSERT INTO judicial_deep_search_jobs (
      organization_id, user_id, request_hash, query_raw, query_normalized, token_signature,
      provider, jurisdiction, court_external_id, date_from, date_to, status,
      units_total, results_before, results_after, details, completed_at
    ) VALUES (
      ${input.organizationId}, ${input.userId}, ${requestHash}, ${input.query.trim()}, ${normalized}, ${signature},
      ${requestedProvider ?? null}, ${input.jurisdiction ?? null}, ${input.courtExternalId ?? null},
      ${from}, ${to}, ${status}, ${total}, ${input.currentResults ?? 0}, ${input.currentResults ?? 0},
      ${db().json({ action, limitations, scope: total ? "JALISCO_ENUMERABLE" : "SOURCE_NOT_ENUMERABLE" })},
      ${status === "COMPLETE" ? new Date().toISOString() : null}
    )
    ON CONFLICT (organization_id, request_hash) WHERE status IN ('PENDING','RUNNING','PARTIAL')
    DO UPDATE SET updated_at = now()
    RETURNING *
  `;
  return mapJob(row);
}

export async function getDeepSearchJob(organizationId: string, jobId: string): Promise<DeepSearchJob | null> {
  const [row] = await db()`SELECT * FROM judicial_deep_search_jobs WHERE id = ${jobId} AND organization_id = ${organizationId}`;
  return row ? mapJob(row) : null;
}

async function indexedResultCount(normalized: string, signature: string): Promise<number> {
  const [row] = await db()`
    SELECT count(DISTINCT case_id)::int AS total
    FROM case_parties
    WHERE active AND (
      name_normalized = ${normalized} OR search_name = ${normalized} OR token_signature = ${signature}
      OR name_normalized % ${normalized} OR search_name % ${normalized} OR token_signature % ${signature}
    )
  `;
  return Number(row?.total ?? 0);
}

export async function processDeepSearchJob(jobId: string, maxUnits = 3): Promise<DeepSearchJob | null> {
  const owner = randomUUID();
  const [leased] = await db()`
    UPDATE judicial_deep_search_jobs
    SET status = 'RUNNING', lease_owner = ${owner}, lease_until = now() + interval '4 minutes',
        started_at = COALESCE(started_at, now()), updated_at = now()
    WHERE id = ${jobId} AND status IN ('PENDING','PARTIAL','RUNNING') AND completed_at IS NULL
      AND (lease_until IS NULL OR lease_until < now())
    RETURNING *
  `;
  if (!leased) {
    const [existing] = await db()`SELECT * FROM judicial_deep_search_jobs WHERE id = ${jobId}`;
    return existing ? mapJob(existing) : null;
  }
    const job = mapJob(leased);
  try {
    const availableCourts = await ensureJaliscoCatalog();
    const provider = new JaliscoProvider(availableCourts);
    const allCourts = availableCourts
      .filter((court) => !leased.court_external_id || court.externalId === String(leased.court_external_id))
      .sort((left, right) => jaliscoPriority(left.matter) - jaliscoPriority(right.matter) || left.externalId.localeCompare(right.externalId));
    const dates = businessDatesDescending(job.dateFrom, job.dateTo);
    const action = String(job.details.action ?? "DEEP_SEARCH");
    const total = allCourts.length * dates.length;
    let cursor = Number((leased.cursor as { unit?: number } | undefined)?.unit ?? 0);
    let processed = Number(leased.units_processed);
    let succeeded = Number(leased.units_succeeded);
    let failed = Number(leased.units_failed);
    let attemptedNow = 0;
    let lastError: string | null = null;

    while (cursor < total && attemptedNow < Math.min(25, Math.max(1, maxUnits))) {
      const court = allCourts[Math.floor(cursor / dates.length)];
      const date = dates[cursor % dates.length];
      cursor += 1;
      const [covered] = await db()`
        SELECT status FROM judicial_source_coverage
        WHERE provider = 'jalisco-cjj' AND court_external_id = ${court.externalId}
          AND parent_external_id = '' AND coverage_date = ${date} AND resource_kind = 'PUBLICATIONS'
          AND status = 'COMPLETE'
      `;
      if (covered && action !== "REINDEX_COURT") {
        processed += 1;
        succeeded += 1;
        continue;
      }
      attemptedNow += 1;
      const result = await runIngestion(provider, { date, courtExternalId: court.externalId }, false);
      await recordCoverageUnit({ provider: provider.id, courtExternalId: court.externalId, date, resourceKind: "PUBLICATIONS", result, metadata: { deepSearchJobId: job.id } });
      processed += 1;
      if (result.errors.length) {
        failed += 1;
        lastError = result.errors[0];
      } else succeeded += 1;
    }

    const resultsAfter = await indexedResultCount(String(leased.query_normalized), String(leased.token_signature));
    const done = cursor >= total;
    const status: DeepSearchStatus = done ? (failed ? "PARTIAL" : "COMPLETE") : "PARTIAL";
    const [updated] = await db()`
      UPDATE judicial_deep_search_jobs SET
        status = ${status}, cursor = ${db().json({ unit: cursor })}, units_total = ${total},
        units_processed = ${processed}, units_succeeded = ${succeeded}, units_failed = ${failed},
        results_after = ${resultsAfter}, lease_owner = NULL, lease_until = NULL,
        last_error_code = ${lastError ? lastError.split(":", 1)[0].slice(0, 100) : null},
        last_error_message = ${lastError?.slice(0, 500) ?? null}, updated_at = now(),
        completed_at = ${done ? new Date().toISOString() : null}
      WHERE id = ${job.id} AND lease_owner = ${owner}
      RETURNING *
    `;
    return updated ? mapJob(updated) : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "No fue posible ampliar la búsqueda";
    const [updated] = await db()`
      UPDATE judicial_deep_search_jobs SET status = 'PARTIAL', lease_owner = NULL, lease_until = NULL,
        units_failed = units_failed + 1, last_error_code = 'DEEP_SEARCH_FAILED',
        last_error_message = ${message.slice(0, 500)}, updated_at = now()
      WHERE id = ${job.id} AND lease_owner = ${owner}
      RETURNING *
    `;
    return updated ? mapJob(updated) : null;
  }
}

export async function processPendingDeepSearchJobs(options: { jobs?: number; unitsPerJob?: number } = {}) {
  const jobs = await db()`
    SELECT id FROM judicial_deep_search_jobs
    WHERE status IN ('PENDING','PARTIAL','RUNNING') AND completed_at IS NULL AND (lease_until IS NULL OR lease_until < now())
    ORDER BY created_at
    LIMIT ${Math.min(10, Math.max(1, options.jobs ?? 2))}
  `;
  const results: DeepSearchJob[] = [];
  for (const row of jobs) {
    const result = await processDeepSearchJob(String(row.id), options.unitsPerJob ?? 10);
    if (result) results.push(result);
  }
  return results;
}

export async function listDeepSearchJobs(limit = 30): Promise<DeepSearchJob[]> {
  const rows = await db()`
    SELECT * FROM judicial_deep_search_jobs
    ORDER BY updated_at DESC
    LIMIT ${Math.min(100, Math.max(1, limit))}
  `;
  return rows.map(mapJob);
}
