import { NextResponse } from "next/server";
import { z } from "zod";
import { requestPasswordReset, setPasswordResetFlow } from "@/lib/auth/password-recovery";
import { rateLimit } from "@/lib/security/rate-limit";
import { isSameOrigin } from "@/lib/security/request";

const schema = z.object({ email: z.email().transform((value) => value.trim().toLowerCase()) });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return NextResponse.redirect(new URL("/forgot-password?error=email", request.url), 303);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`password-reset:${ip}:${parsed.data.email}`, 5, 60 * 60_000).allowed) return NextResponse.redirect(new URL("/forgot-password?error=rate", request.url), 303);
  await setPasswordResetFlow(parsed.data.email);
  try {
    await requestPasswordReset(parsed.data.email);
  } catch (error) {
    console.error("Password recovery email could not be sent", error);
  }
  return NextResponse.redirect(new URL("/forgot-password?sent=1", request.url), 303);
}
