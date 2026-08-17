import "server-only";
import { db } from "@/lib/db/client";
import { sendTransactionalEmail } from "@/lib/email/brevo";

export async function dispatchJudicialEmails(organizationId: string, monitoredCaseId?: string) {
  if (!process.env.BREVO_API_KEY?.trim() || !process.env.BREVO_SENDER_EMAIL?.trim()) return { sent: 0, failed: 0 };
  const rows = await db()`
    SELECT n.id, n.subject, u.id AS user_id, u.email, u.name, o.name AS organization_name,
           mc.id AS monitored_case_id, jc.case_number_normalized, c.name AS court_name,
           jp.publication_date, jp.publication_kind, jp.official_text
    FROM notifications n
    JOIN users u ON u.id = n.user_id AND u.deleted_at IS NULL
    JOIN case_movements cm ON cm.id = n.movement_id
    JOIN monitored_cases mc ON mc.id = cm.monitored_case_id AND mc.active AND mc.deleted_at IS NULL
    JOIN organizations o ON o.id = mc.organization_id
    JOIN judicial_cases jc ON jc.id = mc.case_id
    JOIN judicial_authorities ja ON ja.id = jc.authority_id
    JOIN courts c ON c.id = jc.court_id
    JOIN judicial_publications jp ON jp.id = cm.publication_id
    WHERE mc.organization_id = ${organizationId}
      AND n.channel = 'EMAIL' AND n.status = 'QUEUED'
      AND (ja.jurisdiction <> 'FEDERAL' OR jp.case_id = mc.case_id)
      AND (${monitoredCaseId ?? null}::uuid IS NULL OR mc.id = ${monitoredCaseId ?? null}::uuid)
    ORDER BY n.created_at
    LIMIT 100
  `;
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const kind = String(row.publication_kind);
    const title = kind === "SESSION_LISTED" ? "Tu asunto fue listado para sesión" : kind === "SESSION_RESULT" ? "Se publicó el resultado de sesión" : "Se publicó una nueva resolución";
    const extract = String(row.official_text ?? "").replace(/\s+/g, " ").trim().slice(0, 700);
    const body = `${row.case_number_normalized} · ${row.court_name}. Publicación: ${row.publication_date}. ${extract}`;
    try {
      const status = await sendTransactionalEmail({ dedupeKey: `judicial:${row.id}`, organizationId, userId: row.user_id, recipient: row.email, recipientName: row.name, organizationName: row.organization_name, kind: "JUDICIAL_ALERT", customSubject: row.subject, customTitle: title, customBody: body, actionPath: `/cases/${row.monitored_case_id}`, actionLabel: "Abrir asunto" });
      if (status === "SENT") {
        await db()`UPDATE notifications SET status = 'SENT', sent_at = now() WHERE id = ${row.id} AND status = 'QUEUED'`;
        sent += 1;
      }
    } catch (error) {
      failed += 1;
      console.error("Judicial email could not be sent", { notificationId: row.id, error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { sent, failed };
}
