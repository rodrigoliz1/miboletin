import { hash } from "bcryptjs";
import { canonicalCaseKey, normalizeCaseNumber, normalizeName } from "@/lib/domain/normalization";
import { db } from "@/lib/db/client";
import type { Jurisdiction, UserRole } from "@/lib/domain/types";
import { dateInMexicoCity, optionalUuid } from "@/lib/product/query";

export interface AccountRecord {
  userId: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  organizationId: string;
  organizationName: string;
  sessionVersion: number;
}

export interface FolderRecord {
  id: string;
  name: string;
  description?: string;
  caseCount: number;
  newCount: number;
}

export interface MonitoredCaseRecord {
  id: string;
  caseId: string;
  number: string;
  caseType: string;
  jurisdiction: Jurisdiction;
  provider: string;
  courtExternalId: string;
  courtName: string;
  courtType?: string;
  circuitId?: string;
  circuitName?: string;
  folderId?: string;
  folderName?: string;
  folderIds: string[];
  folderNames: string[];
  label?: string;
  status: string;
  sourceStatus: string;
  sourceMessage?: string;
  monitorFrom: string;
  createdAt: string;
  lastCheckedAt?: string;
  lastSuccessfulCheckAt?: string;
  refreshStartedAt?: string;
  lastPublicationDate?: string;
  newCount: number;
  plaintiff?: string;
  defendant?: string;
}

export interface MovementRecord {
  id: string;
  publicationId: string;
  matchResult: string;
  detectedAt: string;
  publicationDate: string;
  agreementDate?: string;
  promotionDate?: string;
  officialText: string;
  sourceUrl: string;
  publicationKind: string;
  retrievedAt: string;
  sessionDate?: string;
  result?: string;
  judgment?: string;
  rapporteur?: string;
  sessionType?: string;
  filterKind?: string;
  snapshotHash: string;
  notebook?: string;
}

export interface OrganizationMovementRecord {
  id: string;
  detected_at: string;
  match_result: string;
  monitored_case_id: string;
  case_number: string;
  case_type: string;
  court_name: string;
  jurisdiction: Jurisdiction;
  publication_date: string;
  agreement_date: string | null;
  official_text: string;
  publication_kind: string;
  session_date: string | null;
  result: string | null;
  judgment: string | null;
  folder_name: string | null;
  plaintiff: string | null;
  defendant: string | null;
  retrieved_at: string;
  notebook: string | null;
}

export interface JudicialSearchResult {
  caseId: string;
  monitoredCaseId?: string;
  number: string;
  caseType: string;
  jurisdiction: Jurisdiction;
  provider: string;
  courtExternalId: string;
  courtName: string;
  courtType?: string;
  circuitId?: string;
  circuitName?: string;
  plaintiff?: string;
  defendant?: string;
  publicationCount: number;
  lastPublicationDate?: string;
}

export interface JudicialSearchMovement {
  caseId: string;
  publicationDate: string;
  agreementDate?: string;
  officialText: string;
  notebook?: string;
}

function isoTimestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.valueOf())) throw new Error("La base devolvió una fecha-hora inválida");
  return date.toISOString();
}

function isoDate(value: unknown): string {
  return isoTimestamp(value).slice(0, 10);
}

export async function createAccount(input: { name: string; organization: string; email: string; password: string }): Promise<AccountRecord> {
  const sql = db();
  const passwordHash = await hash(input.password, 12);
  return sql.begin(async (tx) => {
    const [organization] = await tx`
      INSERT INTO organizations (name, plan) VALUES (${input.organization}, 'FREE')
      RETURNING id, name
    `;
    const [user] = await tx`
      INSERT INTO users (email, name, password_hash, role)
      VALUES (${input.email}, ${input.name}, ${passwordHash}, 'OWNER')
      RETURNING id, email, name, role, session_version
    `;
    await tx`INSERT INTO memberships (user_id, organization_id, role) VALUES (${user.id}, ${organization.id}, 'OWNER')`;
    await tx`INSERT INTO case_folders (organization_id, name, description, created_by) VALUES (${organization.id}, 'General', 'Asuntos sin carpeta específica', ${user.id})`;
    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      passwordHash,
      role: user.role,
      organizationId: organization.id,
      organizationName: organization.name,
      sessionVersion: user.session_version,
    } as AccountRecord;
  });
}

export async function findAccountByEmail(email: string): Promise<AccountRecord | null> {
  const rows = await db()`
    SELECT u.id AS user_id, u.email, u.name, u.password_hash, u.session_version, m.role,
           o.id AS organization_id, o.name AS organization_name
    FROM users u
    JOIN memberships m ON m.user_id = u.id
    JOIN organizations o ON o.id = m.organization_id
    WHERE u.email = ${email} AND u.deleted_at IS NULL
    ORDER BY m.created_at ASC
    LIMIT 1
  `;
  if (!rows.length) return null;
  const row = rows[0];
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    role: row.role,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    sessionVersion: Number(row.session_version),
  } as AccountRecord;
}

