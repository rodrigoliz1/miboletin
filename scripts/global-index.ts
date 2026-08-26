import "./load-env";
import { nanoid } from "nanoid";
import { closeDb, db } from "../src/lib/db/client";
import { runIngestion } from "../src/lib/ingestion/pipeline";
import { FederalProvider, type FederalSessionFilter } from "../src/lib/providers/federal/provider";
import { JaliscoProvider } from "../src/lib/providers/jalisco/provider";
import { dateInMexicoCity } from "../src/lib/product/query";
import { recordCoverageUnit, syncSourceCatalog } from "../src/lib/parties/coverage";
import { createIndexingJaliscoProvider } from "../src/lib/parties/jalisco-catalog";

type GlobalProvider = "jalisco-cjj" | "federal-pjf-session-lists";
type Unit = { date: string; courtExternalId: string; circuitId?: string; sourceMode?: "LISTED" | "SESSION" };
type Shard = { index: number; total: number; key: string };

let activeGlobalJobId: string | null = null;
let stopping = false;

async function markInterrupted(signal: string) {
  if (stopping) return;
  stopping = true;
  if (activeGlobalJobId && process.env.DATABASE_URL) {
    try {
      await db()`UPDATE global_index_runs SET status = 'PARTIAL', last_error_code = ${`INTERRUPTED_${signal}`} WHERE job_id = ${activeGlobalJobId} AND completed_at IS NULL`;
    } catch { /* El cursor confirmado en la unidad anterior sigue siendo resumible. */ }
  }
  await closeDb();
  process.exit(130);
}

process.once("SIGINT", () => { void markInterrupted("SIGINT"); });
process.once("SIGTERM", () => { void markInterrupted("SIGTERM"); });

function option(args: string[], name: string): string | undefined {
  return args.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function positiveIntegerOption(args: string[], name: string, fallback: number, maximum: number): number {
  const parsed = Number(option(args, name) ?? fallback);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(1, parsed)) : fallback;
}

function parseShard(value: string | undefined): Shard | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d+)\/(\d+)$/);
  if (!match) throw new Error("El segmento debe usar el formato --shard=1/4");
  const ordinal = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isInteger(ordinal) || !Number.isInteger(total) || total < 1 || total > 16 || ordinal < 1 || ordinal > total) {
    throw new Error("El segmento debe estar entre 1 y el total, con un máximo de 16 segmentos");
  }
  return { index: ordinal - 1, total, key: `${ordinal}/${total}` };
}

function inShard(index: number, shard?: Shard): boolean {
  return !shard || index % shard.total === shard.index;
}

function isSourceAvailabilityFailure(errors: string[], recordsFetched: number): boolean {
  return recordsFetched === 0 && errors.some((error) =>
    /SOURCE_UNAVAILABLE|TIMEOUT|No fue posible conectar|excedi[oó] \d+ segundos|HTTP (?:429|5\d\d)|certificado HTTPS|cat[aá]logo.+no respondi[oó]/i.test(error),
  );
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).valueOf());
}

function dates(from: string, to: string): string[] {
  const result: string[] = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function months(from: string, to: string): Array<{ year: number; month: number }> {
  const result: Array<{ year: number; month: number }> = [];
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1, 12));
  while (cursor <= end) {
    result.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}

async function* jaliscoUnits(catalog: Awaited<ReturnType<JaliscoProvider["fetchCatalogs"]>>, from: string, to: string, courtFilter?: string, shard?: Shard): AsyncGenerator<Unit> {
  const priority = (matter?: string) => matter === "Mercantil" ? 0 : matter === "Civil" ? 1 : matter === "Familiar" ? 2 : 3;
  const eligible = catalog
    .filter((court) => !courtFilter || court.externalId === courtFilter)
    .sort((left, right) => priority(left.matter) - priority(right.matter) || left.externalId.localeCompare(right.externalId));
  if (!eligible.length) throw new Error("El órgano CJJ solicitado no existe en el catálogo oficial");
  const courts = eligible.filter((_, index) => inShard(index, shard));
  for (const date of dates(from, to)) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (const court of courts) yield { date, courtExternalId: court.externalId };
  }
}

