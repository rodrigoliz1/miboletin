import "./load-env";
import { FederalProvider, type FederalSessionFilter } from "../src/lib/providers/federal/provider";
import { runIngestion } from "../src/lib/ingestion/pipeline";
import { closeDb } from "../src/lib/db/client";

function value(args: string[], name: string) {
  return args.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main() {
  const args = process.argv.slice(2);
  const from = value(args, "from");
  const to = value(args, "to") ?? from;
  const court = value(args, "court");
  const circuit = value(args, "circuit");
  const dryRun = args.includes("--dry-run");
  if (!from || !to || !circuit) throw new Error("Use --from=AAAA-MM-DD --to=AAAA-MM-DD --circuit=ID [--court=ID] [--dry-run]");
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || start > end) throw new Error("Rango inválido");
  const provider = new FederalProvider();
  const circuitCourts = await provider.getCourts(circuit);
  const selectedCourts = (court ? circuitCourts.filter((item) => item.externalId === court) : circuitCourts).filter((item) => item.sessionCapable);
  if (!selectedCourts.length) throw new Error(`El órgano ${court ?? "seleccionado"} no pertenece al circuito ${circuit} o no publica listas a sesión`);
  let fetched = 0;
  let inserted = 0;
  let matches = 0;
  let failures = 0;
  for (const selectedCourt of selectedCourts) {
    for (const filter of ["lista", "sesion"] as FederalSessionFilter[]) {
      const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
      while (cursor <= end) {
        const dates = await provider.getAvailableDates(selectedCourt.externalId, filter, cursor.getUTCFullYear(), cursor.getUTCMonth() + 1);
        for (const date of dates.filter((item) => item >= from && item <= to)) {
          const result = await runIngestion(provider, { date, courtExternalId: selectedCourt.externalId, circuitId: circuit, sourceMode: filter === "lista" ? "LISTED" : "SESSION" }, dryRun);
          fetched += result.recordsFetched;
          inserted += result.recordsInserted;
          matches += result.matches;
          if (result.errors.length) failures += 1;
          console.log(JSON.stringify({ court: selectedCourt.externalId, date, filter, fetched: result.recordsFetched, inserted: result.recordsInserted, duplicates: result.duplicates, matches: result.matches, errors: result.errors }));
        }
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    }
  }
  console.log(JSON.stringify({ status: failures ? "partial" : "completed", from, to, circuit, courts: selectedCourts.length, fetched, inserted, matches, failures, dryRun }));
  if (!dryRun) await closeDb();
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
