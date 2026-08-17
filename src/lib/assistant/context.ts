import { db } from "@/lib/db/client";
import { dateInMexicoCity, isIsoDate } from "@/lib/product/query";
import type { AssistantPeriod } from "@/lib/assistant/types";

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function explicitDates(question: string): string[] {
  const values = new Set<string>();
  for (const match of question.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    if (isIsoDate(match[0])) values.add(match[0]);
  }
  for (const match of question.matchAll(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/g)) {
    const value = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
    if (isIsoDate(value)) values.add(value);
  }
  return [...values].sort();
}

export function resolveAssistantPeriod(question: string, now = new Date()): AssistantPeriod {
  const today = dateInMexicoCity(now);
  const normalized = question.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const dates = explicitDates(question);
  if (dates.length) return { from: dates[0], to: dates.at(-1)!, label: dates.length === 1 ? dates[0] : `${dates[0]} a ${dates.at(-1)}` };
  if (/\bayer\b/.test(normalized)) {
    const yesterday = shiftDate(today, -1);
    return { from: yesterday, to: yesterday, label: "ayer" };
  }
  if (/\bhoy\b/.test(normalized)) return { from: today, to: today, label: "hoy" };
  if (/\besta semana\b/.test(normalized)) {
    const weekday = new Date(`${today}T12:00:00.000Z`).getUTCDay() || 7;
    return { from: shiftDate(today, 1 - weekday), to: today, label: "esta semana" };
  }
  if (/\beste mes\b/.test(normalized)) return { from: `${today.slice(0, 7)}-01`, to: today, label: "este mes" };
  return { from: shiftDate(today, -365), to: today, label: "los últimos 365 días" };
}

function requestedCaseNumber(question: string): string | null {
  const match = question.match(/\b(\d{1,7})\s*[\/-]\s*((?:19|20)\d{2})\b/);
  return match ? `${Number(match[1])}/${match[2]}` : null;
}

function clipped(value: unknown, length = 900): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