export async function listFolders(organizationId: string): Promise<FolderRecord[]> {
  const today = dateInMexicoCity();
  const rows = await db()`
    SELECT f.id, f.name, f.description,
           count(DISTINCT mc.id)::int AS case_count,
           count(DISTINCT cm.id) FILTER (WHERE jp.publication_date = ${today})::int AS new_count
    FROM case_folders f
    LEFT JOIN monitored_case_folders mcf ON mcf.folder_id = f.id
    LEFT JOIN monitored_cases mc ON mc.id = mcf.monitored_case_id AND mc.active AND mc.deleted_at IS NULL
    LEFT JOIN case_movements cm ON cm.monitored_case_id = mc.id
    LEFT JOIN judicial_publications jp ON jp.id = cm.publication_id
    WHERE f.organization_id = ${organizationId}
    GROUP BY f.id
    ORDER BY f.created_at ASC
  `;
  return rows.map((row) => ({ id: row.id, name: row.name, description: row.description ?? undefined, caseCount: row.case_count, newCount: row.new_count }));
}

export async function createFolder(input: { organizationId: string; userId: string; name: string; description?: string }): Promise<string> {
  const [folder] = await db()`
    INSERT INTO case_folders (organization_id, name, description, created_by)
    VALUES (${input.organizationId}, ${input.name}, ${input.description ?? null}, ${input.userId})
    ON CONFLICT (organization_id, name) DO UPDATE SET description = COALESCE(EXCLUDED.description, case_folders.description), updated_at = now()
    RETURNING id
  `;
  return folder.id;
}

