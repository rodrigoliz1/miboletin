import { NextResponse } from "next/server";
import { z } from "zod";
import { hasActiveProductAccess } from "@/lib/billing/access";
import { enqueueDeepSearch, getDeepSearchJob, processDeepSearchJob } from "@/lib/parties/deep-search";
import { isIsoDate } from "@/lib/product/query";
import { rateLimit } from "@/lib/security/rate-limit";
import { getSession } from "@/lib/security/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const optionalDate = z.string().refine(isIsoDate, "Fecha inválida").optional();
const startSchema = z.object({
  query: z.string().trim().min(3).max(180),
  provider: z.enum(["jalisco-cjj", "jalisco-stj-chambers", "federal-pjf-session-lists"]).optional(),
  jurisdiction: z.enum(["JALISCO", "FEDERAL"]).optional(),
  courtExternalId: z.string().trim().min(1).max(60).optional(),
  from: optionalDate,
  to: optionalDate,
  currentResults: z.number().int().min(0).max(1_000_000).default(0),
});
const stepSchema = z.object({ jobId: z.string().uuid(), maxUnits: z.number().int().min(1).max(5).default(2) });

async function authorizedSession() {
  const session = await getSession();
  if (!session) return null;
  if (!(await hasActiveProductAccess(session.organizationId, session.userId))) return null;
  return session;
}

export async function POST(request: Request) {
  const session = await authorizedSession();
  if (!session) return NextResponse.json({ error: "Acceso no disponible" }, { status: 401 });
  if (!rateLimit(`party-deep-start:${session.userId}`, 6, 60_000).allowed) return NextResponse.json({ error: "Espera un momento antes de iniciar otra ampliación" }, { status: 429 });
  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Revisa el nombre y el periodo" }, { status: 400 });
  if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) return NextResponse.json({ error: "El periodo no es válido" }, { status: 400 });
  try {
    const job = await enqueueDeepSearch({ organizationId: session.organizationId, userId: session.userId, ...parsed.data });
    return NextResponse.json({ job }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible iniciar la búsqueda ampliada" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await authorizedSession();
  if (!session) return NextResponse.json({ error: "Acceso no disponible" }, { status: 401 });
  if (!rateLimit(`party-deep-step:${session.userId}`, 20, 60_000).allowed) return NextResponse.json({ error: "La búsqueda ampliada continuará en segundo plano" }, { status: 429 });
  const parsed = stepSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Trabajo no válido" }, { status: 400 });
  const owned = await getDeepSearchJob(session.organizationId, parsed.data.jobId);
  if (!owned) return NextResponse.json({ error: "Trabajo no encontrado" }, { status: 404 });
  const job = await processDeepSearchJob(owned.id, parsed.data.maxUnits);
  return NextResponse.json({ job }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request) {
  const session = await authorizedSession();
  if (!session) return NextResponse.json({ error: "Acceso no disponible" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Trabajo no válido" }, { status: 400 });
  const job = await getDeepSearchJob(session.organizationId, id);
  return job ? NextResponse.json({ job }, { headers: { "Cache-Control": "private, no-store" } }) : NextResponse.json({ error: "Trabajo no encontrado" }, { status: 404 });
}
