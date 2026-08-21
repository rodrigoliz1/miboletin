import { NextResponse } from "next/server";
import { z } from "zod";
import { hasActiveProductAccess } from "@/lib/billing/access";
import { createNameWatchRule, listNameWatchRules } from "@/lib/parties/watch";
import { isSameOrigin } from "@/lib/security/request";
import { getSession } from "@/lib/security/session";

const schema = z.object({ kind: z.enum(["PERSON", "COMPANY"]), value: z.string().trim().min(3).max(180), matchMode: z.enum(["EXACT", "FLEXIBLE"]).default("FLEXIBLE") });

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  if (!(await hasActiveProductAccess(session.organizationId, session.userId))) return NextResponse.json({ error: "Suscripción inactiva" }, { status: 402 });
  return NextResponse.json({ rules: await listNameWatchRules(session.userId) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  if (!(await hasActiveProductAccess(session.organizationId, session.userId))) return NextResponse.json({ error: "Suscripción inactiva" }, { status: 402 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos de vigilancia inválidos" }, { status: 400 });
  const id = await createNameWatchRule({ userId: session.userId, ...parsed.data });
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
