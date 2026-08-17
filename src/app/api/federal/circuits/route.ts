import { NextResponse } from "next/server";
import { FederalProvider } from "@/lib/providers/federal/provider";
import { getSession } from "@/lib/security/session";
import { hasActiveProductAccess } from "@/lib/billing/access";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  if (!(await hasActiveProductAccess(session.organizationId, session.userId))) return NextResponse.json({ error: "Suscripción inactiva" }, { status: 402 });
  try {
    const circuits = await new FederalProvider().getCircuits();
    return NextResponse.json({ count: circuits.length, circuits, source: "PJF/OAJ Lista a sesión" }, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Fuente federal no disponible" }, { status: 502 });
  }
}
