import { db } from "@/lib/db/client";

export interface BillingSummary {
  configured: boolean;
  customerId?: string;
  subscriptionId?: string;
  priceId?: string;
  status: string;
  currency?: string;
  unitAmount?: number;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  canceledAt?: string;
  lastPaymentAt?: string;
  accessAllowed: boolean;
}

function iso(value: unknown): string | undefined {
  return value ? new Date(String(value)).toISOString() : undefined;
}

export function billingIsConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim() && process.env.STRIPE_PRICE_ID?.trim());
}

export async function getBillingSummary(organizationId: string): Promise<BillingSummary> {
  const configured = billingIsConfigured();
  const rows = await db()`
    SELECT bc.stripe_customer_id, bs.stripe_subscription_id, bs.stripe_price_id,
           bs.status, bs.currency, bs.unit_amount, bs.current_period_start,
           bs.current_period_end, bs.cancel_at_period_end, bs.canceled_at, bs.last_payment_at
    FROM organizations o
    LEFT JOIN billing_customers bc ON bc.organization_id = o.id
    LEFT JOIN billing_subscriptions bs ON bs.organization_id = o.id
    WHERE o.id = ${organizationId}
    LIMIT 1
  `;
  const row = rows[0];
  const status = String(row?.status ?? "inactive");
  const periodEnd = iso(row?.current_period_end);
  const periodValid = !periodEnd || new Date(periodEnd).valueOf() > Date.now();
  const paid = (status === "active" || status === "trialing") && periodValid;
  const localBypass = process.env.NODE_ENV !== "production" && !configured;
  const testBypass = process.env.E2E_TEST_MODE === "1" && process.env.E2E_FORCE_BILLING_GATE !== "1";
  return {
    configured,
    customerId: row?.stripe_customer_id ?? undefined,
    subscriptionId: row?.stripe_subscription_id ?? undefined,
    priceId: row?.stripe_price_id ?? undefined,
    status,
    currency: row?.currency ?? undefined,
    unitAmount: row?.unit_amount === null || row?.unit_amount === undefined ? undefined : Number(row.unit_amount),
    currentPeriodStart: iso(row?.current_period_start),
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: Boolean(row?.cancel_at_period_end),
    canceledAt: iso(row?.canceled_at),
    lastPaymentAt: iso(row?.last_payment_at),
    accessAllowed: paid || localBypass || testBypass,
  };
}

export async function saveStripeCustomer(organizationId: string, customerId: string): Promise<string> {
  const [row] = await db()`
    INSERT INTO billing_customers (organization_id, stripe_customer_id)
    VALUES (${organizationId}, ${customerId})
    ON CONFLICT (organization_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id, updated_at = now()
    RETURNING stripe_customer_id
  `;
  return row.stripe_customer_id;
}

export async function organizationForStripeCustomer(customerId: string): Promise<string | null> {
  const rows = await db()`SELECT organization_id FROM billing_customers WHERE stripe_customer_id = ${customerId} LIMIT 1`;
  return rows[0]?.organization_id ?? null;
}

export async function saveSubscription(input: {
  organizationId: string;
  subscriptionId: string;
  priceId?: string;
  status: string;
  currency?: string;
  unitAmount?: number;
  periodStart?: Date;
  periodEnd?: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt?: Date;
  lastInvoiceId?: string;
  paidAt?: Date;
}) {
  await db().begin(async (tx) => {
    await tx`
      INSERT INTO billing_subscriptions (
        organization_id, stripe_subscription_id, stripe_price_id, status, currency,
        unit_amount, current_period_start, current_period_end, cancel_at_period_end,
        canceled_at, last_invoice_id, last_payment_at
      ) VALUES (
        ${input.organizationId}, ${input.subscriptionId}, ${input.priceId ?? null}, ${input.status}, ${input.currency ?? null},
        ${input.unitAmount ?? null}, ${input.periodStart ?? null}, ${input.periodEnd ?? null}, ${input.cancelAtPeriodEnd},
        ${input.canceledAt ?? null}, ${input.lastInvoiceId ?? null}, ${input.paidAt ?? null}
      )
      ON CONFLICT (organization_id) DO UPDATE SET
        stripe_subscription_id = EXCLUDED.stripe_subscription_id,
        stripe_price_id = EXCLUDED.stripe_price_id,
        status = EXCLUDED.status,
        currency = EXCLUDED.currency,
        unit_amount = EXCLUDED.unit_amount,
        current_period_start = EXCLUDED.current_period_start,
        current_period_end = EXCLUDED.current_period_end,
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        canceled_at = EXCLUDED.canceled_at,
        last_invoice_id = COALESCE(EXCLUDED.last_invoice_id, billing_subscriptions.last_invoice_id),
        last_payment_at = COALESCE(EXCLUDED.last_payment_at, billing_subscriptions.last_payment_at),
        updated_at = now()
    `;
    await tx`UPDATE organizations SET plan = ${input.status === "active" || input.status === "trialing" ? "PRO" : "FREE"} WHERE id = ${input.organizationId}`;
  });
}

export async function claimStripeEvent(eventId: string, eventType: string, livemode: boolean): Promise<boolean> {
  const rows = await db()`
    INSERT INTO billing_events (stripe_event_id, event_type, livemode)
    VALUES (${eventId}, ${eventType}, ${livemode})
    ON CONFLICT DO NOTHING
    RETURNING stripe_event_id
  `;
  return rows.length > 0;
}

export async function releaseStripeEvent(eventId: string) {
  await db()`DELETE FROM billing_events WHERE stripe_event_id = ${eventId}`;
}

export async function billingContact(organizationId: string) {
  const rows = await db()`
    SELECT u.id, u.email, u.name, o.name AS organization_name
    FROM organizations o
    JOIN memberships m ON m.organization_id = o.id
    JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
    WHERE o.id = ${organizationId}
    ORDER BY CASE m.role WHEN 'OWNER' THEN 1 WHEN 'ADMIN' THEN 2 ELSE 3 END, m.created_at
    LIMIT 1
  `;
  if (!rows.length) return null;
  return { userId: rows[0].id as string, email: rows[0].email as string, name: rows[0].name as string, organizationName: rows[0].organization_name as string };
}
