import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/security/session";
import { createFolder } from "@/lib/product/repository";
import { hasActiveProductAccess } from "@/lib/billing/access";
import { isSameOrigin } from "@/lib/security/request";

const schema = z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(240).optional() });

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url), 303);
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  if (!(await hasActiveProductAccess(session.organizationId))) return NextResponse.redirect(new URL("/subscribe?error=subscription", request.url), 303);
  const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return NextResponse.redirect(new URL("/cases?error=folder", request.url), 303);
  try {
    const folder = await createFolder({ organizationId: session.organizationId, userId: session.userId, ...parsed.data });
    return NextResponse.redirect(new URL(`/cases?folder=${folder}`, request.url), 303);
  } catch {
    return NextResponse.redirect(new URL("/cases?error=database", request.url), 303);
  }
}