export async function createMonitoredCase(input: {
  organizationId: string;
  userId: string;
  jurisdiction: Jurisdiction;
  provider: string;
  authorityName: string;
  sourceUrl: string;
  courtExternalId: string;
  courtName: string;
  circuitId?: string;
  circuitName?: string;
  courtType?: string;
  caseNumber: string;
  caseType: string;
  folderIds?: string[];
  label?: string;
  monitorFrom: string;
}): Promise<string> {
  const parsed = normalizeCaseNumber(input.caseNumber);
  const canonical = canonicalCaseKey({
    jurisdiction: input.jurisdiction,
    provider: input.provider,
    courtExternalId: input.courtExternalId,
    caseType: input.caseType,
    number: parsed.number,
    year: parsed.year,
    suffix: parsed.suffix,
  });
  return db().begin(async (tx) => {
    const [authority] = await tx`
      INSERT INTO judicial_authorities (code, name, jurisdiction, source_url)
      VALUES (${input.provider}, ${input.authorityName}, ${input.jurisdiction}, ${input.sourceUrl})
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, source_url = EXCLUDED.source_url
      RETURNING id
    `;
    let circuitId: string | null = null;
    if (input.circuitId) {
      const [circuit] = await tx`
        INSERT INTO judicial_circuits (authority_id, external_id, name)
        VALUES (${authority.id}, ${input.circuitId}, ${input.circuitName ?? `Circuito ${input.circuitId}`})
        ON CONFLICT (authority_id, external_id) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `;
      circuitId = circuit.id;
    }
    const [court] = await tx`
      INSERT INTO courts (authority_id, circuit_id, external_id, name, normalized_name, matter, court_type, last_seen_at)
      VALUES (${authority.id}, ${circuitId}, ${input.courtExternalId}, ${input.courtName}, ${normalizeName(input.courtName)}, ${input.caseType}, ${input.courtType ?? null}, now())
      ON CONFLICT (authority_id, external_id) DO UPDATE SET
        name = EXCLUDED.name, normalized_name = EXCLUDED.normalized_name, circuit_id = COALESCE(EXCLUDED.circuit_id, courts.circuit_id),
        court_type = COALESCE(EXCLUDED.court_type, courts.court_type), last_seen_at = now(), active = true
      RETURNING id
    `;
    const [judicialCase] = await tx`
      INSERT INTO judicial_cases (
        authority_id, court_id, case_type, case_number_raw, case_number_normalized,
        number, year, canonical_key, matter
      ) VALUES (
        ${authority.id}, ${court.id}, ${input.caseType}, ${input.caseNumber}, ${parsed.normalized},
        ${parsed.number}, ${parsed.year}, ${canonical}, ${input.caseType}
      )
      ON CONFLICT (canonical_key) DO UPDATE SET case_number_raw = EXCLUDED.case_number_raw, status = 'ACTIVE'
      RETURNING id
    `;
    let folderIds = [...new Set((input.folderIds ?? []).map((value) => optionalUuid(value)).filter((value): value is string => Boolean(value)))];
    if (folderIds.length > 20) throw new Error("Selecciona un máximo de 20 carpetas");
    if (folderIds.length) {
      const belongs = await tx`SELECT id FROM case_folders WHERE id = ANY(${folderIds}::uuid[]) AND organization_id = ${input.organizationId}`;
      if (belongs.length !== folderIds.length) throw new Error("Una o más carpetas no pertenecen a la organización");
    } else {
      const [folder] = await tx`SELECT id FROM case_folders WHERE organization_id = ${input.organizationId} ORDER BY created_at LIMIT 1`;
      folderIds = folder?.id ? [folder.id] : [];
    }
    const primaryFolderId = folderIds[0] ?? null;
    const [monitored] = await tx`
      INSERT INTO monitored_cases (case_id, organization_id, folder_id, label, monitor_from, source_status, deleted_at, deleted_by)
      VALUES (${judicialCase.id}, ${input.organizationId}, ${primaryFolderId}, ${input.label ?? null}, ${input.monitorFrom}, 'PENDING', NULL, NULL)
      ON CONFLICT (case_id, organization_id) WHERE organization_id IS NOT NULL
      DO UPDATE SET active = true, deleted_at = NULL, deleted_by = NULL, folder_id = EXCLUDED.folder_id,
        label = COALESCE(EXCLUDED.label, monitored_cases.label), monitor_from = LEAST(monitored_cases.monitor_from, EXCLUDED.monitor_from)
      RETURNING id
    `;
    await tx`DELETE FROM monitored_case_folders WHERE monitored_case_id = ${monitored.id}`;
    if (folderIds.length) {
      await tx`
        INSERT INTO monitored_case_folders (monitored_case_id, folder_id)
        SELECT ${monitored.id}, folder_id FROM unnest(${folderIds}::uuid[]) AS selected(folder_id)
        ON CONFLICT DO NOTHING
      `;
    }
    const historicalMovements = await tx`
      INSERT INTO case_movements (monitored_case_id, publication_id, match_result, detected_at)
      SELECT ${monitored.id}, jp.id, 'EXACT', now()
      FROM judicial_publications jp
      WHERE (
        (${input.jurisdiction} = 'FEDERAL' AND jp.case_id = ${judicialCase.id})
        OR (${input.jurisdiction} = 'JALISCO' AND jp.court_id = ${court.id} AND jp.case_number_normalized = ${parsed.normalized})
      )
        AND jp.publication_date >= ${input.monitorFrom}
      ON CONFLICT (monitored_case_id, publication_id) DO NOTHING
      RETURNING id
    `;
    await tx`
      INSERT INTO notifications (user_id, movement_id, channel, subject, payload)
      SELECT m.user_id, cm.id, delivery.channel,
             CASE jp.publication_kind
               WHEN 'SESSION_LISTED' THEN 'Asunto federal listado para sesión: ' || jc.case_number_normalized
               WHEN 'SESSION_RESULT' THEN 'Resultado de sesión federal: ' || jc.case_number_normalized
               ELSE CASE WHEN ja.jurisdiction = 'FEDERAL' THEN 'Nuevo acuerdo federal: ' ELSE 'Movimiento en ' END || jc.case_number_normalized
             END,
             jsonb_build_object(
               'publicationId', jp.id,
               'matchResult', 'EXACT',
               'publicationKind', jp.publication_kind,
               'publicationDate', jp.publication_date,
               'sessionDate', jp.agreement_date
             )
      FROM case_movements cm
      JOIN monitored_cases mc ON mc.id = cm.monitored_case_id
      JOIN judicial_publications jp ON jp.id = cm.publication_id
      JOIN judicial_cases jc ON jc.id = ${judicialCase.id}
      JOIN judicial_authorities ja ON ja.id = jc.authority_id
      JOIN memberships m ON m.organization_id = ${input.organizationId}
      CROSS JOIN (VALUES ('IN_APP'), ('EMAIL')) AS delivery(channel)
      WHERE cm.monitored_case_id = ${monitored.id} AND jp.publication_date >= ${input.monitorFrom}
        AND (delivery.channel = 'IN_APP' OR jp.publication_date >= mc.created_at::date)
      ON CONFLICT (movement_id, user_id, channel) DO NOTHING
    `;
    await tx`
      INSERT INTO audit_logs (actor_user_id, organization_id, action, entity_type, entity_id, metadata)
      VALUES (${input.userId}, ${input.organizationId}, 'MONITORED_CASE_CREATED', 'monitored_case', ${monitored.id}, ${tx.json({ jurisdiction: input.jurisdiction, courtExternalId: input.courtExternalId, caseNumber: parsed.normalized, historicalMovementsLinked: historicalMovements.length })})
    `;
    return monitored.id;
  });
}

