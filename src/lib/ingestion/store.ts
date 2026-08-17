import type { NormalizedPublication } from "@/lib/domain/types";
import { normalizeName } from "@/lib/domain/normalization";
import { db } from "@/lib/db/client";

export interface PersistenceMetrics {
  inserted: number;
  duplicates: number;
  matches: number;
  notifications: number;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export async function persistPublications(provider: string, items: NormalizedPublication[]): Promise<PersistenceMetrics> {
  const sql = db();
  return sql.begin(async (tx) => {
    const metrics: PersistenceMetrics = { inserted: 0, duplicates: 0, matches: 0, notifications: 0 };
    const checkedSnapshotRevisions = new Set<string>();
    const courtsByExternalId = new Map<string, { id: string }>();
    const casesByCanonicalKey = new Map<string, { id: string }>();
    const snapshotsByHash = new Map<string, { id: string }>();
    const candidatesByCase = new Map<string, Array<{ id: string; case_type: string; case_number_normalized: string }>>();
    const pendingMonitoredIds: string[] = [];
    const pendingPublicationIds: string[] = [];
    const pendingDetectedAt: string[] = [];
    const jurisdiction = provider.startsWith("jalisco") ? "JALISCO" : "FEDERAL";
    const providerName = jurisdiction === "JALISCO" ? "Consejo de la Judicatura del Estado de Jalisco" : "Poder Judicial de la Federación";
    const [authority] = await tx`
      INSERT INTO judicial_authorities (code, name, jurisdiction, source_url)
      VALUES (${provider}, ${providerName}, ${jurisdiction}, ${items[0]?.sourceUrl ?? ""})
      ON CONFLICT (code) DO UPDATE SET source_url = EXCLUDED.source_url
      RETURNING id
    `;

    for (const item of items) {
      const rawContainer = item.rawPayload && typeof item.rawPayload === "object" ? item.rawPayload as Record<string, unknown> : {};
      const rawText = typeof rawContainer.rawHtml === "string" ? rawContainer.rawHtml : null;
      const rawPayload = Object.fromEntries(Object.entries(rawContainer).filter(([key]) => key !== "rawHtml"));
      const federalRecord = rawContainer.record && typeof rawContainer.record === "object" ? rawContainer.record as Record<string, unknown> : null;
      const federalAgreement = rawContainer.agreement && typeof rawContainer.agreement === "object" ? rawContainer.agreement as Record<string, unknown> : null;
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
        [court] = await tx`
          INSERT INTO courts (authority_id, external_id, name, normalized_name, matter, last_seen_at)
          VALUES (${authority.id}, ${item.courtExternalId}, ${item.courtName ?? `Órgano ${item.courtExternalId}`}, ${normalizeName(item.courtName ?? `Órgano ${item.courtExternalId}`)}, ${item.caseType ?? null}, now())
          ON CONFLICT (authority_id, external_id) DO UPDATE SET name = EXCLUDED.name, normalized_name = EXCLUDED.normalized_name, last_seen_at = now()
          RETURNING id
        ` as Array<{ id: string }>;
        courtsByExternalId.set(item.courtExternalId, court);
      }
      let judicialCase = casesByCanonicalKey.get(item.canonicalCaseKey);
      if (!judicialCase) {
        [judicialCase] = await tx`
          INSERT INTO judicial_cases (
            authority_id, court_id, case_type, case_number_raw, case_number_normalized,
            number, year, canonical_key, matter
          ) VALUES (
            ${authority.id}, ${court.id}, ${item.caseType || "NO_ESPECIFICADO"}, ${item.caseNumberRaw},
            ${item.caseNumberNormalized}, ${item.number}, ${item.year}, ${item.canonicalCaseKey}, ${item.caseType ?? null}
          )
          ON CONFLICT (canonical_key) DO UPDATE SET case_number_raw = EXCLUDED.case_number_raw
          RETURNING id
        ` as Array<{ id: string }>;
        casesByCanonicalKey.set(item.canonicalCaseKey, judicialCase);
      }
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
        ON CONFLICT (court_id, content_hash) DO NOTHING
        RETURNING id
      `;
      if (!publications.length) {
        metrics.duplicates += 1;
        continue;
      }
      metrics.inserted += 1;

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

      for (const [side, name] of Object.entries(item.parties ?? {})) {
        if (!name) continue;
        await tx`
          INSERT INTO case_parties (case_id, name_raw, name_normalized, side)
          VALUES (${judicialCase.id}, ${name}, ${normalizeName(name)}, ${side})
          ON CONFLICT DO NOTHING
        `;
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
                   ELSE CASE WHEN ja.jurisdiction = 'FEDERAL' THEN 'Nuevo acuerdo federal: ' ELSE 'Movimiento en ' END || watched.case_number_normalized
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
            AND (delivery.channel = 'IN_APP' OR jp.publication_date >= mc.created_at::date)
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
