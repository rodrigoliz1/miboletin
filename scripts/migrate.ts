import "./load-env";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { db, closeDb } from "../src/lib/db/client";

async function main() {
  const sql = db();
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  const files = (await readdir(resolve("migrations"))).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
  for (const file of files) {
    const applied = await sql`SELECT 1 FROM schema_migrations WHERE version = ${file}`;
    if (applied.length) continue;
    if (file.startsWith("001_") && (await sql`SELECT to_regclass('public.users') AS table_name`)[0]?.table_name) {
      await sql`INSERT INTO schema_migrations (version) VALUES (${file}) ON CONFLICT DO NOTHING`;
      console.log(`Migración ${file} marcada como línea base.`);
      continue;
    }
    const contents = await readFile(resolve("migrations", file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(contents);
      await tx`INSERT INTO schema_migrations (version) VALUES (${file})`;
    });
    console.log(`Migración ${file} aplicada.`);
  }
  await closeDb();
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
