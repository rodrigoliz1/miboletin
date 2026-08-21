import "./load-env";
import { appendFile } from "node:fs/promises";
import { runIngestion } from "../src/lib/ingestion/pipeline";
import { refreshMonitoredCase } from "../src/lib/product/refresh";
import { FederalProvider, isFederalSessionCourt } from "../src/lib/providers/federal/provider";
import { JaliscoProvider } from "../src/lib/providers/jalisco/provider";
import { StjJaliscoProvider } from "../src/lib/providers/stj/provider";
import { refreshDueStjSentences } from "../src/lib/providers/stj/sentences";
import { closeDb, db } from "../src/lib/db/client";
import { dateInMexicoCity } from "../src/lib/product/query";
import { linkStoredPublicationsToMonitoredCase, updateMonitoredSourceStatus } from "../src/lib/product/repository";
import { dispatchJudicialEmails } from "../src/lib/email/notifications";

interface ActiveCase {
  id: string;
  caseId: string;
  organizationId: string;
  jurisdiction: "FEDERAL" | "JALISCO";
  courtExternalId: string;
  courtType?: string;
  circuitId?: string;
  caseNumber: string;
  caseType: string;
  provider: string;
}

async function activeCases(): Promise<ActiveCase[]> {
  const rows = await db()`
    SELECT mc.id, mc.organization_id, jc.id AS case_id, ja.jurisdiction, ja.code AS provider, c.external_id AS court_external_id,
           c.court_type, cir.external_id AS circuit_id, jc.case_number_normalized, jc.case_type
    FROM monitored_cases mc
    JOIN judicial_cases jc ON jc.id = mc.case_id
    JOIN judicial_authorities ja ON ja.id = jc.authority_id
    JOIN courts c ON c.id = jc.court_id
    LEFT JOIN judicial_circuits cir ON cir.id = c.circuit_id
    WHERE mc.active AND mc.deleted_at IS NULL AND mc.organization_id IS NOT NULL
      AND ja.code IN ('jalisco-cjj', 'jalisco-stj-chambers', 'federal-pjf-session-lists')
    ORDER BY ja.jurisdiction, c.external_id, jc.case_number_normalized
  `;
  return rows.map((row) => ({
    id: row.id, caseId: row.case_id, organizationId: row.organization_id, jurisdiction: row.jurisdiction, provider: row.provider,
    courtExternalId: row.court_external_id, courtType: row.court_type ?? undefined,
    circuitId: row.circuit_id ?? undefined, caseNumber: row.case_number_normalized, caseType: row.case_type,
  }));
}

async function synchronizeSharedResult(items: ActiveCase[], errors: string[], recordsFetched: number, today: string) {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await linkStoredPublicationsToMonitoredCase(item.organizationId, item.id);
      await updateMonitoredSourceStatus(item.id, errors.length ? "DEGRADED" : "VERIFIED", errors[0], errors.length === 0);
      if (item.jurisdiction === "FEDERAL") {
        await db()`
          INSERT INTO monitored_case_source_checks (monitored_case_id, filter_kind, checked_date, status, records_found, error_message)
          VALUES (${item.id}, 'expediente', ${today}, ${errors.length ? "FAILED" : "SUCCEEDED"}, ${recordsFetched}, ${errors[0] ?? null})
          ON CONFLICT (monitored_case_id, filter_kind, checked_date) DO UPDATE SET
            status = EXCLUDED.status, records_found = EXCLUDED.records_found,
            error_message = EXCLUDED.error_message, checked_at = now()
        `;
      }
      await dispatchJudicialEmails(item.organizationId, item.id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, () => worker()));
}