export async function listMonitoredCases(organizationId: string, folderId?: string): Promise<MonitoredCaseRecord[]> {
  const selectedFolderId = optionalUuid(folderId);
  const today = dateInMexicoCity();
  const rows = await db()`
    SELECT mc.id, jc.id AS case_id, jc.case_number_normalized AS number, jc.case_type,
           ja.jurisdiction, ja.code AS provider, c.external_id AS court_external_id, c.name AS court_name, c.court_type,
           cir.external_id AS circuit_id, cir.name AS circuit_name,
           folders.folder_ids, folders.folder_names, mc.label, jc.status,
           mc.source_status, mc.source_message, mc.monitor_from, mc.created_at,
           mc.last_checked_at, mc.last_successful_check_at, mc.refresh_started_at,
           latest.publication_date AS last_publication_date, parties.plaintiff, parties.defendant,
           count(DISTINCT cm.id) FILTER (WHERE movement_publication.publication_date = ${today})::int AS new_count
    FROM monitored_cases mc
    JOIN judicial_cases jc ON jc.id = mc.case_id
    JOIN courts c ON c.id = jc.court_id
    JOIN judicial_authorities ja ON ja.id = jc.authority_id
    LEFT JOIN judicial_circuits cir ON cir.id = c.circuit_id
    LEFT JOIN LATERAL (
      SELECT array_agg(f.id ORDER BY f.created_at) AS folder_ids,
             array_agg(f.name ORDER BY f.created_at) AS folder_names
      FROM monitored_case_folders mcf
      JOIN case_folders f ON f.id = mcf.folder_id AND f.organization_id = mc.organization_id
      WHERE mcf.monitored_case_id = mc.id
    ) folders ON true
    LEFT JOIN case_movements cm ON cm.monitored_case_id = mc.id
    LEFT JOIN judicial_publications movement_publication ON movement_publication.id = cm.publication_id
    LEFT JOIN LATERAL (
      SELECT string_agg(DISTINCT cp.name_raw, ' · ' ORDER BY cp.name_raw) FILTER (WHERE cp.side = 'plaintiff') AS plaintiff,
             string_agg(DISTINCT cp.name_raw, ' · ' ORDER BY cp.name_raw) FILTER (WHERE cp.side = 'defendant') AS defendant
      FROM case_parties cp WHERE cp.case_id = jc.id
    ) parties ON true
    LEFT JOIN LATERAL (
      SELECT jp.publication_date FROM case_movements lm
      JOIN judicial_publications jp ON jp.id = lm.publication_id
      WHERE lm.monitored_case_id = mc.id ORDER BY jp.publication_date DESC, jp.retrieved_at DESC LIMIT 1
    ) latest ON true
    WHERE mc.organization_id = ${organizationId} AND mc.active AND mc.deleted_at IS NULL
      AND (${selectedFolderId}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM monitored_case_folders selected
        WHERE selected.monitored_case_id = mc.id AND selected.folder_id = ${selectedFolderId}
      ))
    GROUP BY mc.id, jc.id, ja.id, c.id, cir.id, folders.folder_ids, folders.folder_names, latest.publication_date, parties.plaintiff, parties.defendant
    ORDER BY COALESCE(latest.publication_date, mc.created_at::date) DESC, mc.created_at DESC
  `;
  return rows.map((row) => ({
    id: row.id, caseId: row.case_id, number: row.number, caseType: row.case_type, jurisdiction: row.jurisdiction,
    provider: row.provider, courtExternalId: row.court_external_id, courtName: row.court_name, courtType: row.court_type ?? undefined,
    circuitId: row.circuit_id ?? undefined, circuitName: row.circuit_name ?? undefined,
    folderId: row.folder_ids?.[0] ?? undefined, folderName: row.folder_names?.[0] ?? undefined,
    folderIds: row.folder_ids ?? [], folderNames: row.folder_names ?? [], label: row.label ?? undefined,
    status: row.status, sourceStatus: row.source_status, sourceMessage: row.source_message ?? undefined,
    monitorFrom: isoDate(row.monitor_from), createdAt: isoTimestamp(row.created_at), lastCheckedAt: row.last_checked_at ? isoTimestamp(row.last_checked_at) : undefined,
    lastSuccessfulCheckAt: row.last_successful_check_at ? isoTimestamp(row.last_successful_check_at) : undefined,
    refreshStartedAt: row.refresh_started_at ? isoTimestamp(row.refresh_started_at) : undefined,
    lastPublicationDate: row.last_publication_date ? isoDate(row.last_publication_date) : undefined, newCount: row.new_count,
    plaintiff: row.plaintiff ?? undefined, defendant: row.defendant ?? undefined,
  }));
}

