import { NextResponse } from "next/server";
import { z } from "zod";
import { decodeSearchResult } from "@/lib/product/search-payload";
import { createMonitoredCase } from "@/lib/product/repository";
import { normalizeCaseNumber } from "@/lib/domain/normalization";
import { getSession } from "@/lib/security/session";
import { isSameOrigin } from "@/lib/security/request";
import { hasActiveProductAccess } from "@/lib/billing/access";

const baseSchema = z.object({ payload: z.string().min(20).max(3000), token: z.string().min(20).max(200) });

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url), 303);
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  if (!(await hasActiveProductAccess(session.organizationId, session.userId))) return NextResponse.redirect(new URL("/subscribe?error=subscription", request.url), 303);
  const form = await request.formData();
  const parsed = baseSchema.safeParse(Object.fromEntries(form));
  const folders = z.array(z.string().uuid()).min(1).max(20).safeParse(form.getAll("folders"));
  if (!parsed.success || !folders.success) return NextResponse.redirect(new URL("/search?error=selection", request.url), 303);
  const result = decodeSearchResult(parsed.data.payload, parsed.data.token, session.organizationId);
  if (!result || (result.jurisdiction === "JALISCO") !== (result.provider === "jalisco-cjj")) return NextResponse.redirect(new URL("/search?error=selection", request.url), 303);
  try {
    const parsedNumber = normalizeCaseNumber(result.caseNumber);
    const id = await createMonitoredCase({
      organizationId: session.organizationId, userId: session.userId, jurisdiction: result.jurisdiction,
      provider: result.provider,
      authorityName: result.jurisdiction === "JALISCO" ? "Poder Judicial del Estado de Jalisco" : "Poder Judicial de la Federación",
      sourceUrl: result.jurisdiction === "JALISCO" ? "https://cjj.gob.mx/bulletin" : "https://www.dgej.cjf.gob.mx/SiseInternet",
      courtExternalId: result.courtExternalId, courtName: result.courtName, courtType: result.courtType,
      circuitId: result.circuitId, circuitName: result.circuitName, caseNumber: result.caseNumber, caseType: result.caseType,
      folderIds: folders.data, monitorFrom: result.jurisdiction === "JALISCO" ? "1900-01-01" : `${parsedNumber.year}-01-01`,
    });
    return NextResponse.redirect(new URL(`/cases/${id}?created=1`, request.url), 303);
  } catch {
    return NextResponse.redirect(new URL("/search?error=add", request.url), 303);
  }
}
