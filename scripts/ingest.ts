import "./load-env";
import { providers, type ProviderId } from "../src/lib/providers";
import { runIngestion } from "../src/lib/ingestion/pipeline";

async function main() {
  const args = process.argv.slice(2);
  const providerId = args[0] as ProviderId;
  if (!(providerId in providers)) throw new Error("Proveedor inválido. Use jalisco, stj o federal.");
  const value = (name: string) => args.find((argument) => argument.startsWith(`--${name}=`))?.split("=")[1];
  const from = value("date") ?? value("from") ?? new Date().toISOString().slice(0, 10);
  const to = value("date") ?? value("to") ?? from;
  const courtExternalId = value("court") ?? (providerId === "jalisco" ? "C01" : undefined);
  const circuitId = value("circuit");
  const caseNumber = value("case");
  const caseType = value("type");
  const mode = value("mode");
  const sourceMode = mode === "agreement" ? "AGREEMENT" as const : mode === "session" ? "SESSION" as const : "LISTED" as const;
  const dryRun = args.includes("--dry-run");
  const verbose = args.includes("--verbose");
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || start > end) {
    throw new Error("Rango inválido. Use --date=AAAA-MM-DD o --from=AAAA-MM-DD --to=AAAA-MM-DD.");
  }

  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    const result = await runIngestion(providers[providerId], { date, courtExternalId, circuitId, caseNumber, caseType, ...(providerId === "federal" ? { sourceMode } : {}) }, dryRun);
    const sample = result.normalized[0];
    const safeResult = {
      ...result,
      normalized: verbose ? result.normalized : undefined,
      normalizedSample: sample
        ? {
            courtExternalId: sample.courtExternalId,
            caseNumberNormalized: sample.caseNumberNormalized,
            publicationDate: sample.publicationDate,
            agreementDate: sample.agreementDate,
            canonicalCaseKey: sample.canonicalCaseKey,
            contentHash: sample.contentHash,
            snapshotHash: sample.snapshotHash,
            parserVersion: sample.parserVersion,
          }
        : undefined,
    };
    console.log(JSON.stringify(safeResult, null, 2));
    if (result.errors.length) process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
