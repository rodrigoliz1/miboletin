import "./load-env";
import { closeDb } from "../src/lib/db/client";
import { processPendingDeepSearchJobs } from "../src/lib/parties/deep-search";

function option(name: string, fallback: number) {
  const value = process.argv.find((argument) => argument.startsWith(`--${name}=`))?.split("=")[1];
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function main() {
  const jobs = await processPendingDeepSearchJobs({ jobs: Math.min(10, option("jobs", 3)), unitsPerJob: Math.min(100, option("units", 20)) });
  console.log(JSON.stringify({ processedAt: new Date().toISOString(), jobs }, null, 2));
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(closeDb);
