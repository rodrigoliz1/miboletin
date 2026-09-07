import type { NormalizedPublication } from "@/lib/domain/types";
import { normalizeName } from "@/lib/domain/normalization";
import { db } from "@/lib/db/client";
import { extractParties } from "@/lib/parties/extractor";
import { PARTY_PARSER_VERSION } from "@/lib/parties/parser";
import { matchKnownPartiesToWatchRules, persistPartyCandidates } from "@/lib/parties/repository";
import { linkStjOriginCase } from "@/lib/parties/stj-relations";
import { recomputePartyDiscoveryStatuses } from "@/lib/parties/discovery";

export interface PersistenceMetrics {
  inserted: number;
  duplicates: number;
  matches: number;
  notifications: number;
  partiesFound: number;
  partiesCreated: number;
  mentionsCreated: number;
  relationsCreated: number;
  ambiguousParties: number;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function bulkFederalHistoryEligible(provider: string, items: NormalizedPublication[]): boolean {
  if (provider !== "federal-pjf-session-lists" || items.length < 20) return false;
  const first = items[0];
  return items.every((item) =>
    item.courtExternalId === first.courtExternalId
    && item.canonicalCaseKey === first.canonicalCaseKey
    && item.snapshotHash === first.snapshotHash,
  );
}

/** Fast path for the very large HTML history returned by a single SISE case. */
async function persistFederalCaseHistory(items: NormalizedPublication[]): Promise<PersistenceMetrics> {
  const sql = db();
  return sql.begin(async (tx) => {
    const first = items[0];
    const metrics: PersistenceMetrics = {
      inserted: 0, duplicates: 0, matches: 0, notifications: 0,
      partiesFound: 0, partiesCreated: 0, mentionsCreated: 0, relationsCreated: 0, ambiguousParties: 0,
    };
    const parserVersion = `${first.parserVersion}|${PARTY_PARSER_VERSION}`;
    const rawContainer = first.rawPayload && typeof first.rawPayload === "object" ? first.rawPayload as Record<string, unknown> : {};
    const rawText = typeof rawContainer.rawHtml === "string" ? rawContainer.rawHtml : null;
    const rawPayload = Object.fromEntries(Object.entries(rawContainer).filter(([key]) => key !== "rawHtml"));
    let [authority] = await tx`SELECT id FROM judicial_authorities WHERE code = 'federal-pjf-session-lists' LIMIT 1`;
    if (!authority) {
      [authority] = await tx`
        INSERT INTO judicial_authorities (code, name, jurisdiction, source_url)
        VALUES ('federal-pjf-session-lists', 'Poder Judicial de la Federación', 'FEDERAL', ${first.sourceUrl})
        ON CONFLICT (code) DO NOTHING RETURNING id
      `;
      if (!authority) [authority] = await tx`SELECT id FROM judicial_authorities WHERE code = 'federal-pjf-session-lists' LIMIT 1`;
    }
    let [court] = await tx`SELECT id FROM courts WHERE authority_id = ${authority.id} AND external_id = ${first.courtExternalId} LIMIT 1`;
    if (!court) {
      [court] = await tx`
        INSERT INTO courts (authority_id, external_id, name, normalized_name, matter, last_seen_at)
        VALUES (${authority.id}, ${first.courtExternalId}, ${first.courtName ?? `Órgano ${first.courtExternalId}`},
                ${normalizeName(first.courtName ?? `Órgano ${first.courtExternalId}`)}, ${first.caseType ?? null}, now())
        ON CONFLICT (authority_id, external_id) DO NOTHING RETURNING id
      `;
      if (!court) [court] = await tx`SELECT id FROM courts WHERE authority_id = ${authority.id} AND external_id = ${first.courtExternalId} LIMIT 1`;
    }
    let [judicialCase] = await tx`SELECT id FROM judicial_cases WHERE canonical_key = ${first.canonicalCaseKey} LIMIT 1`;
    if (!judicialCase) {
      [judicialCase] = await tx`
        INSERT INTO judicial_cases (
          authority_id, court_id, case_type, case_number_raw, case_number_normalized,
          number, year, canonical_key, matter
        ) VALUES (
          ${authority.id}, ${court.id}, ${first.caseType || "NO_ESPECIFICADO"}, ${first.caseNumberRaw},
          ${first.caseNumberNormalized}, ${first.number}, ${first.year}, ${first.canonicalCaseKey}, ${first.caseType ?? null}
        )
        ON CONFLICT (canonical_key) DO NOTHING RETURNING id
      `;
      if (!judicialCase) [judicialCase] = await tx`SELECT id FROM judicial_cases WHERE canonical_key = ${first.canonicalCaseKey} LIMIT 1`;
    }
    const [snapshot] = await tx`
      INSERT INTO source_snapshots (
        provider, external_id, court_external_id, publication_date, source_url, raw_payload, raw_text,
        retrieved_at, sha256, parser_version, provider_version, response_headers, content_type, request_method, http_status
      ) VALUES (
        'federal-pjf-session-lists', ${`${first.courtExternalId}:${first.caseNumberNormalized}:history`}, ${first.courtExternalId},
        ${first.publicationDate}, ${first.sourceUrl}, ${tx.json(rawPayload as never)}, ${rawText}, ${first.retrievedAt},
        ${first.snapshotHash}, ${first.parserVersion}, ${first.providerVersion}, ${tx.json({})}, 'text/html', 'GET', 200
      )
      ON CONFLICT (sha256) DO UPDATE SET retrieved_at = GREATEST(source_snapshots.retrieved_at, EXCLUDED.retrieved_at)
      RETURNING id
    `;
    const [previousEnrichment] = await tx`
      SELECT 1
      FROM party_extraction_records per
      JOIN judicial_publications jp ON jp.id = per.publication_id
      WHERE jp.case_id = ${judicialCase.id} AND per.parser_version = ${parserVersion}
      LIMIT 1
    `;
    const publicationRows = items.map((item) => {
      const container = item.rawPayload && typeof item.rawPayload === "object" ? item.rawPayload as Record<string, unknown> : {};
      const federalRecord = container.record && typeof container.record === "object" ? container.record as Record<string, unknown> : null;
      const agreement = container.agreement && typeof container.agreement === "object" ? container.agreement as Record<string, unknown> : null;
      const publicationKind = federalRecord?.filter === "lista" ? "SESSION_LISTED" : federalRecord?.filter === "sesion" ? "SESSION_RESULT" : "AGREEMENT";
      return {
        case_id: judicialCase.id, court_id: court.id, snapshot_id: snapshot.id,
        external_id: item.externalId ?? null, case_number_raw: item.caseNumberRaw,
        case_number_normalized: item.caseNumberNormalized, case_type: item.caseType ?? null,
        official_text: item.officialText, publication_date: item.publicationDate,
        agreement_date: item.agreementDate ?? null, promotion_date: item.promotionDate ?? null,
        publication_kind: publicationKind, notebook: textValue(agreement?.notebook),
        retrieved_at: item.retrievedAt, content_hash: item.contentHash, source_url: item.sourceUrl,
      };
    });
    const publications = await tx`
      INSERT INTO judicial_publications ${tx(publicationRows,
        "case_id", "court_id", "snapshot_id", "external_id", "case_number_raw", "case_number_normalized",
        "case_type", "official_text", "publication_date", "agreement_date", "promotion_date", "publication_kind",
        "notebook", "retrieved_at", "content_hash", "source_url")}
      ON CONFLICT (court_id, content_hash) DO UPDATE SET snapshot_id = judicial_publications.snapshot_id
      RETURNING id, content_hash, (xmax = 0) AS inserted
    `;
    metrics.inserted = publications.filter((row) => row.inserted).length;
    metrics.duplicates = publications.length - metrics.inserted;
    const publicationByHash = new Map(publications.map((row) => [String(row.content_hash), String(row.id)]));

    const sessionRows = items.flatMap((item) => {
      const container = item.rawPayload && typeof item.rawPayload === "object" ? item.rawPayload as Record<string, unknown> : {};
      const record = container.record && typeof container.record === "object" ? container.record as Record<string, unknown> : null;
      const publicationId = publicationByHash.get(item.contentHash);
      return record && publicationId ? [{ publicationId, record }] : [];
    });
    if (sessionRows.length) {
      await tx`
        INSERT INTO federal_session_details (
          publication_id, neun, row_external_id, filter_kind, session_type, list_date, session_date,
          result, rapporteur, project_secretary, responsible_authority, judgment, project_publicity, source_file
        ) SELECT * FROM unnest(
          ${sessionRows.map(({ publicationId }) => publicationId)}::uuid[],
          ${sessionRows.map(({ record }) => textValue(record.neun))}::text[],
          ${sessionRows.map(({ record }) => textValue(record.rowId))}::text[],
          ${sessionRows.map(({ record }) => textValue(record.filter))}::text[],
          ${sessionRows.map(({ record }) => textValue(record.sessionType))}::text[],
          ${sessionRows.map(({ record }) => textValue(record.listDate))}::date[],
          ${sessionRows.map(({ record }) => textValue(record.sessionDate))}::date[],
          ${sessionRows.map(({ record }) => textValue(record.result))}::text[],
          ${sessionRows.map(({ record }) => textValue(record.rapporteur))}::text[],
          ${sessionRows.map(({ record }) => textValue(record.projectSecretary))}::text[],
          ${sessionRows.map(({ record }) => textValue(record.authority))}::text[],
          ${sessionRows.map(({ record }) => textValue(record.judgment))}::text[],
          ${sessionRows.map(({ record }) => textValue(record.projectPublicity))}::text[],
          ${sessionRows.map(({ record }) => textValue(record.file))}::text[]
        ) ON CONFLICT (publication_id) DO NOTHING
      `;
    }

    const firstPublication = publications[0];
    const candidates = extractParties({ provider: "federal-pjf-session-lists", parties: first.parties, rawPayload, rawText, officialText: "" });
    if (firstPublication && !previousEnrichment && candidates.length) {
      const partyMetrics = await persistPartyCandidates(tx, {
        caseId: String(judicialCase.id), publicationId: String(firstPublication.id), snapshotId: String(snapshot.id),
        provider: "federal-pjf-session-lists", sourceUrl: first.sourceUrl,
        publicationDate: first.publicationDate, parserVersion,
      }, candidates);
      metrics.partiesFound = partyMetrics.partiesFound;
      metrics.partiesCreated = partyMetrics.partiesCreated;
      metrics.mentionsCreated = partyMetrics.mentionsCreated;
      metrics.ambiguousParties = partyMetrics.ambiguous;
      if (partyMetrics.mentionsCreated < partyMetrics.partiesFound) {
        metrics.notifications += await matchKnownPartiesToWatchRules(tx, {
          caseId: String(judicialCase.id), publicationId: String(firstPublication.id), snapshotId: String(snapshot.id),
          provider: "federal-pjf-session-lists", sourceUrl: first.sourceUrl,
          publicationDate: first.publicationDate, parserVersion,
        });
      }
    }
    if (firstPublication) {
      await tx`
        INSERT INTO party_extraction_records (publication_id, parser_version, provider, status, candidates_found, details)
        SELECT publication_id, ${parserVersion}, 'federal-pjf-session-lists',
               ${candidates.length ? "EXTRACTED_FROM_SHARED_HISTORY" : "NO_CANDIDATES"}, ${candidates.length},
               ${tx.json({ sharedSnapshot: first.snapshotHash })}
        FROM unnest(${publications.map((row) => String(row.id))}::uuid[]) AS input(publication_id)
        ON CONFLICT (publication_id, parser_version) DO UPDATE SET
          status = EXCLUDED.status, candidates_found = EXCLUDED.candidates_found,
          details = EXCLUDED.details, processed_at = now()
      `;
    }
    if (!previousEnrichment) {
      await recomputePartyDiscoveryStatuses(tx, [String(judicialCase.id)], "federal-pjf-session-lists", parserVersion);
    }

    const monitored = await tx`
      SELECT mc.id FROM monitored_cases mc
      WHERE mc.case_id = ${judicialCase.id} AND mc.active AND mc.deleted_at IS NULL
    `;
    if (monitored.length && publications.length) {
      const monitoredIds = monitored.flatMap((entry) => publications.map(() => String(entry.id)));
      const publicationIds = monitored.flatMap(() => publications.map((entry) => String(entry.id)));
      const detectedAt = monitored.flatMap(() => items.map((item) => item.retrievedAt));
      const movements = await tx`
        INSERT INTO case_movements (monitored_case_id, publication_id, match_result, detected_at)
        SELECT monitored_case_id, publication_id, 'EXACT', detected_at
        FROM unnest(${monitoredIds}::uuid[], ${publicationIds}::uuid[], ${detectedAt}::timestamptz[])
          AS input(monitored_case_id, publication_id, detected_at)
        ON CONFLICT DO NOTHING RETURNING id
      `;
      metrics.matches = movements.length;
      if (movements.length) {
        const movementIds = movements.map((movement) => String(movement.id));
        const notifications = await tx`
          INSERT INTO notifications (user_id, movement_id, channel, subject, payload)
          SELECT recipients.user_id, cm.id, delivery.channel,
                 CASE jp.publication_kind
                   WHEN 'SESSION_LISTED' THEN 'Asunto federal listado para sesión: ' || watched.case_number_normalized
                   WHEN 'SESSION_RESULT' THEN 'Resultado de sesión federal: ' || watched.case_number_normalized
                   ELSE CASE WHEN jp.official_text ~* '(^|[^[:alpha:]])sentencias?([^[:alpha:]]|$)'
                     THEN 'Resolución relacionada con sentencia: ' ELSE 'Nuevo acuerdo federal: ' END || watched.case_number_normalized
                 END,
                 jsonb_build_object('publicationId', jp.id, 'matchResult', 'EXACT',
                   'publicationKind', jp.publication_kind, 'publicationDate', jp.publication_date,
                   'sessionDate', jp.agreement_date)
          FROM case_movements cm
          JOIN monitored_cases mc ON mc.id = cm.monitored_case_id
          JOIN judicial_cases watched ON watched.id = mc.case_id
          JOIN judicial_publications jp ON jp.id = cm.publication_id
          JOIN LATERAL (
            SELECT mc.user_id WHERE mc.user_id IS NOT NULL
            UNION SELECT m.user_id FROM memberships m WHERE m.organization_id = mc.organization_id
          ) recipients ON true
          CROSS JOIN (VALUES ('IN_APP'), ('EMAIL')) AS delivery(channel)
          WHERE cm.id = ANY(${movementIds}::uuid[])
            AND (delivery.channel = 'IN_APP' OR (
              jp.publication_date >= mc.created_at::date
              AND (jp.publication_kind IN ('SESSION_LISTED', 'SESSION_RESULT')
                OR jp.official_text ~* '(^|[^[:alpha:]])sentencias?([^[:alpha:]]|$)')
            ))
          ON CONFLICT DO NOTHING RETURNING id
        `;
        metrics.notifications += notifications.length;
      }
    }
    return metrics;
  });
}

export async function persistPublications(provider: string, items: NormalizedPublication[]): Promise<PersistenceMetrics> {
  if (bulkFederalHistoryEligible(provider, items)) return persistFederalCaseHistory(items);
  const sql = db();
  return sql.begin(async (tx) => {
    const metrics: PersistenceMetrics = {
      inserted: 0, duplicates: 0, matches: 0, notifications: 0,
      partiesFound: 0, partiesCreated: 0, mentionsCreated: 0, relationsCreated: 0, ambiguousParties: 0,
    };
    const checkedSnapshotRevisions = new Set<string>();
    const courtsByExternalId = new Map<string, { id: string }>();
    const casesByCanonicalKey = new Map<string, { id: string }>();
    const snapshotsByHash = new Map<string, { id: string }>();
    const candidatesByCase = new Map<string, Array<{ id: string; case_type: string; case_number_normalized: string }>>();
    const pendingMonitoredIds: string[] = [];
    const pendingPublicationIds: string[] = [];
    const pendingDetectedAt: string[] = [];
    const discoveredCaseIds = new Set<string>();
    const federalHistoryCandidates = new Map<string, ReturnType<typeof extractParties>>();
    const enrichedFederalHistorySnapshots = new Set<string>();
    let partyExtractionAttempts = 0;
    const jurisdiction = provider.startsWith("jalisco") ? "JALISCO" : "FEDERAL";
    const providerName = provider === "jalisco-stj-chambers" ? "Supremo Tribunal de Justicia del Estado de Jalisco" : jurisdiction === "JALISCO" ? "Consejo de la Judicatura del Estado de Jalisco" : "Poder Judicial de la Federación";
    const partyParserVersion = `${items[0]?.parserVersion ?? "unknown"}|${PARTY_PARSER_VERSION}`;
    const existingPublications = items.length ? await tx`
      SELECT jp.content_hash, ss.sha256 AS snapshot_hash,
             bool_or(per.publication_id IS NOT NULL) AS party_extraction_current
      FROM judicial_publications jp
      JOIN source_snapshots ss ON ss.id = jp.snapshot_id
      LEFT JOIN party_extraction_records per
        ON per.publication_id = jp.id AND per.parser_version = ${partyParserVersion}
      WHERE jp.content_hash = ANY(${items.map((item) => item.contentHash)}::text[])
      GROUP BY jp.content_hash, ss.sha256
    ` : [];
    const completedHashes = new Set(existingPublications
      .filter((row) => row.party_extraction_current)
      .map((row) => `${row.content_hash}:${row.snapshot_hash}`));
    let [authority] = await tx`SELECT id FROM judicial_authorities WHERE code = ${provider} LIMIT 1`;
    if (!authority) {
      [authority] = await tx`
        INSERT INTO judicial_authorities (code, name, jurisdiction, source_url)
        VALUES (${provider}, ${providerName}, ${jurisdiction}, ${items[0]?.sourceUrl ?? ""})
        ON CONFLICT (code) DO NOTHING RETURNING id
      `;
      if (!authority) [authority] = await tx`SELECT id FROM judicial_authorities WHERE code = ${provider} LIMIT 1`;
    }

    for (const item of items) {
      if (completedHashes.has(`${item.contentHash}:${item.snapshotHash}`)) {
        metrics.duplicates += 1;
        continue;
      }
      const rawContainer = item.rawPayload && typeof item.rawPayload === "object" ? item.rawPayload as Record<string, unknown> : {};
      const rawText = typeof rawContainer.rawHtml === "string" ? rawContainer.rawHtml : null;
      const rawPayload = Object.fromEntries(Object.entries(rawContainer).filter(([key]) => key !== "rawHtml"));
      const federalRecord = rawContainer.record && typeof rawContainer.record === "object" ? rawContainer.record as Record<string, unknown> : null;
      const federalAgreement = rawContainer.agreement && typeof rawContainer.agreement === "object" ? rawContainer.agreement as Record<string, unknown> : null;
      const stjMetadata = rawContainer.metadata && typeof rawContainer.metadata === "object" ? rawContainer.metadata as Record<string, unknown> : null;
      const publicationKind = federalRecord?.filter === "lista" ? "SESSION_LISTED" : federalRecord?.filter === "sesion" ? "SESSION_RESULT" : "AGREEMENT";
      if (!checkedSnapshotRevisions.has(item.snapshotHash)) {
        const previous = await tx`
          SELECT sha256 FROM source_snapshots
          WHERE provider = ${provider} AND court_external_id = ${item.courtExternalId}
            AND publication_date = ${item.publicationDate} AND external_id = ${`${item.courtExternalId}:${item.publicationDate}:${publicationKind}`}
            AND sha256 <> ${item.snapshotHash}
          ORDER BY retrieved_at DESC LIMIT 1
        `;
        if (previous.length) {
          await tx`
            INSERT INTO domain_events (type, aggregate_type, payload)
            VALUES ('SOURCE_REVISION_DETECTED', 'source_snapshot', ${tx.json({ provider, courtExternalId: item.courtExternalId, publicationDate: item.publicationDate, previousHash: previous[0].sha256, currentHash: item.snapshotHash })})
          `;
        }
        checkedSnapshotRevisions.add(item.snapshotHash);
      }
      let court = courtsByExternalId.get(item.courtExternalId);
      if (!court) {
        [court] = await tx`SELECT id FROM courts WHERE authority_id = ${authority.id} AND external_id = ${item.courtExternalId} LIMIT 1` as Array<{ id: string }>;
        if (!court) {
          [court] = await tx`
            INSERT INTO courts (authority_id, external_id, name, normalized_name, matter, last_seen_at)
            VALUES (${authority.id}, ${item.courtExternalId}, ${item.courtName ?? `Órgano ${item.courtExternalId}`}, ${normalizeName(item.courtName ?? `Órgano ${item.courtExternalId}`)}, ${item.caseType ?? null}, now())
            ON CONFLICT (authority_id, external_id) DO NOTHING RETURNING id
          ` as Array<{ id: string }>;
          if (!court) [court] = await tx`SELECT id FROM courts WHERE authority_id = ${authority.id} AND external_id = ${item.courtExternalId} LIMIT 1` as Array<{ id: string }>;
        }
        courtsByExternalId.set(item.courtExternalId, court);
      }
      let judicialCase = casesByCanonicalKey.get(item.canonicalCaseKey);
      if (!judicialCase) {
        [judicialCase] = await tx`SELECT id FROM judicial_cases WHERE canonical_key = ${item.canonicalCaseKey} LIMIT 1` as Array<{ id: string }>;
        if (!judicialCase) {
          [judicialCase] = await tx`
            INSERT INTO judicial_cases (
              authority_id, court_id, case_type, case_number_raw, case_number_normalized,
              number, year, canonical_key, matter
            ) VALUES (
              ${authority.id}, ${court.id}, ${item.caseType || "NO_ESPECIFICADO"}, ${item.caseNumberRaw},
              ${item.caseNumberNormalized}, ${item.number}, ${item.year}, ${item.canonicalCaseKey}, ${item.caseType ?? null}
            )
            ON CONFLICT (canonical_key) DO NOTHING RETURNING id
          ` as Array<{ id: string }>;
          if (!judicialCase) [judicialCase] = await tx`SELECT id FROM judicial_cases WHERE canonical_key = ${item.canonicalCaseKey} LIMIT 1` as Array<{ id: string }>;
        }
        casesByCanonicalKey.set(item.canonicalCaseKey, judicialCase);
      }
      discoveredCaseIds.add(String(judicialCase.id));
      let snapshot = snapshotsByHash.get(item.snapshotHash);
      if (!snapshot) {
        [snapshot] = await tx`
          INSERT INTO source_snapshots (
            provider, external_id, court_external_id, publication_date, source_url, raw_payload, raw_text,
            retrieved_at, sha256, parser_version, provider_version, response_headers, content_type, request_method, http_status
          ) VALUES (
            ${provider}, ${`${item.courtExternalId}:${item.publicationDate}:${publicationKind}`}, ${item.courtExternalId}, ${item.publicationDate},
            ${item.sourceUrl}, ${tx.json(rawPayload as never)}, ${rawText},
            ${item.retrievedAt}, ${item.snapshotHash}, ${item.parserVersion}, ${item.providerVersion},
            ${tx.json({})}, ${rawText ? "text/html" : "application/json"}, ${textValue(rawContainer.requestMethod) ?? (rawText ? "POST" : "GET")}, 200
          )
          ON CONFLICT (sha256) DO UPDATE SET sha256 = EXCLUDED.sha256
          RETURNING id
        ` as Array<{ id: string }>;
        snapshotsByHash.set(item.snapshotHash, snapshot);
      }
      const publications = await tx`
        INSERT INTO judicial_publications (
          case_id, court_id, snapshot_id, external_id, case_number_raw, case_number_normalized,
          case_type, official_text, publication_date, agreement_date, promotion_date, publication_kind, notebook,
          retrieved_at, content_hash, source_url
        ) VALUES (
          ${judicialCase.id}, ${court.id}, ${snapshot.id}, ${item.externalId ?? null}, ${item.caseNumberRaw},
          ${item.caseNumberNormalized}, ${item.caseType ?? null}, ${item.officialText}, ${item.publicationDate},
          ${item.agreementDate ?? null}, ${item.promotionDate ?? null}, ${publicationKind}, ${textValue(federalAgreement?.notebook)},
          ${item.retrievedAt}, ${item.contentHash}, ${item.sourceUrl}
        )
        ON CONFLICT (court_id, content_hash) DO UPDATE SET
          snapshot_id = judicial_publications.snapshot_id
        RETURNING id, (xmax = 0) AS inserted
      `;
      if (!publications[0].inserted) {
        metrics.duplicates += 1;
      } else {
        metrics.inserted += 1;
      }

      if (federalRecord) {
        await tx`
          INSERT INTO federal_session_details (
            publication_id, neun, row_external_id, filter_kind, session_type, list_date, session_date,
            result, rapporteur, project_secretary, responsible_authority, judgment, project_publicity, source_file
          ) VALUES (
            ${publications[0].id}, ${textValue(federalRecord.neun)}, ${textValue(federalRecord.rowId)}, ${textValue(federalRecord.filter)},
            ${textValue(federalRecord.sessionType)}, ${textValue(federalRecord.listDate)}, ${textValue(federalRecord.sessionDate)},
            ${textValue(federalRecord.result)}, ${textValue(federalRecord.rapporteur)}, ${textValue(federalRecord.projectSecretary)},
            ${textValue(federalRecord.authority)}, ${textValue(federalRecord.judgment)}, ${textValue(federalRecord.projectPublicity)}, ${textValue(federalRecord.file)}
          ) ON CONFLICT (publication_id) DO NOTHING
        `;
      }

      if (provider === "jalisco-stj-chambers" && stjMetadata) {
        const sentenceSignal = textValue(stjMetadata.sentenceSignal) ?? "NONE";
        const sentenceState = sentenceSignal === "NONE" ? "NOT_EXPECTED" : "PENDING_PUBLICATION";
        await tx`
          INSERT INTO stj_case_details (
            judicial_case_id, chamber_external_id, origin_case_number, origin_court, judicial_district,
            appeal_type, proceeding, sentence_state, possible_sentence_at, next_retry_at, official_search_url
          ) VALUES (
            ${judicialCase.id}, ${item.courtExternalId}, ${textValue(stjMetadata.originCaseNumber)},
            ${textValue(stjMetadata.originCourt)}, ${textValue(stjMetadata.judicialDistrict)},
            ${textValue(stjMetadata.appealType)}, ${textValue(stjMetadata.proceeding)}, ${sentenceState},
            ${sentenceSignal === "NONE" ? null : item.retrievedAt},
            ${sentenceSignal === "NONE" ? null : item.retrievedAt},
            'https://publicacionsentencias.stjjalisco.gob.mx/sentencias'
          )
          ON CONFLICT (judicial_case_id) DO UPDATE SET
            chamber_external_id = EXCLUDED.chamber_external_id,
            origin_case_number = COALESCE(EXCLUDED.origin_case_number, stj_case_details.origin_case_number),
            origin_court = COALESCE(EXCLUDED.origin_court, stj_case_details.origin_court),
            judicial_district = COALESCE(EXCLUDED.judicial_district, stj_case_details.judicial_district),
            appeal_type = COALESCE(EXCLUDED.appeal_type, stj_case_details.appeal_type),
            proceeding = COALESCE(EXCLUDED.proceeding, stj_case_details.proceeding),
            sentence_state = CASE
              WHEN stj_case_details.sentence_state = 'AVAILABLE' THEN 'AVAILABLE'
              WHEN EXCLUDED.sentence_state = 'PENDING_PUBLICATION' THEN 'PENDING_PUBLICATION'
              ELSE stj_case_details.sentence_state
            END,
            possible_sentence_at = COALESCE(stj_case_details.possible_sentence_at, EXCLUDED.possible_sentence_at),
            next_retry_at = CASE WHEN EXCLUDED.sentence_state = 'PENDING_PUBLICATION' THEN LEAST(COALESCE(stj_case_details.next_retry_at, EXCLUDED.next_retry_at), EXCLUDED.next_retry_at) ELSE stj_case_details.next_retry_at END,
            updated_at = now()
        `;
        try {
          const relation = await tx.savepoint((relationTx) => linkStjOriginCase(relationTx, String(judicialCase.id), {
            originCaseNumber: textValue(stjMetadata.originCaseNumber),
            originCourt: textValue(stjMetadata.originCourt),
            judicialDistrict: textValue(stjMetadata.judicialDistrict),
            matter: textValue(stjMetadata.matter),
          }));
          if (relation === "CREATED") metrics.relationsCreated += 1;
        } catch {
          // Relacionar el toca con su expediente de origen es enriquecimiento opcional.
          // La publicación confirmada no debe perderse si esta inferencia falla.
        }
      }

      try {
        partyExtractionAttempts += 1;
        const sharedFederalHistory = provider === "federal-pjf-session-lists" && Boolean(federalAgreement && rawText);
        if (sharedFederalHistory && enrichedFederalHistorySnapshots.has(item.snapshotHash)) {
          const sharedCandidates = federalHistoryCandidates.get(item.snapshotHash) ?? [];
          await tx`
            INSERT INTO party_extraction_records (publication_id, parser_version, provider, status, candidates_found, details)
            VALUES (${publications[0].id}, ${partyParserVersion}, ${provider},
                    ${sharedCandidates.length ? "EXTRACTED_FROM_SHARED_HISTORY" : "NO_CANDIDATES"},
                    ${sharedCandidates.length}, ${tx.json({ sharedSnapshot: item.snapshotHash })})
            ON CONFLICT (publication_id, parser_version) DO UPDATE SET
              status = EXCLUDED.status, candidates_found = EXCLUDED.candidates_found,
              details = EXCLUDED.details, processed_at = now()
          `;
        } else {
          const enrichment = await tx.savepoint(async (partyTx) => {
            let partyCandidates: ReturnType<typeof extractParties>;
            if (provider === "federal-pjf-session-lists" && federalAgreement && rawText) {
              let historyCandidates = federalHistoryCandidates.get(item.snapshotHash);
              if (!historyCandidates) {
                historyCandidates = extractParties({ provider, parties: item.parties, rawPayload, rawText, officialText: "" });
                federalHistoryCandidates.set(item.snapshotHash, historyCandidates);
              }
              partyCandidates = historyCandidates.length
                ? historyCandidates
                : extractParties({ provider, rawPayload, rawText: null, officialText: item.officialText });
            } else {
              partyCandidates = extractParties({ provider, parties: item.parties, rawPayload, rawText, officialText: item.officialText });
            }
            const partyMetrics = await persistPartyCandidates(partyTx, {
              caseId: String(judicialCase.id),
              publicationId: String(publications[0].id),
              snapshotId: String(snapshot.id),
              provider,
              sourceUrl: item.sourceUrl,
              publicationDate: item.publicationDate,
              parserVersion: partyParserVersion,
            }, partyCandidates);
            await partyTx`
              INSERT INTO party_extraction_records (publication_id, parser_version, provider, status, candidates_found)
              VALUES (${publications[0].id}, ${partyParserVersion}, ${provider}, ${partyCandidates.length ? "EXTRACTED" : "NO_CANDIDATES"}, ${partyCandidates.length})
              ON CONFLICT (publication_id, parser_version) DO UPDATE SET
                status = EXCLUDED.status, candidates_found = EXCLUDED.candidates_found, details = '{}', processed_at = now()
            `;
            const notifications = partyMetrics.mentionsCreated < partyMetrics.partiesFound
              ? await matchKnownPartiesToWatchRules(partyTx, {
                  caseId: String(judicialCase.id), publicationId: String(publications[0].id), snapshotId: String(snapshot.id),
                  provider, sourceUrl: item.sourceUrl, publicationDate: item.publicationDate, parserVersion: partyParserVersion,
                })
              : 0;
            return { partyMetrics, notifications };
          });
          if (sharedFederalHistory) enrichedFederalHistorySnapshots.add(item.snapshotHash);
          const { partyMetrics } = enrichment;
          metrics.partiesFound += partyMetrics.partiesFound;
          metrics.partiesCreated += partyMetrics.partiesCreated;
          metrics.mentionsCreated += partyMetrics.mentionsCreated;
          metrics.ambiguousParties += partyMetrics.ambiguous;
          metrics.notifications += enrichment.notifications;
        }
      } catch (error) {
        try {
          await tx.savepoint(async (failureTx) => {
            await failureTx`
              INSERT INTO party_extraction_records (publication_id, parser_version, provider, status, candidates_found, details)
              VALUES (${publications[0].id}, ${partyParserVersion}, ${provider}, 'FAILED', 0,
                      ${failureTx.json({ code: "PARTY_PARSER_FAILED", message: error instanceof Error ? error.message.slice(0, 300) : "unknown" })})
              ON CONFLICT (publication_id, parser_version) DO UPDATE SET
                status = 'FAILED', details = EXCLUDED.details, processed_at = now()
            `;
          });
        } catch {
          // La observabilidad del enriquecimiento tampoco debe bloquear el acuerdo.
        }
      }

      const candidateKey = jurisdiction === "FEDERAL" ? judicialCase.id : `${court.id}:${item.caseNumberNormalized}`;
      let candidates = candidatesByCase.get(candidateKey);
      if (!candidates) {
        candidates = jurisdiction === "FEDERAL"
          ? await tx`
              SELECT mc.id, wc.case_type, wc.case_number_normalized
              FROM monitored_cases mc
              JOIN judicial_cases wc ON wc.id = mc.case_id
              WHERE wc.id = ${judicialCase.id} AND mc.active
            ` as Array<{ id: string; case_type: string; case_number_normalized: string }>
          : await tx`
              SELECT mc.id, wc.case_type, wc.case_number_normalized
              FROM monitored_cases mc
              JOIN judicial_cases wc ON wc.id = mc.case_id
              WHERE wc.court_id = ${court.id} AND wc.case_number_normalized = ${item.caseNumberNormalized} AND mc.active
            ` as Array<{ id: string; case_type: string; case_number_normalized: string }>;
        candidatesByCase.set(candidateKey, candidates);
      }
      const exactCandidateIds = candidates.map((candidate) => String(candidate.id));
      for (const monitoredId of exactCandidateIds) {
        pendingMonitoredIds.push(monitoredId);
        pendingPublicationIds.push(String(publications[0].id));
        pendingDetectedAt.push(item.retrievedAt);
      }
    }
    if (provider === "jalisco-cjj" && partyExtractionAttempts >= 10 && metrics.partiesFound === 0) {
      await tx`
        INSERT INTO domain_events (type, aggregate_type, payload)
        VALUES ('PARTY_EXTRACTION_DEGRADED', 'provider', ${tx.json({
          provider, recordsProcessed: items.length, partiesFound: 0, parserVersion: PARTY_PARSER_VERSION,
        })})
      `;
    }
    try {
      await tx.savepoint((discoveryTx) => recomputePartyDiscoveryStatuses(
        discoveryTx,
        [...discoveredCaseIds],
        provider,
        `${items[0]?.parserVersion ?? "unknown"}|${PARTY_PARSER_VERSION}`,
      ));
    } catch {
      // El estado del índice por nombre se puede recomputar después; el boletín no.
    }
    if (pendingPublicationIds.length) {
      const movements = await tx`
        INSERT INTO case_movements (monitored_case_id, publication_id, match_result, detected_at)
        SELECT input.monitored_case_id, input.publication_id, 'EXACT', input.detected_at
        FROM unnest(${pendingMonitoredIds}::uuid[], ${pendingPublicationIds}::uuid[], ${pendingDetectedAt}::timestamptz[])
          AS input(monitored_case_id, publication_id, detected_at)
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      metrics.matches += movements.length;
      if (movements.length) {
        const movementIds = movements.map((movement) => String(movement.id));
        const notifications = await tx`
          INSERT INTO notifications (user_id, movement_id, channel, subject, payload)
          SELECT recipients.user_id, cm.id, delivery.channel,
                 CASE jp.publication_kind
                   WHEN 'SESSION_LISTED' THEN 'Asunto federal listado para sesión: ' || watched.case_number_normalized
                   WHEN 'SESSION_RESULT' THEN 'Resultado de sesión federal: ' || watched.case_number_normalized
                   WHEN 'STJ_JUDGMENT' THEN 'Sentencia del STJ disponible: ' || watched.case_number_normalized
                   ELSE CASE WHEN jp.official_text ~* '(^|[^[:alpha:]])sentencias?([^[:alpha:]]|$)' THEN 'Resolución relacionada con sentencia: ' ELSE CASE WHEN ja.jurisdiction = 'FEDERAL' THEN 'Nuevo acuerdo federal: ' ELSE 'Movimiento en ' END END || watched.case_number_normalized
                 END,
                 jsonb_build_object(
                   'publicationId', jp.id, 'matchResult', 'EXACT', 'publicationKind', jp.publication_kind,
                   'publicationDate', jp.publication_date, 'sessionDate', jp.agreement_date
                 )
          FROM case_movements cm
          JOIN monitored_cases mc ON mc.id = cm.monitored_case_id
          JOIN judicial_cases watched ON watched.id = mc.case_id
          JOIN judicial_authorities ja ON ja.id = watched.authority_id
          JOIN judicial_publications jp ON jp.id = cm.publication_id
          JOIN LATERAL (
            SELECT mc.user_id WHERE mc.user_id IS NOT NULL
            UNION
            SELECT m.user_id FROM memberships m WHERE m.organization_id = mc.organization_id AND mc.organization_id IS NOT NULL
          ) recipients ON true
          CROSS JOIN (VALUES ('IN_APP'), ('EMAIL')) AS delivery(channel)
          WHERE cm.id = ANY(${movementIds}::uuid[])
            AND (
              delivery.channel = 'IN_APP'
              OR (
                jp.publication_date >= mc.created_at::date
                AND (
                  jp.publication_kind IN ('SESSION_LISTED', 'SESSION_RESULT', 'STJ_JUDGMENT')
                  OR jp.official_text ~* '(^|[^[:alpha:]])sentencias?([^[:alpha:]]|$)'
                )
              )
            )
          ON CONFLICT DO NOTHING
          RETURNING id
        `;
        metrics.notifications += notifications.length;
      }
    }
    return metrics;
  });
}

export async function recordIngestionRun(result: {
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
  errors: string[];
  dryRun: boolean;
  lastSnapshotHash?: string;
}) {
  const status = result.errors.length ? (result.recordsFetched ? "PARTIAL" : "FAILED") : "SUCCEEDED";
  await db()`
    INSERT INTO ingestion_runs (
      job_id, provider, status, started_at, completed_at, duration_ms, records_fetched,
      records_inserted, records_updated, duplicates, matches, notifications, errors, dry_run,
      courts_attempted, courts_successful, courts_failed, last_snapshot_hash
    ) VALUES (
      ${result.jobId}, ${result.provider}, ${status}, ${result.startedAt}, ${result.completedAt}, ${result.duration},
      ${result.recordsFetched}, ${result.recordsInserted}, ${result.recordsUpdated}, ${result.duplicates},
      ${result.matches}, ${result.notifications}, ${db().json(result.errors)}, ${result.dryRun},
      1, ${result.errors.length ? 0 : 1}, ${result.errors.length ? 1 : 0}, ${result.lastSnapshotHash ?? null}
    )
    ON CONFLICT (job_id) DO NOTHING
  `;
}
