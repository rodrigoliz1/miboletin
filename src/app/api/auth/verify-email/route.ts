import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyEmailCode } from "@/lib/auth/email-verification";
import { getSession } from "@/lib/security/session";
import { isSameOrigin } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";

const schema = z.object({ code: z.string().trim().regex(/^\d{6}$/) });

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url), 303);
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  if (!rateLimit(`otp-verify:${session.userId}`, 10, 15 * 60_000).allowed) return NextResponse.redirect(new URL("/verify-email?error=rate", request.url), 303);
  const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return NextResponse.redirect(new URL("/verify-email?error=invalid", request.url), 303);
  const result = await verifyEmailCode(session.userId, parsed.data.code);
  if (result === "VERIFIED" || result === "ALREADY_VERIFIED") return NextResponse.redirect(new URL("/dashboard?verified=1", request.url), 303);
  const error = result === "EXPIRED" ? "expired" : result === "LOCKED" ? "locked" : "invalid";
  return NextResponse.redirect(new URL(`/verify-email?error=${error}`, request.url), 303);
}
