import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteMonitoredCase, setMonitoredCaseFolders } from "@/lib/product/repository";
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

const folderSchema = z.object({ folderIds: z.array(z.string().uuid()).min(1).max(20) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Sesión no válida" }, { status: 401 });
  if (!(await hasActiveProductAccess(session.organizationId, session.userId))) return NextResponse.json({ ok: false, error: "Suscripción inactiva" }, { status: 402 });
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "Origen no permitido" }, { status: 403 });
  const caseId = z.string().uuid().safeParse((await context.params).id);
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const parsed = folderSchema.safeParse(body);
  if (!caseId.success || !parsed.success) return NextResponse.json({ ok: false, error: "Selección de carpetas no válida" }, { status: 400 });
  try {
    const result = await setMonitoredCaseFolders({
      organizationId: session.organizationId,
      userId: session.userId,
      monitoredCaseId: caseId.data,
      folderIds: parsed.data.folderIds,
    });
    if (!result) return NextResponse.json({ ok: false, error: "El asunto no existe o ya no está activo" }, { status: 404 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Monitored case folders could not be updated", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "No fue posible actualizar las carpetas" }, { status: 400 });
  }
}
