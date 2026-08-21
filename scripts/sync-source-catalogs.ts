import "./load-env";
import { closeDb } from "../src/lib/db/client";
import { FederalProvider } from "../src/lib/providers/federal/provider";
import { JaliscoProvider } from "../src/lib/providers/jalisco/provider";
import { StjJaliscoProvider } from "../src/lib/providers/stj/provider";
import { syncSourceCatalog } from "../src/lib/parties/coverage";

async function main() {
  const requested = process.argv.find((argument) => argument.startsWith("--provider="))?.split("=")[1];
  const result: Record<string, number> = {};
  if (!requested || requested === "jalisco-cjj") {
    const provider = new JaliscoProvider();
    const courts = await provider.fetchCatalogs();
    result[provider.id] = await syncSourceCatalog(provider.id, courts, courts.length >= 190);
  }
  if (!requested || requested === "jalisco-stj-chambers") {
    const provider = new StjJaliscoProvider();
    result[provider.id] = await syncSourceCatalog(provider.id, await provider.fetchCatalogs());
  }
  if (!requested || requested === "federal-pjf-session-lists") {
    const provider = new FederalProvider();
    const circuits = await provider.getCircuits();
    const entries = [];
    for (const circuit of circuits) {
      const courts = await provider.getCourts(circuit.externalId);
      entries.push(...courts.map((court) => ({ ...court, parentExternalId: circuit.externalId, group: circuit.name })));
    }
    result[provider.id] = await syncSourceCatalog(provider.id, entries);
  }
  console.log(JSON.stringify({ syncedAt: new Date().toISOString(), result }, null, 2));
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(closeDb);
