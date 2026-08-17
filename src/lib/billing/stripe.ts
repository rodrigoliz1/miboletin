import "server-only";
import Stripe from "stripe";
import { getBillingSummary, saveStripeCustomer, saveSubscription } from "@/lib/billing/repository";

let client: Stripe | null = null;
let validatedPriceId: string | null = null;

export function stripeClient(): Stripe {
  const apiKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!apiKey) throw new Error("STRIPE_NOT_CONFIGURED");
  client ??= new Stripe(apiKey, { maxNetworkRetries: 2, timeout: 30_000 });
  return client;
}

export function applicationUrl(): string {
  const value = process.env.APP_URL?.trim() || "http://localhost:3000";
  const parsed = new URL(value);
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") throw new Error("APP_URL debe usar HTTPS en producción");
  return parsed.origin;
}

export async function getOrCreateStripeCustomer(input: { organizationId: string; email: string; name: string; organizationName: string }) {
  const summary = await getBillingSummary(input.organizationId);
  if (summary.customerId) return summary.customerId;
  const customer = await stripeClient().customers.create({
    email: input.email,
    name: input.name,
    description: input.organizationName,
    metadata: { organizationId: input.organizationId },
  }, { idempotencyKey: `customer-${input.organizationId}` });
  return saveStripeCustomer(input.organizationId, customer.id);
}

export async function createSubscriptionCheckout(input: { organizationId: string; userId: string; email: string; name: string; organizationName: string }) {
  const priceId = process.env.STRIPE_PRICE_ID?.trim();
  if (!priceId) throw new Error("STRIPE_PRICE_NOT_CONFIGURED");
  if (validatedPriceId !== priceId) {
    const price = await stripeClient().prices.retrieve(priceId);
    if (!price.active || price.currency !== "mxn" || price.unit_amount !== 49_900 || price.type !== "recurring" || price.recurring?.interval !== "month" || price.recurring.interval_count !== 1) {
      throw new Error("STRIPE_PRICE_MUST_BE_499_MXN_MONTHLY");
    }
    validatedPriceId = priceId;
  }
  const customerId = await getOrCreateStripeCustomer(input);
  const session = await stripeClient().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: input.organizationId,
    line_items: [{ price: priceId, quantity: 1 }],
    locale: "es",
    success_url: `${applicationUrl()}/api/billing/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${applicationUrl()}/subscribe?checkout=canceled`,
    metadata: { organizationId: input.organizationId, userId: input.userId },
    subscription_data: { metadata: { organizationId: input.organizationId, userId: input.userId } },
  }, { idempotencyKey: `checkout-${input.organizationId}-${Math.floor(Date.now() / 600_000)}` });
  if (!session.url) throw new Error("STRIPE_CHECKOUT_URL_MISSING");
  return session.url;
}

export async function createCustomerPortal(organizationId: string) {
  const summary = await getBillingSummary(organizationId);
  if (!summary.customerId) throw new Error("STRIPE_CUSTOMER_NOT_FOUND");
  const session = await stripeClient().billingPortal.sessions.create({ customer: summary.customerId, return_url: `${applicationUrl()}/settings#billing` });
  return session.url;
}

function idOf(value: string | { id: string } | null | undefined): string | undefined {
  return typeof value === "string" ? value : value?.id;
}

export async function persistStripeSubscription(organizationId: string, subscription: Stripe.Subscription, paidAt?: Date) {
  const item = subscription.items.data[0];
  const price = item?.price;
  const configuredPrice = process.env.STRIPE_PRICE_ID?.trim();
  if (!price || !configuredPrice || price.id !== configuredPrice) return false;
  await saveSubscription({
    organizationId,
    subscriptionId: subscription.id,
    priceId: price?.id,
    status: subscription.status,
    currency: subscription.currency,
    unitAmount: price?.unit_amount ?? undefined,
    periodStart: item?.current_period_start ? new Date(item.current_period_start * 1000) : undefined,
    periodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : undefined,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : undefined,
    lastInvoiceId: idOf(subscription.latest_invoice),
    paidAt,
  });
  return true;
}

export async function synchronizeCheckoutSession(organizationId: string, sessionId: string) {
  const session = await stripeClient().checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
  if (session.client_reference_id !== organizationId || session.metadata?.organizationId !== organizationId) throw new Error("STRIPE_SESSION_SCOPE_MISMATCH");
  if (!session.customer) throw new Error("STRIPE_SESSION_CUSTOMER_MISSING");
  await saveStripeCustomer(organizationId, idOf(session.customer)!);
  const subscription = typeof session.subscription === "string"
    ? await stripeClient().subscriptions.retrieve(session.subscription)
    : session.subscription;
  if (!subscription || "deleted" in subscription) throw new Error("STRIPE_SUBSCRIPTION_MISSING");
  await persistStripeSubscription(organizationId, subscription, session.payment_status === "paid" ? new Date() : undefined);
  return { session, subscription };
}

export async function reconcileStripeSubscription(organizationId: string) {
  const summary = await getBillingSummary(organizationId);
  if (!summary.customerId) return null;
  const configuredPrice = process.env.STRIPE_PRICE_ID?.trim();
  if (!configuredPrice) throw new Error("STRIPE_PRICE_NOT_CONFIGURED");
  const subscriptions = await stripeClient().subscriptions.list({ customer: summary.customerId, status: "all", limit: 100 });
  const matching = subscriptions.data
    .filter((subscription) => subscription.items.data.some((item) => item.price.id === configuredPrice))
    .sort((a, b) => {
      const priority = (status: string) => status === "active" ? 3 : status === "trialing" ? 2 : 1;
      return priority(b.status) - priority(a.status) || b.created - a.created;
    });
  const subscription = matching[0];
  if (!subscription) return null;
  await persistStripeSubscription(organizationId, subscription);
  return subscription;
}