export async function getMonitoredCase(organizationId: string, monitoredCaseId: string): Promise<{ case: MonitoredCaseRecord; movements: MovementRecord[] } | null> {
  const cases = (await listMonitoredCases(organizationId)).filter((item) => item.id === monitoredCaseId);
  if (!cases.length) return null;
  const rows = await db()`
    SELECT cm.id, jp.id AS publication_id, cm.match_result, cm.detected_at,
           jp.publication_date, jp.agreement_date, jp.promotion_date, jp.official_text,
           jp.source_url, jp.publication_kind, jp.retrieved_at, jp.notebook, ss.sha256 AS snapshot_hash,
           fsd.session_date, fsd.result, fsd.judgment, fsd.rapporteur, fsd.session_type, fsd.filter_kind
    FROM case_movements cm
    JOIN judicial_publications jp ON jp.id = cm.publication_id
    JOIN source_snapshots ss ON ss.id = jp.snapshot_id
    LEFT JOIN federal_session_details fsd ON fsd.publication_id = jp.id
    WHERE cm.monitored_case_id = ${monitoredCaseId}
    ORDER BY COALESCE(fsd.session_date, jp.agreement_date, jp.publication_date) DESC, jp.retrieved_at DESC
  `;
  return {
    case: cases[0],
    movements: rows.map((row) => ({
      id: row.id, publicationId: row.publication_id, matchResult: row.match_result, detectedAt: isoTimestamp(row.detected_at),
      publicationDate: isoDate(row.publication_date), agreementDate: row.agreement_date ? isoDate(row.agreement_date) : undefined,
      promotionDate: row.promotion_date ? isoDate(row.promotion_date) : undefined, officialText: row.official_text,
      sourceUrl: row.source_url, publicationKind: row.publication_kind, retrievedAt: isoTimestamp(row.retrieved_at),
      sessionDate: row.session_date ? isoDate(row.session_date) : undefined, result: row.result ?? undefined,
      judgment: row.judgment ?? undefined,
      rapporteur: row.rapporteur ?? undefined, sessionType: row.session_type ?? undefined, filterKind: row.filter_kind ?? undefined,
      snapshotHash: row.snapshot_hash,
      notebook: row.notebook ?? undefined,
    })),
  };
}

export async function linkStoredPublicationsToMonitoredCase(organizationId: string, monitoredCaseId: string): Promise<number> {
  return db().begin(async (tx) => {
    const movements = await tx`
      INSERT INTO case_movements (monitored_case_id, publication_id, match_result, detected_at)
      SELECT mc.id, jp.id, 'EXACT', now()
      FROM monitored_cases mc
      JOIN judicial_cases watched ON watched.id = mc.case_id
      JOIN judicial_authorities watched_authority ON watched_authority.id = watched.authority_id
      JOIN judicial_publications jp ON (
        (watched_authority.jurisdiction = 'FEDERAL' AND jp.case_id = watched.id)
        OR (watched_authority.jurisdiction = 'JALISCO' AND jp.court_id = watched.court_id AND jp.case_number_normalized = watched.case_number_normalized)
      )
      WHERE mc.id = ${monitoredCaseId}
        AND mc.organization_id = ${organizationId}
        AND mc.active
        AND jp.publication_date >= mc.monitor_from
      ON CONFLICT (monitored_case_id, publication_id) DO NOTHING
      RETURNING id
    `;
    await tx`
      INSERT INTO notifications (user_id, movement_id, channel, subject, payload)
      SELECT membership.user_id, cm.id, delivery.channel,
             CASE jp.publication_kind
               WHEN 'SESSION_LISTED' THEN 'Asunto federal listado para sesión: ' || watched.case_number_normalized
               WHEN 'SESSION_RESULT' THEN 'Resultado de sesión federal: ' || watched.case_number_normalized
               ELSE CASE WHEN ja.jurisdiction = 'FEDERAL' THEN 'Nuevo acuerdo federal: ' ELSE 'Movimiento en ' END || watched.case_number_normalized
             END,
             jsonb_build_object(
               'publicationId', jp.id,
               'matchResult', 'EXACT',
               'publicationKind', jp.publication_kind,
               'publicationDate', jp.publication_date,
               'sessionDate', jp.agreement_date
             )
      FROM case_movements cm
      JOIN monitored_cases mc ON mc.id = cm.monitored_case_id
      JOIN judicial_cases watched ON watched.id = mc.case_id
      JOIN judicial_authorities ja ON ja.id = watched.authority_id
      JOIN judicial_publications jp ON jp.id = cm.publication_id
      JOIN memberships membership ON membership.organization_id = mc.organization_id
      CROSS JOIN (VALUES ('IN_APP'), ('EMAIL')) AS delivery(channel)
      WHERE mc.id = ${monitoredCaseId} AND mc.organization_id = ${organizationId}
        AND (delivery.channel = 'IN_APP' OR jp.publication_date >= mc.created_at::date)
      ON CONFLICT (movement_id, user_id, channel) DO NOTHING
    `;
    return movements.length;
  });
}

