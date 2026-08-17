import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/security/session";
import { deleteAssistantConversation, getAssistantConversation } from "@/lib/assistant/repository";
import { hasActiveProductAccess } from "@/lib/billing/access";

const idSchema = z.string().uuid();

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Sesión no válida" }, { status: 401 });
  if (!(await hasActiveProductAccess(session.organizationId))) return NextResponse.json({ ok: false, error: "Suscripción inactiva" }, { status: 402 });
  const parsed = idSchema.safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Conversación no válida" }, { status: 400 });
  try {
    const result = await getAssistantConversation(session.organizationId, session.userId, parsed.data);
    if (!result) return NextResponse.json({ ok: false, error: "Conversación no encontrada" }, { status: 404 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Assistant conversation could not be loaded", error);
    return NextResponse.json({ ok: false, error: "No fue posible abrir la conversación." }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Sesión no válida" }, { status: 401 });
  if (!(await hasActiveProductAccess(session.organizationId))) return NextResponse.json({ ok: false, error: "Suscripción inactiva" }, { status: 402 });
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "Origen no permitido" }, { status: 403 });
  const parsed = idSchema.safeParse((await params).id);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Conversación no válida" }, { status: 400 });
  try {
    const deleted = await deleteAssistantConversation(session.organizationId, session.userId, parsed.data);
    if (!deleted) return NextResponse.json({ ok: false, error: "Conversación no encontrada" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Assistant conversation could not be deleted", error);
    return NextResponse.json({ ok: false, error: "No fue posible eliminar la conversación." }, { status: 500 });
  }
}
