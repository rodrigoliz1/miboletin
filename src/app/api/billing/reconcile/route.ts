import { NextResponse } from "next/server";
import { reconcileStripeSubscription } from "@/lib/billing/stripe";
import { sendPaymentConfirmation } from "@/lib/billing/notifications";
import { getSession } from "@/lib/security/session";
import { isSameOrigin } from "@/lib/security/request";
import { isEmailVerified } from "@/lib/auth/email-verification";
import { rateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Sesión no válida" }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ ok: false, error: "Origen no permitido" }, { status: 403 });
  if (!(await isEmailVerified(session.userId))) return NextResponse.json({ ok: false, error: "Correo no verificado" }, { status: 403 });
  if (!rateLimit(`billing-reconcile:${session.organizationId}`, 8, 10 * 60_000).allowed) return NextResponse.json({ ok: false, error: "Espera antes de volver a comprobar" }, { status: 429 });
  try {
    const subscription = await reconcileStripeSubscription(session.organizationId);
    const active = subscription?.status === "active" || subscription?.status === "trialing";
    if (active && subscription) await sendPaymentConfirmation(session.organizationId, subscription).catch((error) => console.error("Payment confirmation email failed", error));
    return NextResponse.json({ ok: true, active, status: subscription?.status ?? "not_found" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Stripe reconciliation failed", error);
    return NextResponse.json({ ok: false, error: "No fue posible comprobar el pago" }, { status: 502 });
  }
}
