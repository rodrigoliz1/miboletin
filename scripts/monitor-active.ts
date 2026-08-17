import "./load-env";
import { runIngestion } from "../src/lib/ingestion/pipeline";
import { refreshMonitoredCase } from "../src/lib/product/refresh";
import { FederalProvider, isFederalSessionCourt } from "../src/lib/providers/federal/provider";
import { JaliscoProvider } from "../src/lib/providers/jalisco/provider";
import { closeDb, db } from "../src/lib/db/client";
import { dateInMexicoCity } from "../src/lib/product/query";

interface ActiveCase {
  id: string;
  organizationId: string;
  jurisdiction: "FEDERAL" | "JALISCO";
  courtExternalId: string;
  courtType?: string;
  circuitId?: string;
  caseNumber: string;
  caseType: string;
}

async function activeCases(): Promise<ActiveCase[]> {
  const rows = await db()`
    SELECT mc.id, mc.organization_id, ja.jurisdiction, c.external_id AS court_external_id,
           c.court_type, cir.external_id AS circuit_id, jc.case_number_normalized, jc.case_type
    FROM monitored_cases mc
    JOIN judicial_cases jc ON jc.id = mc.case_id
    JOIN judicial_authorities ja ON ja.id = jc.authority_id
    JOIN courts c ON c.id = jc.court_id
    LEFT JOIN judicial_circuits cir ON cir.id = c.circuit_id
    WHERE mc.active AND mc.organization_id IS NOT NULL
      AND ja.code IN ('jalisco-cjj', 'federal-pjf-session-lists')
    ORDER BY ja.jurisdiction, c.external_id, jc.case_number_normalized
  `;
  return rows.map((row) => ({
    id: row.id, organizationId: row.organization_id, jurisdiction: row.jurisdiction,
    courtExternalId: row.court_external_id, courtType: row.court_type ?? undefined,
    circuitId: row.circuit_id ?? undefined, caseNumber: row.case_number_normalized, caseType: row.case_type,
  }));
}

async function dryRunCase(item: ActiveCase, today: string) {
  if (item.jurisdiction === "JALISCO") {
    return [await runIngestion(new JaliscoProvider(), { date: today, courtExternalId: item.courtExternalId, caseNumber: item.caseNumber }, true)];
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
  let succeeded = 0;
  let failed = 0;
  let fetched = 0;

  for (const item of cases) {
    const results = dryRun ? await dryRunCase(item, today) : await refreshMonitoredCase(item.organizationId, item.id, true);
    const errors = results.flatMap((result) => result.errors);
    const caseFetched = results.reduce((sum, result) => sum + result.recordsFetched, 0);
    fetched += caseFetched;
    if (errors.length) failed += 1;
    else succeeded += 1;
    console.log(JSON.stringify({ monitoredCaseId: item.id, court: item.courtExternalId, caseNumber: item.caseNumber, status: errors.length ? "failed" : "succeeded", runs: results.length, fetched: caseFetched, errors }));
  }
  console.log(JSON.stringify({ status: failed ? "partial" : "completed", casesAttempted: cases.length, casesSuccessful: succeeded, casesFailed: failed, fetched, dryRun }));
  await closeDb();
  if (failed) process.exitCode = 2;
}

void main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await closeDb();
  process.exitCode = 1;
});
