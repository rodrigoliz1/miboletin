import { NextResponse } from "next/server";
import { z } from "zod";
import { hasActiveProductAccess } from "@/lib/billing/access";
import { searchParties } from "@/lib/parties/search";
import { isIsoDate } from "@/lib/product/query";
import { rateLimit } from "@/lib/security/rate-limit";
import { getSession } from "@/lib/security/session";

export const dynamic = "force-dynamic";

const optionalDate = z.string().refine(isIsoDate, "Fecha inválida").optional();
const schema = z.object({
  q: z.string().trim().min(2).max(180),
  jurisdiction: z.enum(["JALISCO", "FEDERAL"]).optional(),
  provider: z.enum(["jalisco-cjj", "jalisco-stj-chambers", "federal-pjf-session-lists"]).optional(),
  court: z.string().trim().min(1).max(60).optional(),
  matter: z.string().trim().min(2).max(100).optional(),
  partyType: z.enum(["PERSON", "COMPANY", "AUTHORITY", "UNKNOWN"]).optional(),
  role: z.string().trim().min(2).max(80).optional(),
  from: optionalDate,
  to: optionalDate,
  resultType: z.enum(["DIRECT", "RELATED"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(50).default(20),
});

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  if (!(await hasActiveProductAccess(session.organizationId, session.userId))) return NextResponse.json({ error: "Suscripción inactiva" }, { status: 402 });
  if (!rateLimit(`party-search:${session.userId}`, 40, 60_000).allowed) return NextResponse.json({ error: "Demasiadas búsquedas. Espera un momento." }, { status: 429 });
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Revisa el nombre y los filtros de búsqueda" }, { status: 400 });
  if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) return NextResponse.json({ error: "La fecha inicial no puede ser posterior a la final" }, { status: 400 });
  try {
    const { q, ...filters } = parsed.data;
    const response = await searchParties({ organizationId: session.organizationId, query: q, ...filters });
    return NextResponse.json(response, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return NextResponse.json({ error: "No fue posible consultar el índice judicial" }, { status: 500 });
  }
}
