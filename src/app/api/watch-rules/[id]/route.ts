import { NextResponse } from "next/server";
import { z } from "zod";
import { hasActiveProductAccess } from "@/lib/billing/access";
import { deleteNameWatchRule } from "@/lib/parties/watch";
import { isSameOrigin } from "@/lib/security/request";
import { getSession } from "@/lib/security/session";

const idSchema = z.string().uuid();

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  if (!(await hasActiveProductAccess(session.organizationId, session.userId))) return NextResponse.json({ error: "Suscripción inactiva" }, { status: 402 });
  const parsed = idSchema.safeParse((await context.params).id);
  if (!parsed.success) return NextResponse.json({ error: "Regla inválida" }, { status: 400 });
  return (await deleteNameWatchRule(session.userId, parsed.data))
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "Regla no encontrada" }, { status: 404 });
}
