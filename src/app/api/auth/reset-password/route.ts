import { NextResponse } from "next/server";
import { z } from "zod";
import { clearPasswordResetFlow, getPasswordResetFlow, resetPassword } from "@/lib/auth/password-recovery";
import { rateLimit } from "@/lib/security/rate-limit";
import { isSameOrigin } from "@/lib/security/request";

const schema = z.object({
  code: z.string().trim().regex(/^\d{6}$/),
  password: z.string().min(12).max(128).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/),
  confirmation: z.string().min(12).max(128),
}).refine((value) => value.password === value.confirmation, { path: ["confirmation"] });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const email = await getPasswordResetFlow();
  if (!email) return NextResponse.redirect(new URL("/forgot-password?error=expired", request.url), 303);
  if (!rateLimit(`password-reset-verify:${email}`, 10, 15 * 60_000).allowed) return NextResponse.redirect(new URL("/forgot-password?sent=1&error=rate", request.url), 303);
  const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return NextResponse.redirect(new URL("/forgot-password?sent=1&error=password", request.url), 303);
  const result = await resetPassword(email, parsed.data.code, parsed.data.password);
  if (result === "RESET") {
    await clearPasswordResetFlow();
    return NextResponse.redirect(new URL("/login?reset=1", request.url), 303);
  }
  const error = result === "EXPIRED" || result === "NOT_FOUND" ? "expired" : result === "LOCKED" ? "locked" : "code";
  return NextResponse.redirect(new URL(`/forgot-password?sent=1&error=${error}`, request.url), 303);
}
