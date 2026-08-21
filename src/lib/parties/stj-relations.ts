import type postgres from "postgres";
import { normalizeCaseNumber, normalizeName } from "@/lib/domain/normalization";

export const STJ_RELATION_PARSER_VERSION = "stj-origin-relation-1";

export interface StjOriginMetadata {
  originCaseNumber?: string | null;
  originCourt?: string | null;
  judicialDistrict?: string | null;
  matter?: string | null;
}

export interface StjOriginCandidate {
  id: string;
  caseNumber: string;
  courtExternalId: string;
  courtName: string;
  matter?: string | null;
}

function normalizedOriginCaseNumber(value: string): string | null {
  const compact = value.trim().replace(/\s+/g, "");
  const match = compact.match(/^(\d{1,8})[/-](\d{2}|\d{4})$/);
  if (!match) return null;
  const year = match[2].length === 2 ? `20${match[2]}` : match[2];
  try { return normalizeCaseNumber(`${match[1]}/${year}`).normalized; } catch { return null; }
}

function courtNumber(value: string): string | null {
  const match = value.match(/\d+/);
  return match ? String(Number(match[0])) : null;
}

export function resolveStjOriginCandidate(metadata: StjOriginMetadata, candidates: StjOriginCandidate[]): StjOriginCandidate | null {
  if (!metadata.originCaseNumber || !metadata.originCourt) return null;
  const originNumber = normalizedOriginCaseNumber(metadata.originCaseNumber);
  const originCourtNumber = courtNumber(metadata.originCourt);
  if (!originNumber || !originCourtNumber) return null;
  const matter = normalizeName(metadata.matter ?? "");
  const matching = candidates.filter((candidate) => {
    const candidateCourtNumber = courtNumber(candidate.courtExternalId) ?? courtNumber(candidate.courtName);
    if (candidate.caseNumber !== originNumber || candidateCourtNumber !== originCourtNumber) return false;
    if (!matter || !candidate.matter) return true;
    const candidateMatter = normalizeName(candidate.matter);
    return candidateMatter.includes(matter) || matter.includes(candidateMatter);
  });
  return matching.length === 1 ? matching[0] : null;
}

type Queryable = postgres.Sql | postgres.TransactionSql;

export async function linkStjOriginCase(sql: Queryable, sourceCaseId: string, metadata: StjOriginMetadata): Promise<"CREATED" | "EXISTS" | "AMBIGUOUS" | "MISSING"> {
  if (!metadata.originCaseNumber || !metadata.originCourt) return "MISSING";
  const normalized = normalizedOriginCaseNumber(metadata.originCaseNumber);
  if (!normalized) return "MISSING";
  const rows = await sql`
    SELECT jc.id, jc.case_number_normalized, c.external_id, c.name, COALESCE(jc.matter, c.matter) AS matter
    FROM judicial_cases jc
    JOIN judicial_authorities ja ON ja.id = jc.authority_id AND ja.code = 'jalisco-cjj'
    JOIN courts c ON c.id = jc.court_id
    WHERE jc.case_number_normalized = ${normalized}
  `;
  const candidates: StjOriginCandidate[] = rows.map((row) => ({
    id: String(row.id), caseNumber: String(row.case_number_normalized), courtExternalId: String(row.external_id),
    courtName: String(row.name), matter: row.matter ? String(row.matter) : null,
  }));
  const target = resolveStjOriginCandidate(metadata, candidates);
  if (!target) return candidates.length ? "AMBIGUOUS" : "MISSING";
  const inserted = await sql`
    INSERT INTO case_relations (
      source_case_id, target_case_id, relation_type, confidence, extraction_method, parser_version, metadata
    ) VALUES (
      ${sourceCaseId}, ${target.id}, 'APPEAL_OF', 0.98, 'stj_structured_origin',
      ${STJ_RELATION_PARSER_VERSION}, ${sql.json({
        originCaseNumber: metadata.originCaseNumber,
        originCourt: metadata.originCourt,
        judicialDistrict: metadata.judicialDistrict,
        matter: metadata.matter,
      })}
    )
    ON CONFLICT (source_case_id, target_case_id, relation_type) DO UPDATE SET
      confidence = GREATEST(case_relations.confidence, EXCLUDED.confidence),
      metadata = EXCLUDED.metadata,
      updated_at = now()
    RETURNING (xmax = 0) AS inserted
  `;
  return inserted[0]?.inserted ? "CREATED" : "EXISTS";
}
