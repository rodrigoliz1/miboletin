import { NextResponse } from "next/server";
import Stripe from "stripe";
import { billingContact, claimStripeEvent, organizationForStripeCustomer, releaseStripeEvent, saveStripeCustomer } from "@/lib/billing/repository";
import { persistStripeSubscription, stripeClient } from "@/lib/billing/stripe";
import { sendTransactionalEmail } from "@/lib/email/brevo";
import { sendPaymentConfirmation } from "@/lib/billing/notifications";

export const runtime = "nodejs";

function idOf(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id;
}

async function organizationForSubscription(subscription: Stripe.Subscription) {
  return subscription.metadata.organizationId || (idOf(subscription.customer) ? organizationForCustomer(idOf(subscription.customer)!) : null);
}

async function organizationForCustomer(customerId: string) {
  const stored = await organizationForStripeCustomer(customerId);
  if (stored) return stored;
  const customer = await stripeClient().customers.retrieve(customerId);
  if (customer.deleted || !customer.metadata.organizationId) return null;
  await saveStripeCustomer(customer.metadata.organizationId, customerId);
  return customer.metadata.organizationId;
}

async function notify(organizationId: string, kind: "WELCOME" | "PAYMENT_CONFIRMED" | "PAYMENT_FAILED" | "SUBSCRIPTION_CANCELED", dedupeKey: string, periodEnd?: Date) {
  const contact = await billingContact(organizationId);
  if (!contact) return;
  await sendTransactionalEmail({ dedupeKey, organizationId, userId: contact.userId, recipient: contact.email, recipientName: contact.name, organizationName: contact.organizationName, kind, periodEnd });
}

async function latestSubscription(customerId: string) {
  const list = await stripeClient().subscriptions.list({ customer: customerId, status: "all", limit: 10 });
  const priceId = process.env.STRIPE_PRICE_ID?.trim();
  return list.data.filter((subscription) => subscription.items.data.some((item) => item.price.id === priceId)).sort((a, b) => b.created - a.created)[0];
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const signature = request.headers.get("stripe-signature");
  if (!secret || !signature) return NextResponse.json({ error: "Webhook no configurado" }, { status: 400 });
  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(await request.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: "Firma inválida" }, { status: 400 });
  }
  if (!(await claimStripeEvent(event.id, event.type, event.livemode))) return NextResponse.json({ received: true, duplicate: true });
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const organizationId = session.metadata?.organizationId || session.client_reference_id;
      const customerId = idOf(session.customer);
      if (organizationId && customerId) {
        await saveStripeCustomer(organizationId, customerId);
        const subscription = session.subscription ? await stripeClient().subscriptions.retrieve(idOf(session.subscription)!) : await latestSubscription(customerId);
        if (subscription) {
          const persisted = await persistStripeSubscription(organizationId, subscription, session.payment_status === "paid" ? new Date() : undefined);
          if (persisted && (subscription.status === "active" || subscription.status === "trialing")) await sendPaymentConfirmation(organizationId, subscription);
        }
      }
    } else if (event.type.startsWith("customer.subscription.")) {
      const subscription = event.data.object as Stripe.Subscription;
      const organizationId = await organizationForSubscription(subscription);
      if (organizationId) {
        const persisted = await persistStripeSubscription(organizationId, subscription);
        if (persisted && (event.type === "customer.subscription.deleted" || subscription.cancel_at_period_end)) {
          const end = subscription.items.data[0]?.current_period_end;
          await notify(organizationId, "SUBSCRIPTION_CANCELED", `cancel:${subscription.id}:${subscription.canceled_at ?? end ?? event.created}`, end ? new Date(end * 1000) : undefined);
        }
      }
    } else if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
      const invoice = event.data.object;
      const customerId = idOf(invoice.customer);
      const organizationId = customerId ? await organizationForCustomer(customerId) : null;
      if (organizationId && customerId) {
        const subscription = await latestSubscription(customerId);
        const persisted = subscription ? await persistStripeSubscription(organizationId, subscription, event.type === "invoice.paid" ? new Date(event.created * 1000) : undefined) : false;
        if (persisted && subscription && event.type === "invoice.paid") await sendPaymentConfirmation(organizationId, subscription);
        if (persisted && event.type === "invoice.payment_failed") await notify(organizationId, "PAYMENT_FAILED", `payment-failed:${invoice.id}`, subscription?.items.data[0]?.current_period_end ? new Date(subscription.items.data[0].current_period_end * 1000) : undefined);
      }
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    await releaseStripeEvent(event.id);
    console.error("Stripe webhook processing failed", error);
    return NextResponse.json({ error: "No fue posible procesar el evento" }, { status: 500 });
  }
}
