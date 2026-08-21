import "./load-env";
import { closeDb, db } from "../src/lib/db/client";
import { searchParties } from "../src/lib/parties/search";

function option(name: string) {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main() {
  const query = option("name");
  if (!query) throw new Error("Use --name='Nombre a buscar'");
  let organizationId = option("organization");
  if (!organizationId) {
    const [organization] = await db()`SELECT id FROM organizations ORDER BY created_at LIMIT 1`;
    if (!organization) throw new Error("No existe una organización para contextualizar los expedientes vigilados");
    organizationId = String(organization.id);
  }
  const result = await searchParties({ organizationId, query, pageSize: 20 });
  console.log(JSON.stringify({ query: result.query, total: result.total, coverageComplete: result.coverageComplete, results: result.results, coverage: result.coverage }, null, 2));
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(closeDb);
