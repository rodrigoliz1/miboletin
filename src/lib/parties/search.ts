import "server-only";
import { db } from "@/lib/db/client";
import { normalizePartyName, partyTokenSignature, searchablePartyName } from "./normalization";
import type { PartyType } from "./types";
import { getIndexCoverage, type IndexCoverageRecord } from "./discovery";

export interface PartySearchInput {
  organizationId: string;
  query: string;
  jurisdiction?: "JALISCO" | "FEDERAL";
  provider?: string;
  court?: string;
  matter?: string;
  partyType?: PartyType;
  role?: string;
  from?: string;
  to?: string;
  resultType?: "DIRECT" | "RELATED";
  page?: number;
  pageSize?: number;
}

export interface PartySearchEvidence {
  nameRaw: string;
  role: string;
  partyType: PartyType;
  method: string;
  confidence: number;
  sourceUrl?: string;
  publicationDate?: string;
  direct: boolean;
}

export interface PartySearchResult {
  caseId: string;
  monitoredCaseId?: string;
  number: string;
  caseType: string;
  jurisdiction: "JALISCO" | "FEDERAL";
  provider: string;
  courtExternalId: string;
  courtName: string;
  matter?: string;
  matchName: string;
  matchRole: string;
  partyType: PartyType;
  score: number;
  matchKind: "EXACT" | "NORMALIZED" | "PARTIAL" | "APPROXIMATE" | "RELATED";
  relationType?: string;
  relatedFromCaseId?: string;
  publicationCount: number;
  lastPublicationDate?: string;
  plaintiff?: string;
  defendant?: string;
  evidence: PartySearchEvidence;
}

export interface PartySearchResponse {
  query: string;
  page: number;
  pageSize: number;
  total: number;
  results: PartySearchResult[];
  coverage: IndexCoverageRecord[];
  coverageComplete: boolean;
}

export interface IndexedCaseDetail {
  caseId: string;
  monitoredCaseId?: string;
  number: string;
  caseType: string;
  jurisdiction: "JALISCO" | "FEDERAL";
  provider: string;
  courtExternalId: string;
  courtName: string;
  courtType?: string;
  circuitId?: string;
  circuitName?: string;
  parties: Array<{ id: string; nameRaw: string; side: string; partyType: PartyType; confidence?: number }>;
  publications: Array<{ id: string; publicationDate: string; agreementDate?: string; officialText: string; sourceUrl: string }>;
  mentions: Array<{ id: string; nameRaw: string; side: string; method: string; confidence: number; publicationDate?: string; sourceUrl?: string }>;
  relations: Array<{ id: string; direction: "ORIGIN" | "RELATED"; relationType: string; confidence: number; caseId: string; number: string; caseType: string; courtName: string }>;
}

