import "server-only";
import type Stripe from "stripe";
import { billingContact } from "@/lib/billing/repository";
import { sendTransactionalEmail } from "@/lib/email/brevo";

function idOf(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id;
}
export async function sendPaymentConfirmation(organizationId: string, subscription: Stripe.Subscription) {
  const contact = await billingContact(organizationId);
  if (!contact) return;
  const item = subscription.items.data[0];
  const invoiceId = idOf(subscription.latest_invoice) ?? subscription.id;
  await sendTransactionalEmail({
    dedupeKey: `payment:${invoiceId}`,
    organizationId,
    userId: contact.userId,
    recipient: contact.email,
    recipientName: contact.name,
    organizationName: contact.organizationName,
    kind: "PAYMENT_CONFIRMED",
    periodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : undefined,
    actionPath: "/dashboard?subscription=active",
  });
}
