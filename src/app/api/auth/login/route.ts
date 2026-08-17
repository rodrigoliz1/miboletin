import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession } from "@/lib/security/session";
import { rateLimit } from "@/lib/security/rate-limit";
import { findAccountByEmail } from "@/lib/product/repository";
import { isSameOrigin } from "@/lib/security/request";

const loginSchema = z.object({ email: z.email().transform((value) => value.toLowerCase().trim()), password: z.string().min(8).max(128) });
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const form = await request.formData();
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
  const email = parsed.success ? parsed.data.email : "invalid";
  const limit = rateLimit(`login:${email}`, 8, 15 * 60_000);
  if (!limit.allowed) return NextResponse.redirect(new URL("/login?error=rate", request.url), 303);
  let account = null;
  try { if (parsed.success) account = await findAccountByEmail(parsed.data.email); } catch { return NextResponse.redirect(new URL("/login?error=database", request.url), 303); }
  if (!parsed.success || !account || !(await compare(parsed.data.password, account.passwordHash))) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return NextResponse.redirect(new URL("/login?error=credentials", request.url), 303);
  }
  await createSession({ userId: account.userId, email: account.email, name: account.name, role: account.role, organizationId: account.organizationId, organizationName: account.organizationName });
  return NextResponse.redirect(new URL("/dashboard", request.url), 303);
}
