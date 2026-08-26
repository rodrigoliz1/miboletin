import { runIngestion, type IngestionResult } from "@/lib/ingestion/pipeline";
import { FederalProvider } from "@/lib/providers/federal/provider";
import { JaliscoProvider } from "@/lib/providers/jalisco/provider";
import { StjJaliscoProvider } from "@/lib/providers/stj/provider";
import { refreshStjSentenceAvailability } from "@/lib/providers/stj/sentences";
import { db } from "@/lib/db/client";
import { getMonitoredCase, linkStoredPublicationsToMonitoredCase, listMonitoredCases, tryMarkMonitoredCaseChecking, updateMonitoredSourceStatus } from "@/lib/product/repository";
import { dispatchJudicialEmails } from "@/lib/email/notifications";
import { dateInMexicoCity } from "@/lib/product/query";
import { randomUUID } from "node:crypto";
import { recordPartyDiscoveryFailure } from "@/lib/parties/discovery";

export async function refreshMonitoredCase(organizationId: string, monitoredCaseId: string, force = false): Promise<IngestionResult[]> {
  const detail = await getMonitoredCase(organizationId, monitoredCaseId);
  if (!detail) throw new Error("Asunto vigilado no encontrado");
  const watched = detail.case;
  if (!force && watched.lastCheckedAt && Date.now() - new Date(watched.lastCheckedAt).valueOf() < 60_000) return [];
  const results: IngestionResult[] = [];
  try {
    if (watched.jurisdiction === "FEDERAL") {
      if (!watched.circuitId) throw new Error("El asunto federal no tiene circuito asociado");
      const provider = new FederalProvider();
      const today = dateInMexicoCity();
      const agreement = await runIngestion(provider, {
        date: today,
        courtExternalId: watched.courtExternalId,
        circuitId: watched.circuitId,
        caseNumber: watched.number,
        caseType: watched.caseType,
        sourceMode: "AGREEMENT",
      });
      results.push(agreement);
      if (agreement.errors.length) {
        const invalid = agreement.errors.some((message) => /SCHEMA|INVALID|cambi[oó]|columnas|HTML/i.test(message));
        await recordPartyDiscoveryFailure({
          caseId: watched.caseId, provider: watched.provider,
          status: invalid ? "DETAIL_INVALID" : "SOURCE_FAILED",
          errorCode: invalid ? "FEDERAL_DETAIL_INVALID" : "FEDERAL_SOURCE_FAILED",
          message: agreement.errors[0],
          metadata: { recordsFetched: agreement.recordsFetched },
        });
      } else if (agreement.recordsFetched === 0) {
        await recordPartyDiscoveryFailure({
          caseId: watched.caseId, provider: watched.provider, status: "DETAIL_UNAVAILABLE",
          errorCode: "NO_MATCHING_PUBLIC_CASE",
          message: "La ficha oficial no publicó datos para la combinación exacta de órgano, tipo y expediente.",
        });
      }
      await db()`
        INSERT INTO monitored_case_source_checks (monitored_case_id, filter_kind, checked_date, status, records_found, error_message)
        VALUES (${monitoredCaseId}, 'expediente', ${today}, ${agreement.errors.length ? "FAILED" : "SUCCEEDED"}, ${agreement.recordsFetched}, ${agreement.errors[0] ?? null})
        ON CONFLICT (monitored_case_id, filter_kind, checked_date) DO UPDATE SET
          status = EXCLUDED.status, records_found = EXCLUDED.records_found,
          error_message = EXCLUDED.error_message, checked_at = now()
      `;
      await linkStoredPublicationsToMonitoredCase(organizationId, monitoredCaseId);
      // La ficha exacta del expediente ya publica su fecha de lista, sesión y
      // resultado. Consultar calendarios históricos por número mezclaba asuntos
      // homónimos y multiplicaba decenas de peticiones. El backfill institucional
      // sigue disponible, pero la actualización del usuario usa la ficha canónica.
    } else if (watched.provider === "jalisco-stj-chambers") {
      const provider = new StjJaliscoProvider();
      results.push(await runIngestion(provider, {
        date: dateInMexicoCity(),
        courtExternalId: watched.courtExternalId,
        caseNumber: watched.number,
      }));
      await linkStoredPublicationsToMonitoredCase(organizationId, monitoredCaseId);
      const [due] = await db()`SELECT judicial_case_id FROM stj_case_details WHERE judicial_case_id = ${watched.caseId} AND sentence_state IN ('PENDING_PUBLICATION', 'PARTIAL', 'NOT_FOUND', 'UNAVAILABLE', 'ERROR') AND (next_retry_at IS NULL OR next_retry_at <= now())`;
      if (due) {
        try { await refreshStjSentenceAvailability(watched.caseId); }
        catch (error) { console.error("STJ judgment availability check failed without invalidating agreements", { caseId: watched.caseId, error }); }
      }
    } else {
      const provider = new JaliscoProvider();
      results.push(await runIngestion(provider, {
        date: dateInMexicoCity(),
        courtExternalId: watched.courtExternalId,
        caseNumber: watched.number,
      }));
    }
    await linkStoredPublicationsToMonitoredCase(organizationId, monitoredCaseId);
    const errors = results.flatMap((result) => result.errors);
    await updateMonitoredSourceStatus(monitoredCaseId, errors.length ? "DEGRADED" : "VERIFIED", errors[0], errors.length === 0);
    await dispatchJudicialEmails(organizationId, monitoredCaseId);
    return results;
  } catch (error) {
    const message = error instanceof Error ? error.message : "No fue posible comprobar la fuente";
    if (detail.case.jurisdiction === "FEDERAL") {
      await recordPartyDiscoveryFailure({
        caseId: detail.case.caseId, provider: detail.case.provider, status: "SOURCE_FAILED",
        errorCode: "FEDERAL_REFRESH_FAILED", message,
      }).catch(() => undefined);
    }
    await updateMonitoredSourceStatus(monitoredCaseId, "FAILED", message, false);
    return [{
      jobId: `refresh-failed-${monitoredCaseId}`, provider: watched.provider, startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(), duration: 0, recordsFetched: 0, recordsInserted: 0, recordsUpdated: 0,
      duplicates: 0, matches: 0, notifications: 0, partiesFound: 0, mentionsCreated: 0,
      dryRun: false, normalized: [], errors: [message], warnings: [],
    }];
  }
}