export async function listNotifications(organizationId: string, userId?: string) {
  const selectedUserId = optionalUuid(userId);
  const today = dateInMexicoCity();
  return db()`
    SELECT n.id, n.status, n.subject, n.payload, n.created_at, n.sent_at,
           jc.case_number_normalized AS case_number, c.name AS court_name, mc.id AS monitored_case_id
    FROM notifications n
    JOIN users u ON u.id = n.user_id
    JOIN memberships m ON m.user_id = u.id AND m.organization_id = ${organizationId}
    JOIN case_movements cm ON cm.id = n.movement_id
    JOIN judicial_publications jp ON jp.id = cm.publication_id
    JOIN monitored_cases mc ON mc.id = cm.monitored_case_id AND mc.organization_id = ${organizationId}
      AND mc.active AND mc.deleted_at IS NULL
    JOIN judicial_cases jc ON jc.id = mc.case_id
    JOIN courts c ON c.id = jc.court_id
    WHERE n.channel = 'IN_APP'
      AND (${selectedUserId}::uuid IS NULL OR n.user_id = ${selectedUserId})
      AND jp.publication_date = ${today}
    ORDER BY n.created_at DESC
    LIMIT 100
  `;
}

export async function listOrganizationMovements(organizationId: string, from: string, to: string, folderId?: string) {
  const selectedFolderId = optionalUuid(folderId);
  const rows = await db()`
    SELECT cm.id, cm.detected_at, cm.match_result, mc.id AS monitored_case_id,
           jc.case_number_normalized AS case_number, jc.case_type, c.name AS court_name,
           ja.jurisdiction, jp.publication_date, jp.agreement_date, jp.official_text,
           jp.publication_kind, jp.retrieved_at, jp.notebook, fsd.session_date, fsd.result, fsd.judgment, folders.folder_name,
           parties.plaintiff, parties.defendant
    FROM case_movements cm
    JOIN monitored_cases mc ON mc.id = cm.monitored_case_id
    JOIN judicial_cases jc ON jc.id = mc.case_id
    JOIN courts c ON c.id = jc.court_id
    JOIN judicial_authorities ja ON ja.id = jc.authority_id
    JOIN judicial_publications jp ON jp.id = cm.publication_id
    LEFT JOIN federal_session_details fsd ON fsd.publication_id = jp.id
    LEFT JOIN LATERAL (
      SELECT string_agg(DISTINCT cp.name_raw, ' · ' ORDER BY cp.name_raw) FILTER (WHERE cp.side = 'plaintiff') AS plaintiff,
             string_agg(DISTINCT cp.name_raw, ' · ' ORDER BY cp.name_raw) FILTER (WHERE cp.side = 'defendant') AS defendant
      FROM case_parties cp WHERE cp.case_id = jc.id
    ) parties ON true
    LEFT JOIN LATERAL (
      SELECT string_agg(f.name, ' · ' ORDER BY f.created_at) AS folder_name
      FROM monitored_case_folders mcf
      JOIN case_folders f ON f.id = mcf.folder_id AND f.organization_id = mc.organization_id
      WHERE mcf.monitored_case_id = mc.id
    ) folders ON true
    WHERE mc.organization_id = ${organizationId}
      AND mc.active AND mc.deleted_at IS NULL
      AND jp.publication_date BETWEEN ${from} AND ${to}
      AND (${selectedFolderId}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM monitored_case_folders selected
        WHERE selected.monitored_case_id = mc.id AND selected.folder_id = ${selectedFolderId}
      ))
    ORDER BY jp.publication_date DESC, cm.detected_at DESC
    LIMIT 500
  `;
  return rows.map((row): OrganizationMovementRecord => ({
    id: row.id,
    detected_at: isoTimestamp(row.detected_at),
    match_result: row.match_result,
    monitored_case_id: row.monitored_case_id,
    case_number: row.case_number,
    case_type: row.case_type,
    court_name: row.court_name,
    jurisdiction: row.jurisdiction,
    publication_date: isoDate(row.publication_date),
    agreement_date: row.agreement_date ? isoDate(row.agreement_date) : null,
    official_text: row.official_text,
    publication_kind: row.publication_kind,
    session_date: row.session_date ? isoDate(row.session_date) : null,
    result: row.result ?? null,
    judgment: row.judgment ?? null,
    folder_name: row.folder_name ?? null,
    plaintiff: row.plaintiff ?? null,
    defendant: row.defendant ?? null,
    retrieved_at: isoTimestamp(row.retrieved_at),
    notebook: row.notebook ?? null,
  }));
}

