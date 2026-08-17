import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db/client";

type EmailKind = "WELCOME" | "PAYMENT_CONFIRMED" | "PAYMENT_FAILED" | "SUBSCRIPTION_CANCELED" | "JUDICIAL_ALERT" | "EMAIL_VERIFICATION" | "PASSWORD_RESET";

interface EmailInput {
  dedupeKey: string;
  organizationId: string;
  userId?: string;
  recipient: string;
  recipientName: string;
  organizationName: string;
  kind: EmailKind;
  periodEnd?: Date;
  customSubject?: string;
  customTitle?: string;
  customBody?: string;
  actionPath?: string;
  actionLabel?: string;
  verificationCode?: string;
  verificationExpiresInMinutes?: number;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
}

function date(value?: Date) {
  return value ? new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "America/Mexico_City" }).format(value) : undefined;
}

function content(input: EmailInput) {
  if (input.kind === "EMAIL_VERIFICATION") return { subject: "Tu código de verificación", title: "Verifica tu correo", body: `Usa este código para confirmar que ${escapeHtml(input.recipient)} te pertenece. Caduca en ${input.verificationExpiresInMinutes ?? 10} minutos.`, action: "" };
  if (input.kind === "PASSWORD_RESET") return { subject: "Código para recuperar tu contraseña", title: "Recupera el acceso a tu cuenta", body: `Recibimos una solicitud para cambiar la contraseña de ${escapeHtml(input.recipient)}. Usa este código durante los próximos ${input.verificationExpiresInMinutes ?? 10} minutos. Si no fuiste tú, ignora este correo.`, action: "" };
  if (input.kind === "JUDICIAL_ALERT") return { subject: input.customSubject ?? "Nueva publicación en uno de tus asuntos", title: input.customTitle ?? "Nueva publicación judicial", body: escapeHtml(input.customBody ?? "Hay una publicación vinculada a uno de tus asuntos vigilados."), action: input.actionLabel ?? "Abrir asunto" };
  const end = date(input.periodEnd);
  if (input.kind === "WELCOME") return { subject: "Tu vigilancia judicial ya está activa", title: "Bienvenido a Mi Boletín Judicial", body: `La suscripción de ${escapeHtml(input.organizationName)} quedó vinculada correctamente. Ya puedes registrar expedientes, organizarlos en carpetas y consultar sus publicaciones desde un solo lugar.`, action: "Abrir mi panel" };
  if (input.kind === "PAYMENT_CONFIRMED") return { subject: "Pago confirmado — Mi Boletín Judicial", title: "Tu suscripción está activa", body: `Confirmamos correctamente tu pago${end ? ` y tu acceso está vigente hasta el ${end}` : ""}. Tu espacio de vigilancia ya está disponible.`, action: "Abrir mi panel" };
  if (input.kind === "PAYMENT_FAILED") return { subject: "Es necesario actualizar tu forma de pago", title: "No pudimos procesar la renovación", body: "Tu institución bancaria rechazó el último cobro. Actualiza tu forma de pago para conservar el acceso a tus asuntos y avisos.", action: "Actualizar forma de pago" };
  return { subject: "Tu suscripción fue cancelada", title: "Cancelación programada", body: `Registramos la cancelación de tu suscripción${end ? `. Conservarás el acceso hasta el ${end}` : ""}. Puedes reactivarla desde tu perfil mientras siga vigente.`, action: "Gestionar suscripción" };
}

function document(input: EmailInput) {
  const copy = content(input);
  const appUrl = new URL(process.env.APP_URL?.trim() || "http://localhost:3000").origin;
  const actionUrl = new URL(input.actionPath ?? "/settings#billing", appUrl).toString();
  const code = (input.kind === "EMAIL_VERIFICATION" || input.kind === "PASSWORD_RESET") && input.verificationCode ? `<div style="margin:30px 0;padding:23px 16px;border-top:1px solid #d9d1c5;border-bottom:1px solid #d9d1c5;background:#f3efe7;text-align:center;font-family:Georgia,serif;font-size:38px;letter-spacing:.22em;font-variant-numeric:tabular-nums">${escapeHtml(input.verificationCode)}</div>` : "";
  const action = copy.action ? `<a href="${actionUrl}" style="display:inline-block;background:#722f37;color:#fff;text-decoration:none;padding:13px 20px;font-weight:700">${copy.action}</a>` : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;background:#f3efe7;color:#26231f;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:42px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fffdf8;border:1px solid #d9d1c5"><tr><td style="padding:24px 32px;border-bottom:3px solid #722f37;font-family:Georgia,serif;font-size:18px">MI BOLETÍN JUDICIAL</td></tr><tr><td style="padding:42px 32px"><p style="margin:0 0 12px;color:#722f37;font-size:12px;letter-spacing:.12em;text-transform:uppercase">Información de tu cuenta</p><h1 style="margin:0 0 20px;font-family:Georgia,serif;font-size:34px;font-weight:500;line-height:1.1">${copy.title}</h1><p style="font-size:16px;line-height:1.7;margin:0 0 10px">Hola, ${escapeHtml(input.recipientName)}. ${copy.body}</p>${code}${action}</td></tr><tr><td style="padding:22px 32px;background:#eee8de;color:#6f685f;font-size:12px;line-height:1.6">Este mensaje se relaciona con la cuenta de ${escapeHtml(input.organizationName)}. No compartas tus credenciales ni códigos de verificación.</td></tr></table></td></tr></table></body></html>`;
}

export async function sendTransactionalEmail(input: EmailInput): Promise<"SENT" | "SKIPPED"> {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || "Mi Boletín Judicial";
  if (!apiKey || !senderEmail) return "SKIPPED";
  const recipientHash = createHash("sha256").update(input.recipient.trim().toLowerCase()).digest("hex");
  const [reserved] = await db()`
    INSERT INTO transactional_email_log (dedupe_key, organization_id, user_id, kind, recipient_hash, status)
    VALUES (${input.dedupeKey}, ${input.organizationId}, ${input.userId ?? null}, ${input.kind}, ${recipientHash}, 'SKIPPED')
    ON CONFLICT (dedupe_key) DO UPDATE SET status = 'SKIPPED', error_message = NULL
      WHERE transactional_email_log.status = 'FAILED'
    RETURNING id
  `;
  if (!reserved) return "SENT";
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "api-key": apiKey },
      body: JSON.stringify({ sender: { name: senderName, email: senderEmail }, to: [{ email: input.recipient, name: input.recipientName }], subject: content(input).subject, htmlContent: document(input), tags: ["mi-boletin", input.kind.toLowerCase()] }),
      signal: AbortSignal.timeout(12_000),
    });
    const result = await response.json().catch(() => ({})) as { messageId?: string; message?: string };
    if (!response.ok) throw new Error(result.message || `Brevo HTTP ${response.status}`);
    await db()`UPDATE transactional_email_log SET status = 'SENT', provider_message_id = ${result.messageId ?? null} WHERE id = ${reserved.id}`;
    return "SENT";
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Error desconocido";
    await db()`UPDATE transactional_email_log SET status = 'FAILED', error_message = ${message} WHERE id = ${reserved.id}`;
    throw error;
  }
}
