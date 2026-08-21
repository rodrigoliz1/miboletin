import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueueDeepSearch } from "@/lib/parties/deep-search";
import { isIsoDate } from "@/lib/product/query";
import { rateLimit } from "@/lib/security/rate-limit";
import { getSession } from "@/lib/security/session";

export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["BACKFILL", "RETRY_PERIOD", "REINDEX_COURT"]),
  provider: z.literal("jalisco-cjj"),
  courtExternalId: z.string().trim().min(1).max(60).optional(),
  from: z.string().refine(isIsoDate),
  to: z.string().refine(isIsoDate),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  if (!rateLimit(`admin-index:${session.userId}`, 10, 60_000).allowed) return NextResponse.json({ error: "Espera un momento" }, { status: 429 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.from > parsed.data.to) return NextResponse.json({ error: "Revisa el periodo y el órgano" }, { status: 400 });
  try {
    const job = await enqueueDeepSearch({
      organizationId: session.organizationId, userId: session.userId,
      query: `${parsed.data.action} ${parsed.data.provider} ${parsed.data.courtExternalId ?? "GLOBAL"}`,
      action: parsed.data.action,
      provider: parsed.data.provider, courtExternalId: parsed.data.courtExternalId,
      from: parsed.data.from, to: parsed.data.to,
    });
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible programar el backfill" }, { status: 500 });
  }
}
