import { NextResponse } from "next/server";
import { z } from "zod";
import { monitoredCaseRefreshStatus } from "@/lib/product/repository";
import { getSession } from "@/lib/security/session";
import { hasActiveProductAccess } from "@/lib/billing/access";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Sesión no válida" }, { status: 401 });
  if (!(await hasActiveProductAccess(session.organizationId, session.userId))) return NextResponse.json({ ok: false, error: "Suscripción inactiva" }, { status: 402 });
  const parsed = z.string().uuid().safeParse((await context.params).id);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Expediente no válido" }, { status: 400 });
  const status = await monitoredCaseRefreshStatus(session.organizationId, parsed.data);
  if (!status) return NextResponse.json({ ok: false, error: "Expediente no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true, ...status }, { headers: { "Cache-Control": "no-store" } });
}
