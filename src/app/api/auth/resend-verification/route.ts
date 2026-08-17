import { NextResponse } from "next/server";
import { getSession } from "@/lib/security/session";
import { isSameOrigin } from "@/lib/security/request";
import { requestEmailVerification } from "@/lib/auth/email-verification";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url), 303);
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  try {
    await requestEmailVerification(session.userId);
    return NextResponse.redirect(new URL("/verify-email?sent=1", request.url), 303);
  } catch (error) {
    const code = error instanceof Error && error.message === "OTP_COOLDOWN" ? "cooldown" : error instanceof Error && error.message === "OTP_RATE_LIMIT" ? "rate" : "delivery";
    return NextResponse.redirect(new URL(`/verify-email?error=${code}`, request.url), 303);
  }
}