async function* federalUnits(from: string, to: string, circuitFilter?: string, courtFilter?: string, shard?: Shard): AsyncGenerator<Unit> {
  const provider = new FederalProvider();
  const circuits = (await provider.getCircuits())
    .filter((circuit) => !circuitFilter || circuit.externalId === circuitFilter)
    .sort((left, right) => Number(left.externalId) - Number(right.externalId));
  if (!circuits.length) throw new Error("El circuito solicitado no existe en el catálogo federal");
  const courtGroups: Array<{ circuit: (typeof circuits)[number]; courts: Awaited<ReturnType<FederalProvider["getCourts"]>> }> = [];
  for (const circuit of circuits) {
    const courts = (await provider.getCourts(circuit.externalId))
      .filter((court) => court.sessionCapable && (!courtFilter || court.externalId === courtFilter))
      .sort((left, right) => left.externalId.localeCompare(right.externalId));
    courtGroups.push({ circuit, courts });
  }
  await syncSourceCatalog(provider.id, courtGroups.flatMap(({ circuit, courts }) => courts.map((court) => ({
    ...court, parentExternalId: circuit.externalId, group: circuit.name,
  }))), !circuitFilter && !courtFilter);
  const eligible = courtGroups.flatMap(({ circuit, courts }) => courts.map((court) => ({ circuit, court })));
  for (const { circuit, court } of eligible.filter((_, index) => inShard(index, shard))) {
      for (const filter of ["lista", "sesion"] as FederalSessionFilter[]) {
        for (const period of months(from, to)) {
          const available = await provider.getAvailableDates(court.externalId, filter, period.year, period.month);
          for (const date of available.filter((item) => item >= from && item <= to).sort()) {
            yield {
              date,
              courtExternalId: court.externalId,
              circuitId: circuit.externalId,
              sourceMode: filter === "lista" ? "LISTED" : "SESSION",
            };
          }
        }
      }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const forceCovered = args.includes("--force-covered");
  const resume = option(args, "resume");
  const requestedProvider = option(args, "provider");
  const requestedShard = parseShard(option(args, "shard"));
  const maxUnits = positiveIntegerOption(args, "max-units", 250, 2_000);
  const maxMinutes = positiveIntegerOption(args, "max-minutes", 90, 110);
  const maxConsecutiveFailures = positiveIntegerOption(args, "max-consecutive-failures", 4, 20);
  const delayMs = Math.min(2_000, Math.max(0, Number(option(args, "delay-ms") ?? 100)));
  const sql = db();

  if (apply) {
    await sql`
      UPDATE global_index_runs SET status = 'PARTIAL', last_error_code = 'STALE_WORKER_RECOVERED'
      WHERE status = 'RUNNING' AND completed_at IS NULL AND started_at < now() - interval '110 minutes'
    `;
  }

  const today = dateInMexicoCity();
  const requestedFrom = option(args, "from") ?? today;
  const requestedTo = option(args, "to") ?? requestedFrom;
  const requestedCourt = option(args, "court");
  const requestedCircuit = option(args, "circuit");
  let stored: Record<string, unknown> | undefined;
  if (resume) {
    const rows = resume === "latest"
      ? requestedProvider
        ? await sql`SELECT * FROM global_index_runs WHERE provider = ${requestedProvider} AND date_from = ${requestedFrom} AND date_to = ${requestedTo}
                    AND court_external_id IS NOT DISTINCT FROM ${requestedCourt ?? null}
                    AND circuit_external_id IS NOT DISTINCT FROM ${requestedCircuit ?? null}
                    AND details->>'shard' IS NOT DISTINCT FROM ${requestedShard?.key ?? null}
                    AND completed_at IS NULL AND status IN ('RUNNING','PARTIAL','FAILED') ORDER BY started_at DESC LIMIT 1`
        : await sql`SELECT * FROM global_index_runs WHERE completed_at IS NULL AND status IN ('RUNNING','PARTIAL','FAILED') ORDER BY started_at DESC LIMIT 1`
      : await sql`SELECT * FROM global_index_runs WHERE job_id = ${resume} LIMIT 1`;
    stored = rows[0];
    if (!stored && resume !== "latest") throw new Error("No se encontró una ejecución global resumible");
    if (!apply) throw new Error("Para continuar una ejecución persistida agrega --apply");
  }

  const provider = String(stored?.provider ?? requestedProvider ?? "") as GlobalProvider;
  if (!(["jalisco-cjj", "federal-pjf-session-lists"] as string[]).includes(provider)) {
    throw new Error("Use --provider=jalisco-cjj o --provider=federal-pjf-session-lists");
  }
  const from = String(stored?.date_from ? String(stored.date_from).slice(0, 10) : requestedFrom);
  const to = String(stored?.date_to ? String(stored.date_to).slice(0, 10) : requestedTo);
  if (!validDate(from) || !validDate(to) || from > to) throw new Error("El rango global debe usar AAAA-MM-DD y ser ascendente");
  const court = stored?.court_external_id ? String(stored.court_external_id) : option(args, "court");
  const circuit = stored?.circuit_external_id ? String(stored.circuit_external_id) : option(args, "circuit");
  const storedShard = parseShard(typeof (stored?.details as Record<string, unknown> | undefined)?.shard === "string" ? String((stored?.details as Record<string, unknown>).shard) : undefined);
  const shard = storedShard ?? requestedShard;
  const jobId = String(stored?.job_id ?? `global-${provider}-${from}-${to}-${nanoid(6)}`);
  activeGlobalJobId = apply ? jobId : null;
  let cursor = Number((stored?.cursor as { unit?: number } | undefined)?.unit ?? 0);
  const totals = {
    unitsAttempted: Number(stored?.units_attempted ?? 0),
    unitsSucceeded: Number(stored?.units_succeeded ?? 0),
    unitsFailed: Number(stored?.units_failed ?? 0),
    recordsFetched: Number(stored?.records_fetched ?? 0),
    recordsInserted: Number(stored?.records_inserted ?? 0),
    partiesFound: Number(stored?.parties_found ?? 0),
  };

  if (apply && !stored) {
    await sql`
      INSERT INTO global_index_runs (
        job_id, provider, status, dry_run, date_from, date_to, court_external_id, circuit_external_id, details
      ) VALUES (
        ${jobId}, ${provider}, 'RUNNING', false, ${from}, ${to}, ${court ?? null}, ${circuit ?? null},
        ${sql.json({ maxUnits, maxMinutes, maxConsecutiveFailures, delayMs, shard: shard?.key ?? null, forceCovered })}
      )
    `;
  } else if (apply) {
    await sql`UPDATE global_index_runs SET status = 'RUNNING', completed_at = NULL WHERE job_id = ${jobId}`;
  }

  const jalisco = provider === "jalisco-cjj" ? await createIndexingJaliscoProvider() : null;
  const unitSource = provider === "jalisco-cjj"
    ? jaliscoUnits(jalisco!.courts, from, to, court, shard)
    : federalUnits(from, to, circuit, court, shard);
  const source = provider === "jalisco-cjj" ? jalisco!.provider : new FederalProvider();
  let ordinal = 0;
  let attemptedNow = 0;
  let succeededNow = 0;
  let failedNow = 0;
  let skippedNow = 0;
  let criticalFailuresNow = 0;
  let consecutiveSourceFailures = 0;
  let hasMore = false;
  let stopReason: string | null = null;
  const deadline = Date.now() + maxMinutes * 60_000;
  try {
    for await (const unit of unitSource) {
      if (ordinal < cursor) { ordinal += 1; continue; }
      if (attemptedNow >= maxUnits) { hasMore = true; break; }
      if (Date.now() >= deadline) {
        hasMore = true;
        stopReason = "TIME_BUDGET_REACHED";
        break;
      }
      if (apply && !forceCovered) {
        const [covered] = await sql`
          SELECT 1 FROM judicial_source_coverage
          WHERE provider = ${provider} AND court_external_id = ${unit.courtExternalId}
            AND parent_external_id = ${unit.circuitId ?? ""} AND coverage_date = ${unit.date}
            AND resource_kind = ${unit.sourceMode ?? "PUBLICATIONS"} AND status = 'COMPLETE'
          LIMIT 1
        `;
        if (covered) {
          skippedNow += 1;
          cursor = ordinal + 1;
          ordinal += 1;
          await sql`UPDATE global_index_runs SET cursor = ${sql.json({ unit: cursor, last: unit })} WHERE job_id = ${jobId}`;
          continue;
        }
      }
      const result = await runIngestion(source, unit, !apply);
      if (apply) {
        await recordCoverageUnit({
          provider, courtExternalId: unit.courtExternalId, parentExternalId: unit.circuitId,
          date: unit.date, resourceKind: unit.sourceMode ?? "PUBLICATIONS", result,
          metadata: { globalIndexJobId: jobId },
        });
      }
      attemptedNow += 1;
      totals.unitsAttempted += 1;
      totals.recordsFetched += result.recordsFetched;
      totals.recordsInserted += result.recordsInserted;
      totals.partiesFound += result.partiesFound;
      if (result.errors.length) {
        totals.unitsFailed += 1;
        failedNow += 1;
        if (result.errors.some((error) => /STORE_FAILED|DATABASE|MIGRATION|constraint|violates not-null/i.test(error))) {
          criticalFailuresNow += 1;
        }
        consecutiveSourceFailures = isSourceAvailabilityFailure(result.errors, result.recordsFetched)
          ? consecutiveSourceFailures + 1
          : 0;
      } else {
        totals.unitsSucceeded += 1;
        succeededNow += 1;
        consecutiveSourceFailures = 0;
      }
      cursor = ordinal + 1;
      ordinal += 1;
      if (apply) {
        await sql`
          UPDATE global_index_runs SET
            cursor = ${sql.json({ unit: cursor, last: unit })},
            units_attempted = ${totals.unitsAttempted}, units_succeeded = ${totals.unitsSucceeded},
            units_failed = ${totals.unitsFailed}, records_fetched = ${totals.recordsFetched},
            records_inserted = ${totals.recordsInserted}, parties_found = ${totals.partiesFound},
            last_error_code = ${result.errors[0]?.slice(0, 120) ?? null}
          WHERE job_id = ${jobId}
        `;
      }
      console.log(JSON.stringify({ unit: cursor, provider, court: unit.courtExternalId, circuit: unit.circuitId, date: unit.date, mode: unit.sourceMode ?? "PUBLICATIONS", fetched: result.recordsFetched, inserted: result.recordsInserted, partiesFound: result.partiesFound, errors: result.errors.length }));
      if (consecutiveSourceFailures >= maxConsecutiveFailures) {
        hasMore = true;
        stopReason = "SOURCE_CIRCUIT_OPEN";
        break;
      }
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isSourceAvailabilityFailure([message], 0)) throw error;
    hasMore = true;
    failedNow += 1;
    stopReason = "SOURCE_CATALOG_UNAVAILABLE";
    console.log(`::warning title=Catálogo judicial temporalmente no disponible::${message.slice(0, 300)}`);
  }
  const status = hasMore ? "PARTIAL" : totals.unitsFailed ? "PARTIAL" : "SUCCEEDED";
  if (apply) {
    await sql`
      UPDATE global_index_runs SET status = ${status}, completed_at = CASE WHEN ${hasMore} THEN NULL ELSE now() END,
        cursor = ${sql.json({ unit: cursor })},
        last_error_code = CASE WHEN ${stopReason}::text IS NOT NULL THEN ${stopReason} ELSE CASE WHEN ${totals.unitsFailed} > 0 THEN last_error_code ELSE NULL END END,
        details = details || ${sql.json({ lastStopReason: stopReason, skippedComplete: skippedNow })}
      WHERE job_id = ${jobId}
    `;
  }
  console.log(JSON.stringify({ jobId, provider, from, to, shard: shard?.key, dryRun: !apply, status, cursor, hasMore, stopReason, attemptedNow, succeededNow, failedNow, skippedNow, criticalFailuresNow, ...totals }, null, 2));
  if (failedNow > 0 && criticalFailuresNow === 0 && process.env.GITHUB_ACTIONS === "true") {
    console.log(`::warning title=Índice judicial parcial::${failedNow} unidades no pudieron consultarse. Quedaron registradas para reintento sin detener el índice.`);
  }
  activeGlobalJobId = null;
  await closeDb();
  if (criticalFailuresNow > 0) process.exitCode = 2;
}

void main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  if (activeGlobalJobId && process.env.DATABASE_URL) {
    try {
      await db()`UPDATE global_index_runs SET status = 'FAILED', last_error_code = ${message.slice(0, 120)} WHERE job_id = ${activeGlobalJobId} AND completed_at IS NULL`;
    } catch { /* La falla original conserva prioridad. */ }
  }
  await closeDb();
  process.exitCode = 1;
});