async function dryRunCase(item: ActiveCase, today: string) {
  if (item.jurisdiction === "JALISCO") {
    const provider = item.provider === "jalisco-stj-chambers" ? new StjJaliscoProvider() : new JaliscoProvider();
    return [await runIngestion(provider, { date: today, courtExternalId: item.courtExternalId, caseNumber: item.caseNumber }, true)];
  }
  if (!item.circuitId) throw new Error("Circuito federal ausente");
  const provider = new FederalProvider();
  const results = [await runIngestion(provider, {
    date: today, circuitId: item.circuitId, courtExternalId: item.courtExternalId,
    caseNumber: item.caseNumber, caseType: item.caseType, sourceMode: "AGREEMENT",
  }, true)];
  if (!isFederalSessionCourt(item.courtType)) return results;
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  for (const filter of ["lista", "sesion"] as const) {
    const dates = (await provider.getAvailableDates(item.courtExternalId, filter, year, month)).filter((date) => date <= today).slice(-2);
    for (const date of dates) results.push(await runIngestion(provider, {
      date, circuitId: item.circuitId, courtExternalId: item.courtExternalId, caseNumber: item.caseNumber,
      caseType: item.caseType, sourceMode: filter === "lista" ? "LISTED" : "SESSION",
    }, true));
  }
  return results;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const today = dateInMexicoCity();
  const cases = await activeCases();
  const groupedCases = [...Map.groupBy(cases, (item) => item.caseId).values()];
  let succeeded = 0;
  let failed = 0;
  let criticalFailures = 0;
  let fetched = 0;
  const failureDetails: Array<{ monitoredCaseId: string; caseNumber: string; court: string; errors: string[] }> = [];

  for (const group of groupedCases) {
    const item = group[0];
    const results = dryRun ? await dryRunCase(item, today) : await refreshMonitoredCase(item.organizationId, item.id, true);
    const errors = results.flatMap((result) => result.errors);
    const caseFetched = results.reduce((sum, result) => sum + result.recordsFetched, 0);
    fetched += caseFetched;
    if (errors.length) {
      failed += group.length;
      failureDetails.push({ monitoredCaseId: item.id, caseNumber: item.caseNumber, court: item.courtExternalId, errors });
      if (errors.some((error) => /STORE_FAILED|DATABASE|MIGRATION|constraint|violates not-null/i.test(error))) {
        criticalFailures += 1;
      }
    } else succeeded += group.length;
    if (!dryRun && group.length > 1) await synchronizeSharedResult(group.slice(1), errors, caseFetched, today);
    console.log(JSON.stringify({ monitoredCaseId: item.id, sharedMonitoredCases: group.length, court: item.courtExternalId, caseNumber: item.caseNumber, status: errors.length ? "failed" : "succeeded", runs: results.length, fetched: caseFetched, errors }));
  }
  if (!dryRun) await refreshDueStjSentences(20);
  const status = failed ? (succeeded ? "partial" : "failed") : "completed";
  const summary = { status, casesAttempted: cases.length, uniqueJudicialCases: groupedCases.length, casesSuccessful: succeeded, casesFailed: failed, criticalFailures, fetched, dryRun };
  console.log(JSON.stringify(summary));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = failureDetails.slice(0, 20).map((failure) =>
      `| ${failure.caseNumber} | ${failure.court} | ${failure.errors.join("; ").replaceAll("|", "\\|").slice(0, 300)} |`,
    );
    await appendFile(process.env.GITHUB_STEP_SUMMARY, [
      "## Vigilancia judicial",
      "",
      `- Estado: **${status}**`,
      `- Asuntos revisados: **${cases.length}**`,
      `- Revisiones correctas: **${succeeded}**`,
      `- Revisiones parciales: **${failed}**`,
      `- Fallos críticos de persistencia: **${criticalFailures}**`,
      `- Registros obtenidos: **${fetched}**`,
      ...(rows.length ? ["", "| Expediente | Órgano | Detalle |", "|---|---|---|", ...rows] : []),
      "",
    ].join("\n"));
  }
  if (failed > 0 && criticalFailures === 0 && process.env.GITHUB_ACTIONS === "true") {
    console.log(`::warning title=Fuentes judiciales con incidencia::${failed} revisiones quedaron parciales. El detalle y los reintentos se conservaron sin detener la vigilancia.`);
  }
  await closeDb();
  // Una fuente pública temporalmente indisponible deja trazabilidad y estado DEGRADED,
  // pero no debe cancelar los demás cron ni convertir un reintento esperado en fallo de infraestructura.
  if (criticalFailures > 0) process.exitCode = 2;
}

void main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await closeDb();
  process.exitCode = 1;
});
