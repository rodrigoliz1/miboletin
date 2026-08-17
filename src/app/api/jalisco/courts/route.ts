import { NextResponse } from "next/server";
import { JaliscoProvider } from "@/lib/providers/jalisco/provider";
import { getSession } from "@/lib/security/session";
import { hasActiveProductAccess } from "@/lib/billing/access";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  if (!(await hasActiveProductAccess(session.organizationId, session.userId))) return NextResponse.json({ error: "Suscripción inactiva" }, { status: 402 });
  try {
    const courts = await new JaliscoProvider().fetchCatalogs();
    return NextResponse.json(
      { source: "https://cjj.gob.mx/bulletin", retrievedAt: new Date().toISOString(), count: courts.length, courts },
      { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=21600" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: "No fue posible obtener el catálogo oficial.", detail: error instanceof Error ? error.message : undefined },
      { status: 502 },
    );
  }
}
