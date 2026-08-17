import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession } from "@/lib/security/session";
import { createAccount } from "@/lib/product/repository";
import { createSubscriptionCheckout } from "@/lib/billing/stripe";
import { billingIsConfigured } from "@/lib/billing/repository";
import { rateLimit } from "@/lib/security/rate-limit";
import { isSameOrigin } from "@/lib/security/request";

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  organization: z.string().trim().min(2).max(120),
  email: z.email().transform((value) => value.toLowerCase().trim()),
  password: z.string().min(12).max(128).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/),
});

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const form = await request.formData();
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return NextResponse.redirect(new URL("/register?error=validation", request.url), 303);
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`register:${forwarded}`, 5, 60 * 60_000).allowed) return NextResponse.redirect(new URL("/register?error=rate", request.url), 303);
  let account;
  try { account = await createAccount(parsed.data); } catch { return NextResponse.redirect(new URL("/register?error=account", request.url), 303); }
  await createSession({ userId: account.userId, email: account.email, name: account.name, role: account.role, organizationId: account.organizationId, organizationName: account.organizationName });
  if (billingIsConfigured() && process.env.E2E_TEST_MODE !== "1") {
    try {
      const checkout = await createSubscriptionCheckout({ organizationId: account.organizationId, userId: account.userId, email: account.email, name: account.name, organizationName: account.organizationName });
      return NextResponse.redirect(checkout, 303);
    } catch (error) {
      console.error("Registration checkout could not be created", error);
      return NextResponse.redirect(new URL("/subscribe?error=checkout", request.url), 303);
    }
  }
  return NextResponse.redirect(new URL("/onboarding", request.url), 303);
}
