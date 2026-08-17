import { NextResponse } from "next/server";
import { getPasswordResetFlow, requestPasswordReset } from "@/lib/auth/password-recovery";
import { isSameOrigin } from "@/lib/security/request";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const email = await getPasswordResetFlow();
  if (!email) return NextResponse.redirect(new URL("/forgot-password?error=expired", request.url), 303);
  try {
    await requestPasswordReset(email);
    return NextResponse.redirect(new URL("/forgot-password?sent=1&resent=1", request.url), 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = message === "RESET_COOLDOWN" ? "cooldown" : message === "RESET_RATE_LIMIT" ? "rate" : "delivery";
    return NextResponse.redirect(new URL(`/forgot-password?sent=1&error=${code}`, request.url), 303);
  }
}
