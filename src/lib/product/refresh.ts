import { runIngestion, type IngestionResult } from "@/lib/ingestion/pipeline";
import { FederalProvider, inferFederalCourtType, isFederalSessionCourt, type FederalSessionFilter } from "@/lib/providers/federal/provider";
import { JaliscoProvider } from "@/lib/providers/jalisco/provider";
import { db } from "@/lib/db/client";
import { getMonitoredCase, linkStoredPublicationsToMonitoredCase, listMonitoredCases, tryMarkMonitoredCaseChecking, updateMonitoredSourceStatus } from "@/lib/product/repository";
import { dispatchJudicialEmails } from "@/lib/email/notifications";

function monthPairs(from: Date, to: Date): Array<{ year: number; month: number }> {
  const pairs: Array<{ year: number; month: number }> = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const last = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (cursor <= last) {
    pairs.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return pairs;
}

async function datesToRefresh(provider: FederalProvider, monitoredCaseId: string, courtId: string, filter: FederalSessionFilter, from: Date, to: Date): Promise<string[]> {
  const dates: string[] = [];
  const pairs = monthPairs(from, to);
  for (let index = 0; index < pairs.length; index += 3) {
    const batches = await Promise.all(pairs.slice(index, index + 3).map((pair) => provider.getAvailableDates(courtId, filter, pair.year, pair.month)));
    dates.push(...batches.flat());
  }
  const bounded = [...new Set(dates)].filter((date) => date >= from.toISOString().slice(0, 10) && date <= to.toISOString().slice(0, 10)).sort().reverse();
  if (!bounded.length) return [];
  const checks = await db()`
    SELECT checked_date::text AS date FROM monitored_case_source_checks
    WHERE monitored_case_id = ${monitoredCaseId} AND filter_kind = ${filter}
      AND status = 'SUCCEEDED' AND checked_date = ANY(${bounded})
  `;
  const existing = new Set(checks.map((row) => String(row.date)));
  const missing = bounded.filter((date) => !existing.has(date));
  return [...new Set([...bounded.slice(0, 2), ...missing])];
}

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
      const now = new Date();
      const monitorFrom = new Date(`${watched.monitorFrom}T00:00:00Z`);
      const agreement = await runIngestion(provider, {
        date: now.toISOString().slice(0, 10),
        courtExternalId: watched.courtExternalId,
        circuitId: watched.circuitId,
        caseNumber: watched.number,
        caseType: watched.caseType,
        sourceMode: "AGREEMENT",
      });
      results.push(agreement);
      await db()`
        INSERT INTO monitored_case_source_checks (monitored_case_id, filter_kind, checked_date, status, records_found, error_message)
        VALUES (${monitoredCaseId}, 'expediente', ${now.toISOString().slice(0, 10)}, ${agreement.errors.length ? "FAILED" : "SUCCEEDED"}, ${agreement.recordsFetched}, ${agreement.errors[0] ?? null})
        ON CONFLICT (monitored_case_id, filter_kind, checked_date) DO UPDATE SET
          status = EXCLUDED.status, records_found = EXCLUDED.records_found,
          error_message = EXCLUDED.error_message, checked_at = now()
      `;
      await linkStoredPublicationsToMonitoredCase(organizationId, monitoredCaseId);
      const effectiveCourtType = watched.courtType ?? inferFederalCourtType(watched.courtName);
      if (!isFederalSessionCourt(effectiveCourtType)) {
        const errors = results.flatMap((result) => result.errors);
        await updateMonitoredSourceStatus(monitoredCaseId, errors.length ? "DEGRADED" : "VERIFIED", errors[0], errors.length === 0);
        await dispatchJudicialEmails(organizationId, monitoredCaseId);
        return results;
      }
      for (const filter of ["lista", "sesion"] as const) {
        const dates = await datesToRefresh(provider, monitoredCaseId, watched.courtExternalId, filter, monitorFrom, now);
        for (let index = 0; index < dates.length; index += 3) {
          const batch = dates.slice(index, index + 3);
          const checked = await Promise.all(batch.map(async (date) => {
            const result = await runIngestion(provider, {
              date,
              courtExternalId: watched.courtExternalId,
              circuitId: watched.circuitId,
              caseNumber: watched.number,
              caseType: watched.caseType,
              sourceMode: filter === "lista" ? "LISTED" : "SESSION",
            });
            await db()`
              INSERT INTO monitored_case_source_checks (monitored_case_id, filter_kind, checked_date, status, records_found, error_message)
              VALUES (${monitoredCaseId}, ${filter}, ${date}, ${result.errors.length ? "FAILED" : "SUCCEEDED"}, ${result.recordsFetched}, ${result.errors[0] ?? null})
              ON CONFLICT (monitored_case_id, filter_kind, checked_date) DO UPDATE SET
                status = EXCLUDED.status, records_found = EXCLUDED.records_found,
                error_message = EXCLUDED.error_message, checked_at = now()
            `;
            return result;
          }));
          results.push(...checked);
          await linkStoredPublicationsToMonitoredCase(organizationId, monitoredCaseId);
        }
      }
    } else {
      const provider = new JaliscoProvider();
      results.push(await runIngestion(provider, {
        date: new Date().toISOString().slice(0, 10),
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
    await updateMonitoredSourceStatus(monitoredCaseId, "FAILED", message, false);
    return [{
      jobId: `refresh-failed-${monitoredCaseId}`, provider: watched.provider, startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(), duration: 0, recordsFetched: 0, recordsInserted: 0, recordsUpdated: 0,
      duplicates: 0, matches: 0, notifications: 0, dryRun: false, normalized: [], errors: [message],
    }];
  }
}

export async function refreshOrganizationCases(organizationId: string): Promise<void> {
  const cases = await listMonitoredCases(organizationId);
  let cursor = 0;
  const worker = async () => {
    while (cursor < cases.length) {
      const item = cases[cursor++];
      const acquired = await tryMarkMonitoredCaseChecking(organizationId, item.id);
      if (acquired) await refreshMonitoredCase(organizationId, item.id, true);
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, cases.length) }, () => worker()));
}
