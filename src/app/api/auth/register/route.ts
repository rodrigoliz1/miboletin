import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession } from "@/lib/security/session";
import { createAccount } from "@/lib/product/repository";
import { rateLimit } from "@/lib/security/rate-limit";
import { isSameOrigin } from "@/lib/security/request";
import { requestEmailVerification } from "@/lib/auth/email-verification";

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
  if (process.env.E2E_TEST_MODE !== "1" && !rateLimit(`register:${forwarded}`, 5, 60 * 60_000).allowed) return NextResponse.redirect(new URL("/register?error=rate", request.url), 303);
  let account;
  try { account = await createAccount(parsed.data); } catch { return NextResponse.redirect(new URL("/register?error=account", request.url), 303); }
  await createSession({ userId: account.userId, email: account.email, name: account.name, role: account.role, organizationId: account.organizationId, organizationName: account.organizationName, sessionVersion: account.sessionVersion });
  try {
    await requestEmailVerification(account.userId);
    return NextResponse.redirect(new URL("/verify-email?sent=1", request.url), 303);
  } catch (error) {
    console.error("Verification email could not be sent", error);
    return NextResponse.redirect(new URL("/verify-email?error=delivery", request.url), 303);
  }
}
