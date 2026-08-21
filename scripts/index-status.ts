import "./load-env";
import { closeDb } from "../src/lib/db/client";
import { getIndexCoverage } from "../src/lib/parties/discovery";
import { listCourtCoverage, listIndexAnomalies } from "../src/lib/parties/coverage";
import { listDeepSearchJobs } from "../src/lib/parties/deep-search";

function option(name: string) {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main() {
  const provider = option("provider");
  const allCourts = process.argv.includes("--all-courts");
  const [allSources, allCourtRows, jobs, anomalies] = await Promise.all([
    getIndexCoverage(), listCourtCoverage(provider, 1000), listDeepSearchJobs(20), listIndexAnomalies(20),
  ]);
  const sources = provider ? allSources.filter((source) => source.provider === provider) : allSources;
  const courts = allCourts ? allCourtRows : allCourtRows.filter((court) => court.coveredDays > 0 || court.lastError);
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), sources, courts, jobs, anomalies }, null, 2));
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(closeDb);
