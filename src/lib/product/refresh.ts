import { runIngestion, type IngestionResult } from "@/lib/ingestion/pipeline";
import { FederalProvider } from "@/lib/providers/federal/provider";
import { JaliscoProvider } from "@/lib/providers/jalisco/provider";
import { db } from "@/lib/db/client";
import { getMonitoredCase, linkStoredPublicationsToMonitoredCase, listMonitoredCases, tryMarkMonitoredCaseChecking, updateMonitoredSourceStatus } from "@/lib/product/repository";
import { dispatchJudicialEmails } from "@/lib/email/notifications";
import { dateInMexicoCity } from "@/lib/product/query";

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
