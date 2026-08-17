import "server-only";
import { db } from "@/lib/db/client";
import { sendTransactionalEmail, type EmailInput } from "@/lib/email/brevo";
import { classifySubscriptionLifecycleEmail } from "@/lib/billing/retention-policy";

export { classifySubscriptionLifecycleEmail } from "@/lib/billing/retention-policy";

export async function dispatchSubscriptionLifecycleEmails(sender: (input: EmailInput) => Promise<"SENT" | "SKIPPED"> = sendTransactionalEmail) {
  const rows = await db()`
    SELECT bs.organization_id, bs.status, bs.cancel_at_period_end, bs.current_period_end,
           contact.user_id, contact.email, contact.name, o.name AS organization_name
    FROM billing_subscriptions bs
    JOIN organizations o ON o.id = bs.organization_id
    JOIN LATERAL (
      SELECT u.id AS user_id, u.email, u.name
      FROM memberships m
      JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL AND u.email_verified_at IS NOT NULL
      WHERE m.organization_id = bs.organization_id
      ORDER BY CASE m.role WHEN 'OWNER' THEN 1 WHEN 'ADMIN' THEN 2 ELSE 3 END, m.created_at
      LIMIT 1
    ) contact ON true
    WHERE bs.current_period_end IS NOT NULL
    ORDER BY bs.current_period_end
    LIMIT 1000
  `;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    const lifecycle = classifySubscriptionLifecycleEmail({
      organizationId: String(row.organization_id), status: String(row.status),
      cancelAtPeriodEnd: Boolean(row.cancel_at_period_end), currentPeriodEnd: String(row.current_period_end),
    });
    if (!lifecycle) continue;
    try {
      const result = await sender({
        dedupeKey: lifecycle.dedupeKey, organizationId: String(row.organization_id), userId: String(row.user_id),
        recipient: String(row.email), recipientName: String(row.name), organizationName: String(row.organization_name),
        kind: lifecycle.kind, periodEnd: new Date(String(row.current_period_end)),
        actionPath: "/settings#billing", daysRemaining: "daysRemaining" in lifecycle ? lifecycle.daysRemaining : undefined,
        campaignVariant: lifecycle.campaignVariant,
      });
      if (result === "SENT") sent += 1;
      else skipped += 1;
    } catch (error) {
      failed += 1;
      console.error("Subscription lifecycle email failed", { organizationId: row.organization_id, error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { sent, skipped, failed };
}