export async function deleteMonitoredCase(organizationId: string, userId: string, monitoredCaseId: string): Promise<boolean> {
  return db().begin(async (tx) => {
    const rows = await tx`
      UPDATE monitored_cases
      SET active = false, deleted_at = now(), deleted_by = ${userId},
          source_status = 'REMOVED', source_message = 'El asunto fue eliminado de la vigilancia por un usuario autorizado.',
          refresh_started_at = NULL
      WHERE id = ${monitoredCaseId} AND organization_id = ${organizationId}
        AND active AND deleted_at IS NULL
      RETURNING id
    `;
    if (!rows.length) return false;
    await tx`
      INSERT INTO audit_logs (actor_user_id, organization_id, action, entity_type, entity_id, metadata)
      VALUES (${userId}, ${organizationId}, 'MONITORED_CASE_DELETED', 'monitored_case', ${monitoredCaseId}, ${tx.json({ softDelete: true })})
    `;
    return true;
  });
}

export async function listOperationalRuns() {
  return db()`SELECT * FROM ingestion_runs ORDER BY started_at DESC LIMIT 50`;
}

export async function searchJudicialCases(input: {
  organizationId: string;
  query: string;
  mode: "CASE" | "PARTY";
  scope: "JALISCO" | "FEDERAL" | "GENERAL";
  side?: "plaintiff" | "defendant" | "both";
  limit?: number;
}): Promise<JudicialSearchResult[]> {
  const normalizedQuery = input.mode === "PARTY" ? normalizeName(input.query) : normalizeCaseNumber(input.query).normalized;
  const jurisdiction = input.scope === "GENERAL" ? null : input.scope;
  const side = input.side === "plaintiff" || input.side === "defendant" ? input.side : null;
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const rows = await db()`
    SELECT jc.id AS case_id, watched.id AS monitored_case_id, jc.case_number_normalized, jc.case_type,
           ja.jurisdiction, ja.code AS provider, c.external_id AS court_external_id, c.name AS court_name, c.court_type,
           cir.external_id AS circuit_id, cir.name AS circuit_name,
           parties.plaintiff, parties.defendant, publications.publication_count, publications.last_publication_date
    FROM judicial_cases jc
    JOIN judicial_authorities ja ON ja.id = jc.authority_id
    JOIN courts c ON c.id = jc.court_id
    LEFT JOIN judicial_circuits cir ON cir.id = c.circuit_id
    LEFT JOIN monitored_cases watched ON watched.case_id = jc.id AND watched.organization_id = ${input.organizationId}
      AND watched.active AND watched.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT string_agg(DISTINCT cp.name_raw, ' · ' ORDER BY cp.name_raw) FILTER (WHERE cp.side = 'plaintiff') AS plaintiff,
             string_agg(DISTINCT cp.name_raw, ' · ' ORDER BY cp.name_raw) FILTER (WHERE cp.side = 'defendant') AS defendant
      FROM case_parties cp WHERE cp.case_id = jc.id
    ) parties ON true
    JOIN LATERAL (
      SELECT count(*)::int AS publication_count, max(jp.publication_date) AS last_publication_date
      FROM judicial_publications jp WHERE jp.case_id = jc.id
    ) publications ON publications.publication_count > 0
    WHERE (${jurisdiction}::text IS NULL OR ja.jurisdiction = ${jurisdiction})
      AND (
        (${input.mode} = 'CASE' AND jc.case_number_normalized = ${normalizedQuery})
        OR (${input.mode} = 'PARTY' AND EXISTS (
          SELECT 1 FROM case_parties searched
          WHERE searched.case_id = jc.id
            AND (${side}::text IS NULL OR searched.side = ${side})
            AND (searched.name_normalized ILIKE ${`%${normalizedQuery}%`} OR similarity(searched.name_normalized, ${normalizedQuery}) >= 0.35)
        ))
      )
    ORDER BY publications.last_publication_date DESC NULLS LAST, jc.year DESC, jc.number DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    caseId: row.case_id, monitoredCaseId: row.monitored_case_id ?? undefined, number: row.case_number_normalized,
    caseType: row.case_type, jurisdiction: row.jurisdiction, provider: row.provider,
    courtExternalId: row.court_external_id, courtName: row.court_name, courtType: row.court_type ?? undefined,
    circuitId: row.circuit_id ?? undefined, circuitName: row.circuit_name ?? undefined,
    plaintiff: row.plaintiff ?? undefined, defendant: row.defendant ?? undefined,
    publicationCount: Number(row.publication_count), lastPublicationDate: row.last_publication_date ? isoDate(row.last_publication_date) : undefined,
  }));
}

export async function listJudicialSearchMovements(caseIds: string[]): Promise<JudicialSearchMovement[]> {
  const ids = [...new Set(caseIds.map((value) => optionalUuid(value)).filter((value): value is string => Boolean(value)))].slice(0, 200);
  if (!ids.length) return [];
  const rows = await db()`
    SELECT jp.case_id, jp.publication_date, jp.agreement_date, jp.official_text, jp.notebook
    FROM judicial_publications jp
    WHERE jp.case_id = ANY(${ids}::uuid[]) AND jp.publication_kind = 'AGREEMENT'
    ORDER BY jp.case_id, jp.publication_date DESC, jp.agreement_date DESC NULLS LAST
    LIMIT 5000
  `;
  return rows.map((row) => ({ caseId: row.case_id, publicationDate: isoDate(row.publication_date), agreementDate: row.agreement_date ? isoDate(row.agreement_date) : undefined, officialText: row.official_text, notebook: row.notebook ?? undefined }));
}

export async function dashboardData(organizationId: string, userId: string, from: string, to: string) {
  const today = dateInMexicoCity();
  const [counts, cases, notifications] = await Promise.all([
    db()`
      SELECT count(DISTINCT mc.id)::int AS cases,
             count(DISTINCT cm.id) FILTER (WHERE jp.publication_date BETWEEN ${from} AND ${to})::int AS movements,
             count(DISTINCT cm.id) FILTER (WHERE jp.publication_kind = 'AGREEMENT' AND jp.publication_date = ${today})::int AS agreements_today,
             count(DISTINCT n.id) FILTER (WHERE n.channel = 'IN_APP' AND n.user_id = ${userId} AND jp.publication_date = ${today})::int AS unread
      FROM monitored_cases mc
      LEFT JOIN case_movements cm ON cm.monitored_case_id = mc.id
      LEFT JOIN judicial_publications jp ON jp.id = cm.publication_id
      LEFT JOIN notifications n ON n.movement_id = cm.id
      WHERE mc.organization_id = ${organizationId} AND mc.active AND mc.deleted_at IS NULL
    `,
    listMonitoredCases(organizationId),
    listNotifications(organizationId, userId),
  ]);
  return { counts: counts[0] ?? { cases: 0, movements: 0, unread: 0 }, cases, notifications };
}

export async function updateMonitoredSourceStatus(monitoredCaseId: string, status: string, message?: string, success = false) {
  await db()`
    UPDATE monitored_cases SET last_checked_at = now(),
      last_successful_check_at = CASE WHEN ${success} THEN now() ELSE last_successful_check_at END,
      source_status = ${status}, source_message = ${message ?? null}, refresh_started_at = NULL
    WHERE id = ${monitoredCaseId} AND active AND deleted_at IS NULL
  `;
}

export async function tryMarkMonitoredCaseChecking(organizationId: string, monitoredCaseId: string, force = false): Promise<boolean> {
  const rows = await db()`
    UPDATE monitored_cases
    SET source_status = 'CHECKING',
        source_message = 'Revisión de la fuente oficial en segundo plano.',
        refresh_started_at = now()
    WHERE id = ${monitoredCaseId}
      AND organization_id = ${organizationId}
      AND active
      AND deleted_at IS NULL
      AND (${force} OR last_checked_at IS NULL OR last_checked_at < now() - interval '1 minute')
      AND (
        source_status <> 'CHECKING'
        OR refresh_started_at IS NULL
        OR refresh_started_at < now() - interval '15 minutes'
      )
    RETURNING id
  `;
  return rows.length > 0;
}

export async function monitoredCaseRefreshStatus(organizationId: string, monitoredCaseId: string) {
  const rows = await db()`
    SELECT mc.source_status, mc.source_message, mc.refresh_started_at,
           mc.last_checked_at, mc.last_successful_check_at,
           count(cm.id)::int AS movement_count
    FROM monitored_cases mc
    LEFT JOIN case_movements cm ON cm.monitored_case_id = mc.id
    WHERE mc.id = ${monitoredCaseId}
      AND mc.organization_id = ${organizationId}
      AND mc.active
      AND mc.deleted_at IS NULL
    GROUP BY mc.id
  `;
  if (!rows.length) return null;
  const row = rows[0];
  return {
    sourceStatus: String(row.source_status),
    sourceMessage: row.source_message ? String(row.source_message) : undefined,
    refreshStartedAt: row.refresh_started_at ? isoTimestamp(row.refresh_started_at) : undefined,
    lastCheckedAt: row.last_checked_at ? isoTimestamp(row.last_checked_at) : undefined,
    lastSuccessfulCheckAt: row.last_successful_check_at ? isoTimestamp(row.last_successful_check_at) : undefined,
    movementCount: Number(row.movement_count),
  };
}
