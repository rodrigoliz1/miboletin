import { NextResponse } from "next/server";
import { z } from "zod";
import { hasActiveProductAccess } from "@/lib/billing/access";
import { updateMonitoredCaseManualParties } from "@/lib/product/repository";
import { isSameOrigin } from "@/lib/security/request";
import { getSession } from "@/lib/security/session";

const caseIdSchema = z.string().uuid();
const partiesSchema = z.object({
  plaintiff: z.string().trim().max(500),
  defendant: z.string().trim().max(500),
}).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Sesión no válida" }, { status: 401 });
  if (!(await hasActiveProductAccess(session.organizationId, session.userId))) return NextResponse.json({ ok: false, error: "Suscripción inactiva" }, { status: 402 });
  if (!isSameOrigin(request)) return NextResponse.json({ ok: false, error: "Origen no permitido" }, { status: 403 });

  const [caseId, body] = await Promise.all([
    caseIdSchema.safeParseAsync((await context.params).id),
    request.json().then((value) => partiesSchema.safeParse(value)).catch(() => partiesSchema.safeParse(null)),
  ]);
  if (!caseId.success || !body.success) return NextResponse.json({ ok: false, error: "Datos de las partes no válidos" }, { status: 400 });

  try {
    const updated = await updateMonitoredCaseManualParties({
      organizationId: session.organizationId,
      userId: session.userId,
      monitoredCaseId: caseId.data,
      plaintiff: body.data.plaintiff,
      defendant: body.data.defendant,
    });
    if (!updated) return NextResponse.json({ ok: false, error: "El asunto federal no existe o ya no está activo" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Federal case manual parties could not be updated", { caseId: caseId.data, error });
    return NextResponse.json({ ok: false, error: "No fue posible guardar los nombres de las partes" }, { status: 500 });
  }
}
