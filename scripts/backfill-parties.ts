import "./load-env";
import { nanoid } from "nanoid";
import { closeDb, db } from "../src/lib/db/client";
import { extractParties } from "../src/lib/parties/extractor";
import { PARTY_PARSER_VERSION } from "../src/lib/parties/parser";
import { persistPartyCandidates } from "../src/lib/parties/repository";
import { linkStjOriginCase } from "../src/lib/parties/stj-relations";
import { recomputePartyDiscoveryStatuses } from "../src/lib/parties/discovery";

type Provider = "jalisco-cjj" | "federal-pjf-session-lists" | "jalisco-stj-chambers";

interface Options {
  provider?: Provider;
  dryRun: boolean;
  batchSize: number;
  caseId?: string;
  from?: string;
  to?: string;
  resume?: string;
  reprocess: boolean;
}

interface Metrics {
  snapshotsProcessed: number;
  partiesFound: number;
  partiesCreated: number;
  mentionsCreated: number;
  relationsCreated: number;
  ambiguous: number;
  errors: number;
}

const PROVIDERS = new Set<Provider>(["jalisco-cjj", "federal-pjf-session-lists", "jalisco-stj-chambers"]);
let activeJobId: string | null = null;

function optionValue(name: string): string | undefined {
  const exact = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  if (exact) return exact.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function options(): Options {
  const providerValue = optionValue("provider");
  if (providerValue && !PROVIDERS.has(providerValue as Provider)) throw new Error(`Provider no soportado: ${providerValue}`);
  const batchSize = Number(optionValue("batch") ?? 100);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error("--batch debe estar entre 1 y 1000");
  return {
    provider: providerValue as Provider | undefined,
    dryRun: !process.argv.includes("--apply"),
    batchSize,
    caseId: optionValue("case-id"),
    from: optionValue("from"),
    to: optionValue("to"),
    resume: optionValue("resume"),
    reprocess: process.argv.includes("--reprocess"),
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function main() {
  const input = options();
  const sql = db();
  const jobId = input.resume ?? `party-backfill-${new Date().toISOString().replace(/[:.]/g, "-")}-${nanoid(6)}`;
  activeJobId = jobId;
  let cursor: string | null = null;
  if (input.resume) {
    const previous = await sql`SELECT cursor_publication_id FROM party_extraction_runs WHERE job_id = ${input.resume}`;
    if (!previous.length) throw new Error(`No existe la ejecución ${input.resume}`);
    cursor = previous[0].cursor_publication_id ? String(previous[0].cursor_publication_id) : null;
  } else {
    await sql`
      INSERT INTO party_extraction_runs (job_id, provider, parser_version, status, dry_run, details)
      VALUES (${jobId}, ${input.provider ?? null}, ${PARTY_PARSER_VERSION}, 'RUNNING', ${input.dryRun}, ${sql.json({
        batchSize: input.batchSize, caseId: input.caseId, from: input.from, to: input.to, reprocess: input.reprocess,
      })})
    `;
  }
  const metrics: Metrics = { snapshotsProcessed: 0, partiesFound: 0, partiesCreated: 0, mentionsCreated: 0, relationsCreated: 0, ambiguous: 0, errors: 0 };
  const federalHistoryCandidates = new Map<string, ReturnType<typeof extractParties>>();
  const snapshotHtml = new Map<string, string | null>();
  const touchedCases = new Map<string, string>();
  let finished = false;

  while (!finished) {
    const rows = await sql`
      SELECT jp.id AS publication_id, jp.case_id, jp.snapshot_id, jp.official_text, jp.source_url,
             jp.publication_date, ss.provider, ss.raw_payload, ss.parser_version,
             (ss.raw_text IS NOT NULL) AS has_raw_text
      FROM judicial_publications jp
      JOIN source_snapshots ss ON ss.id = jp.snapshot_id
      WHERE (${input.provider ?? null}::text IS NULL OR ss.provider = ${input.provider ?? null})
        AND (${input.caseId ?? null}::uuid IS NULL OR jp.case_id = ${input.caseId ?? null}::uuid)
        AND (${input.from ?? null}::date IS NULL OR jp.publication_date >= ${input.from ?? null}::date)
        AND (${input.to ?? null}::date IS NULL OR jp.publication_date <= ${input.to ?? null}::date)
        AND (${cursor}::uuid IS NULL OR jp.id > ${cursor}::uuid)
        AND (
          ${input.reprocess}
          OR NOT EXISTS (
            SELECT 1 FROM party_extraction_records per
            WHERE per.publication_id = jp.id AND per.parser_version = ss.parser_version || '|' || ${PARTY_PARSER_VERSION}
          )
          OR ss.provider = 'jalisco-stj-chambers'
        )
      ORDER BY jp.id
      LIMIT ${input.batchSize}
    `;
    if (!rows.length) break;
    for (const row of rows) {
      cursor = String(row.publication_id);
      metrics.snapshotsProcessed += 1;
      try {
        touchedCases.set(String(row.case_id), String(row.provider));
        const rawPayload = recordValue(row.raw_payload) ?? {};
        const snapshotKey = String(row.snapshot_id);
        let rawText: string | null = null;
        if (row.has_raw_text) {
          if (!snapshotHtml.has(snapshotKey)) {
            const [snapshot] = await sql`SELECT raw_text FROM source_snapshots WHERE id = ${row.snapshot_id}`;
            snapshotHtml.set(snapshotKey, snapshot?.raw_text ? String(snapshot.raw_text) : null);
          }
          rawText = snapshotHtml.get(snapshotKey) ?? null;
        }
        let candidates: ReturnType<typeof extractParties>;
        if (String(row.provider) === "federal-pjf-session-lists" && rawText) {
          let historyCandidates = federalHistoryCandidates.get(snapshotKey);
          if (!historyCandidates) {
            historyCandidates = extractParties({ provider: String(row.provider), rawPayload, rawText, officialText: "" });
            federalHistoryCandidates.set(snapshotKey, historyCandidates);
          }
          candidates = historyCandidates.length
            ? historyCandidates
            : extractParties({ provider: String(row.provider), rawPayload, rawText: null, officialText: String(row.official_text) });
        } else {
          candidates = extractParties({ provider: String(row.provider), rawPayload, rawText, officialText: String(row.official_text) });
        }
        metrics.partiesFound += candidates.length;
        metrics.ambiguous += candidates.filter((candidate) => candidate.confidence < 0.7).length;
        if (!input.dryRun && candidates.length) {
          const persisted = await persistPartyCandidates(sql, {
            caseId: String(row.case_id), publicationId: String(row.publication_id), snapshotId: String(row.snapshot_id),
            provider: String(row.provider), sourceUrl: String(row.source_url), publicationDate: String(row.publication_date).slice(0, 10),
            parserVersion: `${row.parser_version}|${PARTY_PARSER_VERSION}`,
          }, candidates);
          metrics.partiesCreated += persisted.partiesCreated;
          metrics.mentionsCreated += persisted.mentionsCreated;
        }
        if (!input.dryRun) {
          await sql`
            INSERT INTO party_extraction_records (publication_id, parser_version, provider, status, candidates_found)
            VALUES (${row.publication_id}, ${`${row.parser_version}|${PARTY_PARSER_VERSION}`}, ${row.provider}, ${candidates.length ? "EXTRACTED" : "NO_CANDIDATES"}, ${candidates.length})
            ON CONFLICT (publication_id, parser_version) DO UPDATE SET
              status = EXCLUDED.status, candidates_found = EXCLUDED.candidates_found, processed_at = now()
          `;
        }
        if (String(row.provider) === "jalisco-stj-chambers") {
          const metadata = recordValue(rawPayload.metadata) ?? {};
          if (!input.dryRun) {
            const relation = await linkStjOriginCase(sql, String(row.case_id), {
              originCaseNumber: typeof metadata.originCaseNumber === "string" ? metadata.originCaseNumber : null,
              originCourt: typeof metadata.originCourt === "string" ? metadata.originCourt : null,
              judicialDistrict: typeof metadata.judicialDistrict === "string" ? metadata.judicialDistrict : null,
              matter: typeof metadata.matter === "string" ? metadata.matter : null,
            });
            if (relation === "CREATED") metrics.relationsCreated += 1;
            if (relation === "AMBIGUOUS") metrics.ambiguous += 1;
          }
        }
      } catch (error) {
        metrics.errors += 1;
        if (!input.dryRun) {
          await sql`
            INSERT INTO party_extraction_records (publication_id, parser_version, provider, status, candidates_found, details)
            VALUES (${row.publication_id}, ${`${row.parser_version}|${PARTY_PARSER_VERSION}`}, ${row.provider}, 'FAILED', 0, ${sql.json({ error: error instanceof Error ? error.message.slice(0, 300) : "unknown" })})
            ON CONFLICT (publication_id, parser_version) DO UPDATE SET status = 'FAILED', details = EXCLUDED.details, processed_at = now()
          `;
        }
        console.error("party_backfill_record_failed", { publicationId: row.publication_id, provider: row.provider, error: error instanceof Error ? error.message : "unknown" });
      }
    }
    await sql`
      UPDATE party_extraction_runs SET
        cursor_publication_id = ${cursor}, snapshots_processed = ${metrics.snapshotsProcessed},
        parties_found = ${metrics.partiesFound}, parties_created = ${metrics.partiesCreated},
        mentions_created = ${metrics.mentionsCreated}, relations_created = ${metrics.relationsCreated},
        ambiguous = ${metrics.ambiguous}, errors = ${metrics.errors},
        status = ${metrics.errors ? "PARTIAL" : "RUNNING"}
      WHERE job_id = ${jobId}
    `;
    finished = rows.length < input.batchSize;
  }
  if (!input.dryRun) {
    await sql`
      UPDATE case_parties legacy
      SET active = false,
          metadata = legacy.metadata || jsonb_build_object('retiredByParser', ${PARTY_PARSER_VERSION}::text, 'retiredAt', now()),
          updated_at = now()
      WHERE legacy.active
        AND legacy.extraction_method = 'legacy'
        AND legacy.name_raw LIKE '%,%'
        AND (
          SELECT count(*) FROM case_parties parsed
          WHERE parsed.case_id = legacy.case_id AND parsed.side = legacy.side
            AND parsed.active AND parsed.extraction_method <> 'legacy'
        ) >= 2
    `;
    const casesByProvider = new Map<string, string[]>();
    for (const [caseId, provider] of touchedCases) {
      casesByProvider.set(provider, [...(casesByProvider.get(provider) ?? []), caseId]);
    }
    for (const [provider, caseIds] of casesByProvider) {
      await recomputePartyDiscoveryStatuses(sql, caseIds, provider, PARTY_PARSER_VERSION);
    }
  }
  await sql`
    UPDATE party_extraction_runs SET status = ${metrics.errors ? "PARTIAL" : "SUCCEEDED"}, completed_at = now(),
      cursor_publication_id = ${cursor}, snapshots_processed = ${metrics.snapshotsProcessed}, parties_found = ${metrics.partiesFound},
      parties_created = ${metrics.partiesCreated}, mentions_created = ${metrics.mentionsCreated}, relations_created = ${metrics.relationsCreated},
      ambiguous = ${metrics.ambiguous}, errors = ${metrics.errors}
    WHERE job_id = ${jobId}
  `;
  console.log(JSON.stringify({ jobId, dryRun: input.dryRun, provider: input.provider ?? "all", cursor, ...metrics }, null, 2));
  await closeDb();
}

void main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  if (activeJobId && process.env.DATABASE_URL) {
    try {
      await db()`UPDATE party_extraction_runs SET status = 'FAILED', completed_at = now(), errors = errors + 1 WHERE job_id = ${activeJobId} AND status = 'RUNNING'`;
    } catch { /* La falla original se conserva como salida del proceso. */ }
  }
  await closeDb();
  process.exitCode = 1;
});
