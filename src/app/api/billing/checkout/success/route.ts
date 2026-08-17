import { NextResponse } from "next/server";
import { z } from "zod";
import { synchronizeCheckoutSession } from "@/lib/billing/stripe";
import { sendPaymentConfirmation } from "@/lib/billing/notifications";
import { getSession } from "@/lib/security/session";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url), 303);
  const id = z.string().startsWith("cs_").max(255).safeParse(new URL(request.url).searchParams.get("session_id"));
  if (!id.success) return NextResponse.redirect(new URL("/subscribe?error=session", request.url), 303);
  try {
    const { subscription } = await synchronizeCheckoutSession(session.organizationId, id.data);
    await sendPaymentConfirmation(session.organizationId, subscription).catch((error) => console.error("Payment confirmation email failed", error));
    return NextResponse.redirect(new URL("/dashboard?subscription=active", request.url), 303);
  } catch (error) {
    console.error("Stripe Checkout could not be synchronized", error);
    return NextResponse.redirect(new URL("/subscribe?error=session", request.url), 303);
  }
}
