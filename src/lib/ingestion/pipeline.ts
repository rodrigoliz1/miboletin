import { nanoid } from "nanoid";
import pino from "pino";
import type { JudicialSourceProvider, NormalizedPublication, PublicationQuery } from "@/lib/domain/types";
import { persistPublications, recordIngestionRun } from "@/lib/ingestion/store";
import { extractParties } from "@/lib/parties/extractor";

const logger = pino({ name: "mi-boletin-ingestion", level: process.env.LOG_LEVEL ?? "info" });

export interface IngestionResult {
  jobId: string;
  provider: string;
  startedAt: string;
  completedAt: string;
  duration: number;
  recordsFetched: number;
  recordsInserted: number;
  recordsUpdated: number;
  duplicates: number;
  matches: number;
  notifications: number;
  partiesFound: number;
  mentionsCreated: number;
  dryRun: boolean;
  normalized: NormalizedPublication[];
  errors: string[];
}

const observedHashes = new Set<string>();

export async function runIngestion(provider: JudicialSourceProvider, query: PublicationQuery, dryRun = false): Promise<IngestionResult> {
  const jobId = `${provider.id}-${nanoid(10)}`;
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const errors: string[] = [];
  const normalized: NormalizedPublication[] = [];
  let duplicates = 0;

  try {
    const raw = query.caseNumber && query.courtExternalId && provider.fetchCase && (query.sourceMode === undefined || query.sourceMode === "AGREEMENT")
      ? await provider.fetchCase(query.caseNumber, query.courtExternalId, query.caseType, query.circuitId)
      : await provider.fetchByDate(query);
    for (const record of raw) {
      try {
        provider.validate(record);
        const item = await provider.normalize(record);
        if (observedHashes.has(item.contentHash)) duplicates += 1;
        else {
          normalized.push(item);
          if (!dryRun) observedHashes.add(item.contentHash);
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Registro inválido");
      }
    }
    if (raw.length > 0 && normalized.length === 0 && duplicates === 0) errors.push("PARSER_DEGRADED: la fuente respondió, pero ningún registro superó la validación");
    let recordsInserted = 0;
    let matches = 0;
    let notifications = 0;
    let partiesFound = 0;
    let mentionsCreated = 0;
    if (dryRun) {
      partiesFound = normalized.reduce((sum, item) => {
        const container = item.rawPayload && typeof item.rawPayload === "object" ? item.rawPayload as Record<string, unknown> : {};
        const rawText = typeof container.rawHtml === "string" ? container.rawHtml : null;
        const rawPayload = Object.fromEntries(Object.entries(container).filter(([key]) => key !== "rawHtml"));
        return sum + extractParties({ provider: provider.id, parties: item.parties, rawPayload, rawText, officialText: item.officialText }).length;
      }, 0);
    }
    if (!dryRun && normalized.length) {
      if (!process.env.DATABASE_URL) {
        errors.push("STORE_DISABLED: DATABASE_URL no está configurada; no se afirmó ninguna inserción");
      } else {
        try {
          const persistence = await persistPublications(provider.id, normalized);
          recordsInserted = persistence.inserted;
          duplicates += persistence.duplicates;
          matches = persistence.matches;
          notifications = persistence.notifications;
          partiesFound = persistence.partiesFound;
          mentionsCreated = persistence.mentionsCreated;
        } catch (error) {
          errors.push(`STORE_FAILED: ${error instanceof Error ? error.message : "error desconocido"}`);
        }
      }
    }
    const result: IngestionResult = {
      jobId,
      provider: provider.id,
      startedAt,
      completedAt: new Date().toISOString(),
      duration: Date.now() - started,
      recordsFetched: raw.length,
      recordsInserted,
      recordsUpdated: 0,
      duplicates,
      matches,
      notifications,
      partiesFound,
      mentionsCreated,
      dryRun,
      normalized,
      errors,
    };
    if (!dryRun && process.env.DATABASE_URL) {
      try { await recordIngestionRun({ ...result, lastSnapshotHash: normalized.at(-1)?.snapshotHash }); } catch (error) { logger.error({ error }, "ingestion_run_audit_failed"); }
    }
    logger.info({ ...result, normalized: undefined }, "ingestion_completed");
    return result;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Falla desconocida");
    const result: IngestionResult = {
      jobId,
      provider: provider.id,
      startedAt,
      completedAt: new Date().toISOString(),
      duration: Date.now() - started,
      recordsFetched: 0,
      recordsInserted: 0,
      recordsUpdated: 0,
      duplicates: 0,
      matches: 0,
      notifications: 0,
      partiesFound: 0,
      mentionsCreated: 0,
      dryRun,
      normalized,
      errors,
    };
    if (!dryRun && process.env.DATABASE_URL) {
      try { await recordIngestionRun(result); } catch (auditError) { logger.error({ error: auditError }, "ingestion_run_failure_audit_failed"); }
    }
    logger.error({ ...result }, "ingestion_failed");
    return result;
  }
}