function isoDate(value: unknown): string | undefined {
  if (!value) return undefined;
  return (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
}

export async function searchParties(input: PartySearchInput): Promise<PartySearchResponse> {
  const normalized = normalizePartyName(input.query);
  if (normalized.length < 2) throw new Error("Escribe al menos dos caracteres");
  const searchName = searchablePartyName(input.query, input.partyType);
  const tokenSignature = partyTokenSignature(input.query, input.partyType);
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(50, Math.max(5, input.pageSize ?? 20));
  const offset = (page - 1) * pageSize;
  const rows = await db()`
    WITH candidate_ids AS MATERIALIZED (
      SELECT id FROM case_parties WHERE active AND name_normalized = ${normalized}
      UNION
      SELECT id FROM case_parties WHERE active AND search_name = ${searchName}
      UNION
      SELECT id FROM case_parties WHERE active AND token_signature = ${tokenSignature}
      UNION
      SELECT id FROM case_parties WHERE active AND name_normalized LIKE ${`${normalized}%`}
      UNION
      SELECT id FROM case_parties WHERE active AND search_name LIKE ${`${searchName}%`}
      UNION
      SELECT id FROM case_parties WHERE active AND name_normalized % ${normalized}
      UNION
      SELECT id FROM case_parties WHERE active AND search_name % ${searchName}
      UNION
      SELECT id FROM case_parties WHERE active AND token_signature % ${tokenSignature}
      UNION
      SELECT id FROM case_parties WHERE active AND name_normalized %> ${normalized}
    ), candidate_names AS MATERIALIZED (
      SELECT cp.id AS case_party_id, cp.case_id, cp.name_raw, cp.name_normalized, cp.search_name,
             cp.token_signature, cp.side, cp.party_type,
             COALESCE(cp.extraction_method, 'legacy') AS method,
             COALESCE(cp.confidence, 0.75)::float AS confidence,
             GREATEST(
               CASE WHEN cp.name_normalized = ${normalized} THEN 1.0 ELSE 0 END,
               CASE WHEN cp.token_signature = ${tokenSignature} THEN 0.97 ELSE 0 END,
               CASE WHEN cp.search_name = ${searchName} THEN 0.96 ELSE 0 END,
               CASE WHEN cp.name_normalized LIKE ${`${normalized}%`} OR cp.search_name LIKE ${`${searchName}%`} THEN 0.90 ELSE 0 END,
               similarity(cp.name_normalized, ${normalized}) * 0.86,
               similarity(cp.search_name, ${searchName}) * 0.88,
               similarity(cp.token_signature, ${tokenSignature}) * 0.90,
               word_similarity(${normalized}, cp.name_normalized) * 0.90
             ) AS score
      FROM case_parties cp
      JOIN candidate_ids candidate ON candidate.id = cp.id
      WHERE cp.active
        AND (${input.partyType ?? null}::text IS NULL OR cp.party_type = ${input.partyType ?? null})
        AND (${input.role ?? null}::text IS NULL OR cp.side = ${input.role ?? null})
    ), direct_matches AS (
      SELECT candidate.case_id AS result_case_id, candidate.case_id AS matched_case_id,
             candidate.*, NULL::text AS relation_type, true AS direct
      FROM candidate_names candidate WHERE candidate.score >= 0.55
    ), related_matches AS (
      SELECT cr.source_case_id AS result_case_id, candidate.case_id AS matched_case_id, candidate.*,
             cr.relation_type, false AS direct
      FROM candidate_names candidate
      JOIN case_relations cr ON cr.target_case_id = candidate.case_id AND cr.confidence >= 0.9
      WHERE candidate.score >= 0.65
    ), all_matches AS (
      SELECT * FROM direct_matches
      UNION ALL
      SELECT * FROM related_matches
    ), ranked AS (
      SELECT DISTINCT ON (matches.result_case_id)
             matches.*, CASE WHEN matches.direct THEN matches.score ELSE matches.score * 0.93 END AS final_score
      FROM all_matches matches
      ORDER BY matches.result_case_id, matches.direct DESC, final_score DESC, matches.confidence DESC
    ), filtered AS (
      SELECT ranked.*, jc.case_number_normalized, jc.case_type, COALESCE(jc.matter, c.matter) AS matter,
             ja.jurisdiction, ja.code AS provider, c.external_id AS court_external_id, c.name AS court_name
      FROM ranked
      JOIN judicial_cases jc ON jc.id = ranked.result_case_id
      JOIN judicial_authorities ja ON ja.id = jc.authority_id
      JOIN courts c ON c.id = jc.court_id
      WHERE (${input.jurisdiction ?? null}::text IS NULL OR ja.jurisdiction = ${input.jurisdiction ?? null})
        AND (${input.provider ?? null}::text IS NULL OR ja.code = ${input.provider ?? null})
        AND (${input.court ?? null}::text IS NULL OR c.external_id = ${input.court ?? null})
        AND (${input.matter ?? null}::text IS NULL OR upper(unaccent(COALESCE(jc.matter, c.matter, ''))) LIKE '%' || upper(unaccent(${input.matter ?? ""})) || '%')
        AND (${input.resultType ?? null}::text IS NULL OR (${input.resultType ?? null} = 'DIRECT' AND ranked.direct) OR (${input.resultType ?? null} = 'RELATED' AND NOT ranked.direct))
        AND (${input.from ?? null}::date IS NULL OR EXISTS (SELECT 1 FROM judicial_publications dated WHERE dated.case_id = jc.id AND dated.publication_date >= ${input.from ?? null}::date))
        AND (${input.to ?? null}::date IS NULL OR EXISTS (SELECT 1 FROM judicial_publications dated WHERE dated.case_id = jc.id AND dated.publication_date <= ${input.to ?? null}::date))
    )
    SELECT filtered.*, watched.id AS monitored_case_id,
           publications.publication_count, publications.last_publication_date,
           parties.plaintiff, parties.defendant, evidence.source_url, evidence.publication_date,
           COALESCE(evidence.extraction_method, filtered.method) AS evidence_method,
           COALESCE(evidence.confidence, filtered.confidence)::float AS evidence_confidence,
           count(*) OVER()::int AS total
    FROM filtered
    LEFT JOIN monitored_cases watched ON watched.case_id = filtered.result_case_id
      AND watched.organization_id = ${input.organizationId} AND watched.active AND watched.deleted_at IS NULL
    JOIN LATERAL (
      SELECT count(*)::int AS publication_count, max(jp.publication_date) AS last_publication_date
      FROM judicial_publications jp WHERE jp.case_id = filtered.result_case_id
    ) publications ON publications.publication_count > 0
    LEFT JOIN LATERAL (
      SELECT string_agg(DISTINCT cp.name_raw, ' · ' ORDER BY cp.name_raw) FILTER (WHERE cp.side IN ('plaintiff','quejoso','promovente','recurrente','apelante')) AS plaintiff,
             string_agg(DISTINCT cp.name_raw, ' · ' ORDER BY cp.name_raw) FILTER (WHERE cp.side IN ('defendant','tercero_interesado','autoridad_responsable','apelado')) AS defendant
      FROM case_parties cp WHERE cp.case_id = filtered.result_case_id AND cp.active
    ) parties ON true
    LEFT JOIN LATERAL (
      SELECT cpm.source_url, cpm.publication_date, cpm.extraction_method, cpm.confidence
      FROM case_party_mentions cpm
      WHERE cpm.case_party_id = filtered.case_party_id
      ORDER BY cpm.publication_date DESC NULLS LAST, cpm.created_at DESC
      LIMIT 1
    ) evidence ON true
    ORDER BY filtered.final_score DESC, publications.last_publication_date DESC NULLS LAST,
             filtered.case_number_normalized
    LIMIT ${pageSize} OFFSET ${offset}
  `;
  const coverage = await getIndexCoverage();
  return {
    query: input.query.trim(), page, pageSize, total: Number(rows[0]?.total ?? 0),
    results: rows.map((row): PartySearchResult => {
      const score = Number(row.final_score);
      const direct = Boolean(row.direct);
      const matchKind: PartySearchResult["matchKind"] = !direct ? "RELATED"
        : score >= 0.995 ? "EXACT" : score >= 0.94 ? "NORMALIZED" : score >= 0.8 ? "PARTIAL" : "APPROXIMATE";
      return {
        caseId: String(row.result_case_id), monitoredCaseId: row.monitored_case_id ? String(row.monitored_case_id) : undefined,
        number: String(row.case_number_normalized), caseType: String(row.case_type), jurisdiction: row.jurisdiction,
        provider: String(row.provider), courtExternalId: String(row.court_external_id), courtName: String(row.court_name),
        matter: row.matter ? String(row.matter) : undefined, matchName: String(row.name_raw), matchRole: String(row.side),
        partyType: row.party_type, score, matchKind, relationType: row.relation_type ? String(row.relation_type) : undefined,
        relatedFromCaseId: direct ? undefined : String(row.matched_case_id), publicationCount: Number(row.publication_count),
        lastPublicationDate: isoDate(row.last_publication_date), plaintiff: row.plaintiff ? String(row.plaintiff) : undefined,
        defendant: row.defendant ? String(row.defendant) : undefined,
        evidence: {
          nameRaw: String(row.name_raw), role: String(row.side), partyType: row.party_type,
          method: String(row.evidence_method), confidence: Number(row.evidence_confidence), sourceUrl: row.source_url ? String(row.source_url) : undefined,
          publicationDate: isoDate(row.publication_date), direct,
        },
      };
    }),
    coverage,
    coverageComplete: coverage.length > 0 && coverage.every((item) => item.coverageState === "COMPLETE"),
  };
}

export async function getIndexedCaseDetail(organizationId: string, caseId: string): Promise<IndexedCaseDetail | null> {
  const rows = await db()`
    SELECT jc.id, jc.case_number_normalized, jc.case_type, ja.jurisdiction, ja.code AS provider,
           c.external_id AS court_external_id, c.name AS court_name, c.court_type,
           cir.external_id AS circuit_id, cir.name AS circuit_name, watched.id AS monitored_case_id
    FROM judicial_cases jc
    JOIN judicial_authorities ja ON ja.id = jc.authority_id
    JOIN courts c ON c.id = jc.court_id
    LEFT JOIN judicial_circuits cir ON cir.id = c.circuit_id
    LEFT JOIN monitored_cases watched ON watched.case_id = jc.id AND watched.organization_id = ${organizationId}
      AND watched.active AND watched.deleted_at IS NULL
    WHERE jc.id = ${caseId}
    LIMIT 1
  `;
  if (!rows.length) return null;
  const [parties, publications, mentions, relations] = await Promise.all([
    db()`SELECT id, name_raw, side, party_type, confidence FROM case_parties WHERE case_id = ${caseId} AND active ORDER BY side, name_raw`,
    db()`SELECT id, publication_date, agreement_date, official_text, source_url FROM judicial_publications WHERE case_id = ${caseId} ORDER BY publication_date DESC, agreement_date DESC NULLS LAST LIMIT 500`,
    db()`SELECT id, name_raw, side, extraction_method, confidence, publication_date, source_url FROM case_party_mentions WHERE case_id = ${caseId} ORDER BY publication_date DESC NULLS LAST, created_at DESC LIMIT 100`,
    db()`
      SELECT cr.id, 'ORIGIN' AS direction, cr.relation_type, cr.confidence, related.id AS case_id,
             related.case_number_normalized, related.case_type, c.name AS court_name
      FROM case_relations cr JOIN judicial_cases related ON related.id = cr.target_case_id JOIN courts c ON c.id = related.court_id
      WHERE cr.source_case_id = ${caseId}
      UNION ALL
      SELECT cr.id, 'RELATED' AS direction, cr.relation_type, cr.confidence, related.id AS case_id,
             related.case_number_normalized, related.case_type, c.name AS court_name
      FROM case_relations cr JOIN judicial_cases related ON related.id = cr.source_case_id JOIN courts c ON c.id = related.court_id
      WHERE cr.target_case_id = ${caseId}
      ORDER BY confidence DESC
    `,
  ]);
  const row = rows[0];
  return {
    caseId: String(row.id), monitoredCaseId: row.monitored_case_id ? String(row.monitored_case_id) : undefined,
    number: String(row.case_number_normalized), caseType: String(row.case_type), jurisdiction: row.jurisdiction,
    provider: String(row.provider), courtExternalId: String(row.court_external_id), courtName: String(row.court_name),
    courtType: row.court_type ? String(row.court_type) : undefined, circuitId: row.circuit_id ? String(row.circuit_id) : undefined,
    circuitName: row.circuit_name ? String(row.circuit_name) : undefined,
    parties: parties.map((party) => ({ id: String(party.id), nameRaw: String(party.name_raw), side: String(party.side), partyType: party.party_type, confidence: party.confidence === null ? undefined : Number(party.confidence) })),
    publications: publications.map((publication) => ({ id: String(publication.id), publicationDate: isoDate(publication.publication_date)!, agreementDate: isoDate(publication.agreement_date), officialText: String(publication.official_text), sourceUrl: String(publication.source_url) })),
    mentions: mentions.map((mention) => ({ id: String(mention.id), nameRaw: String(mention.name_raw), side: String(mention.side), method: String(mention.extraction_method), confidence: Number(mention.confidence), publicationDate: isoDate(mention.publication_date), sourceUrl: mention.source_url ? String(mention.source_url) : undefined })),
    relations: relations.map((relation) => ({ id: String(relation.id), direction: relation.direction, relationType: String(relation.relation_type), confidence: Number(relation.confidence), caseId: String(relation.case_id), number: String(relation.case_number_normalized), caseType: String(relation.case_type), courtName: String(relation.court_name) })),
  };
}
