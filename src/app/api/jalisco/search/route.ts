import { NextResponse } from "next/server";
import { z } from "zod";
import { JaliscoProvider } from "@/lib/providers/jalisco/provider";
import { getSession } from "@/lib/security/session";
import { hasActiveProductAccess } from "@/lib/billing/access";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  court: z.string().trim().min(2).max(20),
  expediente: z.string().trim().min(3).max(40),
});

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  if (!(await hasActiveProductAccess(session.organizationId, session.userId))) return NextResponse.json({ error: "Suscripción inactiva" }, { status: 402 });
  const url = new URL(request.url);
  const query = querySchema.safeParse({
    court: url.searchParams.get("court"),
    expediente: url.searchParams.get("expediente"),
  });
  if (!query.success) {
    return NextResponse.json({ error: "Indica un órgano y un número de expediente válidos." }, { status: 400 });
  }
  try {
    const result = await new JaliscoProvider().searchCase(query.data.expediente, query.data.court);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No fue posible consultar el boletín oficial.";
    const status = /formato|reconocido/i.test(message) ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
