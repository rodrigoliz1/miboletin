import type postgres from "postgres";
import { findCanonicalParty, type ExistingPartyIdentity } from "./canonicalization";
import { normalizePartyName, partyTokenSignature, searchablePartyName } from "./normalization";
import type { PartyCandidate } from "./types";

export interface PartyPersistenceContext {
  caseId: string;
  publicationId?: string | null;
  snapshotId?: string | null;
  provider: string;
  sourceUrl?: string | null;
  publicationDate?: string | null;
  parserVersion: string;
}

export interface PartyPersistenceMetrics {
  partiesFound: number;
  partiesCreated: number;
  mentionsCreated: number;
  watchMatchesCreated: number;
  ambiguous: number;
}

type Queryable = postgres.Sql | postgres.TransactionSql;

function fragment(candidate: PartyCandidate): string | null {
  const value = candidate.sourceFragment?.replace(/\s+/g, " ").trim();
  return value ? value.slice(0, 1000) : null;
}

export async function persistPartyCandidates(
  sql: Queryable,
  context: PartyPersistenceContext,
  candidates: PartyCandidate[],
): Promise<PartyPersistenceMetrics> {
  const metrics: PartyPersistenceMetrics = { partiesFound: 0, partiesCreated: 0, mentionsCreated: 0, watchMatchesCreated: 0, ambiguous: 0 };
  if (!candidates.length) return metrics;
  const existingRows = await sql`
    SELECT id, name_raw, name_normalized, side, party_type
    FROM case_parties WHERE case_id = ${context.caseId} AND active
  `;
  const existing: ExistingPartyIdentity[] = existingRows.map((row) => ({
    id: String(row.id), nameRaw: String(row.name_raw), nameNormalized: String(row.name_normalized),
    side: String(row.side), partyType: String(row.party_type ?? "UNKNOWN"),
  }));

  for (const candidate of candidates) {
    const nameRaw = String(candidate.nameRaw ?? "").replace(/\s+/g, " ").trim();
    if (!nameRaw) continue;
    const partyType = candidate.partyType ?? "UNKNOWN";
    const nameNormalized = String(candidate.nameNormalized ?? "").trim() || normalizePartyName(nameRaw);
    const canonicalName = String(candidate.canonicalName ?? "").trim() || nameRaw;
    const searchName = String(candidate.searchName ?? "").trim() || searchablePartyName(nameRaw, partyType);
    const tokenSignature = String(candidate.tokenSignature ?? "").trim() || partyTokenSignature(nameRaw, partyType);
    if (!nameNormalized || !canonicalName || !searchName) continue;
    const safeCandidate: PartyCandidate = {
      ...candidate,
      nameRaw,
      nameNormalized,
      canonicalName,
      searchName,
      tokenSignature,
      partyType,
    };
    metrics.partiesFound += 1;
    if (safeCandidate.confidence < 0.7) metrics.ambiguous += 1;
    let identity = findCanonicalParty(safeCandidate, existing);
    if (!identity) {
      const inserted = await sql`
        INSERT INTO case_parties (
          case_id, name_raw, name_normalized, name_canonical, search_name, token_signature, side, party_type,
          confidence, extraction_method, parser_version, metadata, updated_at
        ) VALUES (
          ${context.caseId}, ${safeCandidate.nameRaw}, ${safeCandidate.nameNormalized}, ${safeCandidate.canonicalName},
          ${safeCandidate.searchName}, ${safeCandidate.tokenSignature}, ${safeCandidate.side}, ${safeCandidate.partyType}, ${safeCandidate.confidence},
          ${safeCandidate.extractionMethod}, ${context.parserVersion}, ${sql.json(safeCandidate.metadata as never)}, now()
        )
        ON CONFLICT (case_id, name_normalized, side) DO UPDATE SET
          confidence = GREATEST(COALESCE(case_parties.confidence, 0), EXCLUDED.confidence),
          search_name = EXCLUDED.search_name,
          token_signature = EXCLUDED.token_signature,
          party_type = CASE WHEN case_parties.party_type = 'UNKNOWN' THEN EXCLUDED.party_type ELSE case_parties.party_type END,
          updated_at = now()
        RETURNING id, name_raw, name_normalized, side, party_type, (xmax = 0) AS inserted
      `;
      const row = inserted[0];
      identity = {
        id: String(row.id), nameRaw: String(row.name_raw), nameNormalized: String(row.name_normalized),
        side: String(row.side), partyType: String(row.party_type),
      };
      existing.push(identity);
      if (row.inserted) metrics.partiesCreated += 1;
    }

    const mentions = await sql`
      INSERT INTO case_party_mentions (
        case_party_id, case_id, publication_id, snapshot_id, provider, name_raw, name_normalized,
        search_name, token_signature, role_raw, side, party_type, extraction_method, confidence, source_fragment,
        source_url, publication_date, parser_version, metadata
      ) VALUES (
        ${identity.id}, ${context.caseId}, ${context.publicationId ?? null}, ${context.snapshotId ?? null},
        ${context.provider}, ${safeCandidate.nameRaw}, ${safeCandidate.nameNormalized}, ${safeCandidate.searchName}, ${safeCandidate.tokenSignature},
        ${safeCandidate.roleRaw ?? null}, ${safeCandidate.side}, ${safeCandidate.partyType}, ${safeCandidate.extractionMethod},
        ${safeCandidate.confidence}, ${fragment(safeCandidate)}, ${context.sourceUrl ?? null},
        ${context.publicationDate ?? null}, ${context.parserVersion}, ${sql.json(safeCandidate.metadata as never)}
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (!mentions.length) continue;
    metrics.mentionsCreated += 1;
    metrics.watchMatchesCreated += await createWatchMatches(sql, identity.id, context, safeCandidate);
  }
  return metrics;
}

async function createWatchMatches(sql: Queryable, casePartyId: string, context: PartyPersistenceContext, candidate: PartyCandidate): Promise<number> {
  const rules = await sql`
    SELECT id, user_id, organization_id, value_normalized, match_mode,
      CASE
        WHEN value_normalized IN (${candidate.nameNormalized}, ${candidate.searchName}) THEN 'EXACT'::match_result
        ELSE 'PROBABLE'::match_result
      END AS match_result,
      CASE
        WHEN value_normalized IN (${candidate.nameNormalized}, ${candidate.searchName}) THEN 1.0
        ELSE GREATEST(similarity(value_normalized, ${candidate.nameNormalized}), similarity(value_normalized, ${candidate.searchName}))
      END AS score
    FROM watch_rules
    WHERE active AND kind IN ('PERSON', 'COMPANY')
      AND (
        value_normalized IN (${candidate.nameNormalized}, ${candidate.searchName})
        OR (
          match_mode = 'FLEXIBLE'
          AND GREATEST(similarity(value_normalized, ${candidate.nameNormalized}), similarity(value_normalized, ${candidate.searchName})) >= 0.82
        )
      )
  `;
  let created = 0;
  for (const rule of rules) {
    const matches = await sql`
      INSERT INTO watch_rule_matches (
        watch_rule_id, case_party_id, case_id, publication_id, match_result, score
      ) VALUES (
        ${rule.id}, ${casePartyId}, ${context.caseId}, ${context.publicationId ?? null},
        ${rule.match_result}, ${rule.score}
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (!matches.length) continue;
    created += 1;
    await sql`
      INSERT INTO notifications (user_id, movement_id, watch_rule_match_id, channel, subject, payload)
      SELECT recipients.user_id, NULL, ${matches[0].id}, 'IN_APP',
             'Coincidencia en vigilancia por nombre',
             jsonb_build_object(
               'caseId', ${context.caseId}::uuid,
               'publicationId', ${context.publicationId ?? null}::uuid,
               'partyName', ${candidate.nameRaw}::text,
               'matchResult', ${rule.match_result}::text,
               'score', ${rule.score}::numeric
             )
      FROM (
        SELECT ${rule.user_id}::uuid AS user_id WHERE ${rule.user_id}::uuid IS NOT NULL
        UNION
        SELECT m.user_id FROM memberships m
        WHERE m.organization_id = ${rule.organization_id}::uuid AND ${rule.organization_id}::uuid IS NOT NULL
      ) recipients
      ON CONFLICT DO NOTHING
    `;
  }
  return created;
}

export async function matchKnownPartiesToWatchRules(sql: Queryable, context: PartyPersistenceContext): Promise<number> {
  const notifications = await sql`
    WITH candidates AS (
      SELECT wr.id AS watch_rule_id, cp.id AS case_party_id, cp.name_raw,
             CASE WHEN wr.value_normalized IN (cp.name_normalized, cp.search_name) THEN 'EXACT'::match_result ELSE 'PROBABLE'::match_result END AS match_result,
             CASE WHEN wr.value_normalized IN (cp.name_normalized, cp.search_name) THEN 1.0 ELSE GREATEST(similarity(wr.value_normalized, cp.name_normalized), similarity(wr.value_normalized, cp.search_name)) END AS score
      FROM case_parties cp
      JOIN watch_rules wr ON wr.active AND wr.kind = cp.party_type
        AND (
          wr.value_normalized IN (cp.name_normalized, cp.search_name)
          OR (wr.match_mode = 'FLEXIBLE' AND GREATEST(similarity(wr.value_normalized, cp.name_normalized), similarity(wr.value_normalized, cp.search_name)) >= 0.82)
        )
      WHERE cp.case_id = ${context.caseId} AND cp.active
    ), inserted AS (
      INSERT INTO watch_rule_matches (watch_rule_id, case_party_id, case_id, publication_id, match_result, score)
      SELECT watch_rule_id, case_party_id, ${context.caseId}, ${context.publicationId ?? null}, match_result, score
      FROM candidates
      ON CONFLICT DO NOTHING
      RETURNING id, watch_rule_id, case_party_id, match_result, score
    )
    INSERT INTO notifications (user_id, movement_id, watch_rule_match_id, channel, subject, payload)
    SELECT recipients.user_id, NULL, inserted.id, 'IN_APP', 'Coincidencia en vigilancia por nombre',
           jsonb_build_object(
             'caseId', ${context.caseId}::uuid,
             'publicationId', ${context.publicationId ?? null}::uuid,
             'partyName', cp.name_raw,
             'matchResult', inserted.match_result::text,
             'score', inserted.score
           )
    FROM inserted
    JOIN watch_rules wr ON wr.id = inserted.watch_rule_id
    JOIN case_parties cp ON cp.id = inserted.case_party_id
    JOIN LATERAL (
      SELECT wr.user_id AS user_id WHERE wr.user_id IS NOT NULL
      UNION
      SELECT m.user_id FROM memberships m WHERE m.organization_id = wr.organization_id AND wr.organization_id IS NOT NULL
    ) recipients ON true
    ON CONFLICT DO NOTHING
    RETURNING id
  `;
  return notifications.length;
}
