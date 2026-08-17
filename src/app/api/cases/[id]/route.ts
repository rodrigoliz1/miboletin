import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteMonitoredCase } from "@/lib/product/repository";
import { getSession } from "@/lib/security/session";
import { hasActiveProductAccess } from "@/lib/billing/access";

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Sesión no válida" }, { status: 401 });
  if (!(await hasActiveProductAccess(session.organizationId, session.userId))) return NextResponse.json({ ok: false, error: "Suscripción inactiva" }, { status: 402 });
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "Origen no permitido" }, { status: 403 });
  const parsed = z.string().uuid().safeParse((await context.params).id);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Expediente no válido" }, { status: 400 });
  try {
    const deleted = await deleteMonitoredCase(session.organizationId, session.userId, parsed.data);
    if (!deleted) return NextResponse.json({ ok: false, error: "El asunto ya no está activo o no existe" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Monitored case could not be deleted", error);
    return NextResponse.json({ ok: false, error: "No fue posible eliminar el asunto" }, { status: 500 });
  }
}
