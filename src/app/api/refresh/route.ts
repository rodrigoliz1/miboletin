import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/security/session";
import { refreshMonitoredCase, refreshOrganizationCases } from "@/lib/product/refresh";
import { tryMarkMonitoredCaseChecking } from "@/lib/product/repository";
import { hasActiveProductAccess } from "@/lib/billing/access";
import { isSameOrigin } from "@/lib/security/request";

const jsonSchema = z.object({ caseId: z.string().uuid().optional(), force: z.boolean().optional(), automatic: z.boolean().optional() });
export const maxDuration = 300;

function reportBackgroundError(error: unknown) {
  console.error("No fue posible completar la actualización en segundo plano", error);
}

export async function POST(request: Request) {
  const session = await getSession();
  const wantsJson = request.headers.get("accept")?.includes("application/json");
  if (!session) return wantsJson ? NextResponse.json({ ok: false, error: "Sesión no válida" }, { status: 401 }) : NextResponse.redirect(new URL("/login", request.url), 303);
  if (!isSameOrigin(request)) return NextResponse.json({ ok: false, error: "Origen no permitido" }, { status: 403 });
  if (!(await hasActiveProductAccess(session.organizationId, session.userId))) return wantsJson ? NextResponse.json({ ok: false, error: "Suscripción inactiva" }, { status: 402 }) : NextResponse.redirect(new URL("/subscribe?error=subscription", request.url), 303);
  try {
    if (request.headers.get("content-type")?.includes("application/json")) {
      const parsed = jsonSchema.safeParse(await request.json());
      if (!parsed.success) return NextResponse.json({ ok: false, error: "Solicitud inválida" }, { status: 400 });
      if (parsed.data.caseId) {
        const queued = await tryMarkMonitoredCaseChecking(session.organizationId, parsed.data.caseId, parsed.data.force);
        if (queued) after(() => refreshMonitoredCase(session.organizationId, parsed.data.caseId!, true).catch(reportBackgroundError));
        return NextResponse.json({ ok: true, queued, alreadyRunning: !queued }, { status: 202 });
      }
      after(() => refreshOrganizationCases(session.organizationId, parsed.data.automatic ? { force: false, limit: 6 } : { force: true }).catch(reportBackgroundError));
      return NextResponse.json({ ok: true, queued: true }, { status: 202 });
    }
    after(() => refreshOrganizationCases(session.organizationId, { force: true }).catch(reportBackgroundError));
    return NextResponse.redirect(new URL("/dashboard?refreshed=1", request.url), 303);
  } catch (error) {
    if (wantsJson) return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "No fue posible actualizar" }, { status: 502 });
    return NextResponse.redirect(new URL("/dashboard?refresh=failed", request.url), 303);
  }
}