export async function buildAssistantContext(organizationId: string, userId: string, question: string) {
  const period = resolveAssistantPeriod(question);
  const caseNumber = requestedCaseNumber(question);
  const [cases, movements, sessions, alertCount, folders] = await Promise.all([
    db()`
      SELECT mc.id, jc.case_number_normalized, jc.case_type, jc.status, count(*) OVER()::int AS total_count,
             c.name AS court_name, c.court_type, ja.jurisdiction,
             cir.name AS circuit_name, folders.folder_name,
             mc.source_status, mc.last_successful_check_at
      FROM monitored_cases mc
      JOIN judicial_cases jc ON jc.id = mc.case_id
      JOIN courts c ON c.id = jc.court_id
      JOIN judicial_authorities ja ON ja.id = jc.authority_id
      LEFT JOIN judicial_circuits cir ON cir.id = c.circuit_id
      LEFT JOIN LATERAL (SELECT string_agg(f.name, ' · ' ORDER BY f.created_at) AS folder_name FROM monitored_case_folders mcf JOIN case_folders f ON f.id = mcf.folder_id WHERE mcf.monitored_case_id = mc.id) folders ON true
      WHERE mc.organization_id = ${organizationId} AND mc.active AND mc.deleted_at IS NULL
        AND (${caseNumber}::text IS NULL OR jc.case_number_normalized = ${caseNumber})
      ORDER BY mc.created_at DESC
      LIMIT 250
    `,
    db()`
      SELECT jc.case_number_normalized, jc.case_type, c.name AS court_name,
             ja.jurisdiction, folders.folder_name, jp.publication_date,
             jp.agreement_date, jp.promotion_date, jp.publication_kind,
             jp.official_text, jp.source_url
      FROM case_movements cm
      JOIN monitored_cases mc ON mc.id = cm.monitored_case_id
      JOIN judicial_cases jc ON jc.id = mc.case_id
      JOIN courts c ON c.id = jc.court_id
      JOIN judicial_authorities ja ON ja.id = jc.authority_id
      JOIN judicial_publications jp ON jp.id = cm.publication_id
      LEFT JOIN LATERAL (SELECT string_agg(f.name, ' · ' ORDER BY f.created_at) AS folder_name FROM monitored_case_folders mcf JOIN case_folders f ON f.id = mcf.folder_id WHERE mcf.monitored_case_id = mc.id) folders ON true
      WHERE mc.organization_id = ${organizationId} AND mc.active AND mc.deleted_at IS NULL
        AND jp.publication_date BETWEEN ${period.from} AND ${period.to}
        AND (ja.jurisdiction <> 'FEDERAL' OR jp.case_id = mc.case_id)
        AND (${caseNumber}::text IS NULL OR jc.case_number_normalized = ${caseNumber})
      ORDER BY jp.publication_date DESC, jp.retrieved_at DESC
      LIMIT 300
    `,
    db()`
      SELECT jc.case_number_normalized, c.name AS court_name, folders.folder_name,
             jp.publication_date AS list_date, fsd.session_date, jp.publication_kind,
             fsd.result, fsd.judgment, fsd.rapporteur, jp.source_url
      FROM case_movements cm
      JOIN monitored_cases mc ON mc.id = cm.monitored_case_id
      JOIN judicial_cases jc ON jc.id = mc.case_id
      JOIN judicial_authorities ja ON ja.id = jc.authority_id
      JOIN courts c ON c.id = jc.court_id
      JOIN judicial_publications jp ON jp.id = cm.publication_id
      JOIN federal_session_details fsd ON fsd.publication_id = jp.id
      LEFT JOIN LATERAL (SELECT string_agg(f.name, ' · ' ORDER BY f.created_at) AS folder_name FROM monitored_case_folders mcf JOIN case_folders f ON f.id = mcf.folder_id WHERE mcf.monitored_case_id = mc.id) folders ON true
      WHERE mc.organization_id = ${organizationId} AND mc.active AND mc.deleted_at IS NULL
        AND (ja.jurisdiction <> 'FEDERAL' OR jp.case_id = mc.case_id)
        AND (${caseNumber}::text IS NULL OR jc.case_number_normalized = ${caseNumber})
      ORDER BY COALESCE(fsd.session_date, jp.publication_date) DESC
      LIMIT 200
    `,
    db()`
      SELECT count(*)::int AS count
      FROM notifications n
      JOIN memberships membership ON membership.user_id = n.user_id
      JOIN case_movements cm ON cm.id = n.movement_id
      JOIN monitored_cases mc ON mc.id = cm.monitored_case_id
      JOIN judicial_cases watched ON watched.id = mc.case_id
      JOIN judicial_authorities watched_authority ON watched_authority.id = watched.authority_id
      JOIN judicial_publications jp ON jp.id = cm.publication_id
      WHERE membership.organization_id = ${organizationId}
        AND mc.organization_id = ${organizationId}
        AND n.user_id = ${userId}
        AND n.status = 'QUEUED'
        AND n.channel = 'IN_APP'
        AND jp.publication_date = ${dateInMexicoCity()}
        AND (watched_authority.jurisdiction <> 'FEDERAL' OR jp.case_id = mc.case_id)
        AND mc.active AND mc.deleted_at IS NULL
    `,
    db()`SELECT id, name FROM case_folders WHERE organization_id = ${organizationId} ORDER BY created_at`,
  ]);

  return {
    generatedAt: new Date().toISOString(),
    timeZone: "America/Mexico_City",
    requestedPeriod: period,
    requestedCaseNumber: caseNumber,
    activeCaseCount: Number(cases[0]?.total_count ?? 0),
    unreadAlertCount: Number(alertCount[0]?.count ?? 0),
    folders: folders.map((row) => ({ name: row.name })),
    cases: cases.map((row) => ({
      caseNumber: row.case_number_normalized,
      caseType: row.case_type,
      status: row.status,
      court: row.court_name,
      courtType: row.court_type,
      jurisdiction: row.jurisdiction,
      circuit: row.circuit_name,
      folder: row.folder_name ?? "General",
      sourceStatus: row.source_status,
      lastVerifiedAt: row.last_successful_check_at,
    })),
    movements: movements.map((row) => ({
      caseNumber: row.case_number_normalized,
      caseType: row.case_type,
      court: row.court_name,
      jurisdiction: row.jurisdiction,
      folder: row.folder_name ?? "General",
      publicationDate: row.publication_date,
      agreementDate: row.agreement_date,
      promotionDate: row.promotion_date,
      kind: row.publication_kind,
      extract: clipped(row.official_text),
      officialSource: row.source_url,
    })),
    sessions: sessions.map((row) => ({
      caseNumber: row.case_number_normalized,
      court: row.court_name,
      folder: row.folder_name ?? "General",
      listedDate: row.list_date,
      sessionDate: row.session_date,
      kind: row.publication_kind,
      result: clipped(row.result, 500) || null,
      judgment: clipped(row.judgment, 500) || null,
      rapporteur: row.rapporteur,
      officialSource: row.source_url,
    })),
  };
}
