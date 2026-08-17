import { NextResponse } from "next/server";
import { z } from "zod";
import { FederalProvider } from "@/lib/providers/federal/provider";
import { getSession } from "@/lib/security/session";
import { hasActiveProductAccess } from "@/lib/billing/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  if (!(await hasActiveProductAccess(session.organizationId, session.userId))) return NextResponse.json({ error: "Suscripción inactiva" }, { status: 402 });
  const circuit = z.string().regex(/^\d{1,3}$/).safeParse(new URL(request.url).searchParams.get("circuit"));
  if (!circuit.success) return NextResponse.json({ error: "Circuito inválido" }, { status: 400 });
  try {
    const courts = await new FederalProvider().getCourts(circuit.data);
    return NextResponse.json({ count: courts.length, courts }, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Fuente federal no disponible" }, { status: 502 });
  }
}
