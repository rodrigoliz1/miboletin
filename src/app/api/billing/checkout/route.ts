import { NextResponse } from "next/server";
import { createSubscriptionCheckout } from "@/lib/billing/stripe";
import { getBillingSummary } from "@/lib/billing/repository";
import { getSession } from "@/lib/security/session";
import { isSameOrigin } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login?next=subscribe", request.url), 303);
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  if (session.role !== "OWNER" && session.role !== "ADMIN") return NextResponse.json({ error: "Sólo un administrador puede gestionar la suscripción" }, { status: 403 });
  if (!rateLimit(`billing:${session.organizationId}`, 5, 60_000).allowed) return NextResponse.redirect(new URL("/subscribe?error=rate", request.url), 303);
  try {
    const summary = await getBillingSummary(session.organizationId);
    if (summary.accessAllowed && summary.configured) return NextResponse.redirect(new URL("/settings#billing", request.url), 303);
    const url = await createSubscriptionCheckout({ organizationId: session.organizationId, userId: session.userId, email: session.email, name: session.name, organizationName: session.organizationName });
    return NextResponse.redirect(url, 303);
  } catch (error) {
    console.error("Stripe Checkout could not be created", error);
    return NextResponse.redirect(new URL("/subscribe?error=checkout", request.url), 303);
  }
}