export async function refreshOrganizationCases(
  organizationId: string,
  options: { force?: boolean; limit?: number } = {},
): Promise<void> {
  const force = options.force ?? true;
  const limit = Math.min(Math.max(options.limit ?? Number.MAX_SAFE_INTEGER, 1), 100);
  const now = Date.now();
  const cases = (await listMonitoredCases(organizationId))
    .filter((item) => force || !item.lastCheckedAt || now - new Date(item.lastCheckedAt).valueOf() >= 5 * 60_000)
    .slice(0, limit);
  let cursor = 0;
  const worker = async () => {
    while (cursor < cases.length) {
      const item = cases[cursor++];
      const acquired = await tryMarkMonitoredCaseChecking(organizationId, item.id, force);
      if (acquired) await refreshMonitoredCase(organizationId, item.id, true);
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, cases.length) }, () => worker()));
}

export interface AutomaticRefreshBatchResult {
  acquired: boolean;
  attempted: number;
  refreshed: number;
  failed: number;
  skipped: number;
}

function automaticBatchSize(): number {
  const configured = Number(process.env.CRON_REFRESH_BATCH_SIZE ?? 12);
  return Number.isInteger(configured) ? Math.min(Math.max(configured, 1), 30) : 12;
}

export async function runAutomaticRefreshBatch(): Promise<AutomaticRefreshBatchResult> {
  const ownerToken = randomUUID();
  const [lock] = await db()`
    INSERT INTO scheduled_job_locks (job_key, owner_token, locked_until)
    VALUES ('automatic-judicial-refresh', ${ownerToken}, now() + interval '9 minutes')
    ON CONFLICT (job_key) DO UPDATE SET
      owner_token = EXCLUDED.owner_token,
      locked_at = now(),
      locked_until = EXCLUDED.locked_until
    WHERE scheduled_job_locks.locked_until < now()
    RETURNING owner_token
  `;
  if (!lock) return { acquired: false, attempted: 0, refreshed: 0, failed: 0, skipped: 0 };

  try {
    const due = await db()`
      SELECT mc.id, mc.organization_id
      FROM monitored_cases mc
      JOIN billing_subscriptions bs ON bs.organization_id = mc.organization_id
      WHERE mc.active AND mc.deleted_at IS NULL
        AND bs.status IN ('active', 'trialing')
        AND (bs.current_period_end IS NULL OR bs.current_period_end > now())
        AND (mc.last_checked_at IS NULL OR mc.last_checked_at < now() - interval '8 minutes')
        AND (
          mc.source_status <> 'CHECKING'
          OR mc.refresh_started_at IS NULL
          OR mc.refresh_started_at < now() - interval '15 minutes'
        )
      ORDER BY mc.last_checked_at ASC NULLS FIRST, mc.created_at ASC
      LIMIT ${automaticBatchSize()}
    `;
    let cursor = 0;
    let refreshed = 0;
    let failed = 0;
    let skipped = 0;
    const worker = async () => {
      while (cursor < due.length) {
        const item = due[cursor++];
        const acquired = await tryMarkMonitoredCaseChecking(item.organization_id, item.id);
        if (!acquired) {
          skipped += 1;
          continue;
        }
        const results = await refreshMonitoredCase(item.organization_id, item.id, true);
        if (results.some((result) => result.errors.length)) failed += 1;
        else refreshed += 1;
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, due.length) }, () => worker()));
    return { acquired: true, attempted: due.length, refreshed, failed, skipped };
  } finally {
    await db()`DELETE FROM scheduled_job_locks WHERE job_key = 'automatic-judicial-refresh' AND owner_token = ${ownerToken}`;
  }
}
