import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/security/session";
import { createMonitoredCase } from "@/lib/product/repository";
import { FederalProvider, inferFederalCourtType } from "@/lib/providers/federal/provider";
import { JaliscoProvider } from "@/lib/providers/jalisco/provider";
import { StjJaliscoProvider } from "@/lib/providers/stj/provider";
import { normalizeCaseNumber } from "@/lib/domain/normalization";
import { verifySelectionOption } from "@/lib/security/selection-token";
import { hasActiveProductAccess } from "@/lib/billing/access";
import { isSameOrigin } from "@/lib/security/request";

const schema = z.object({
  jurisdiction: z.enum(["JALISCO", "STJ", "FEDERAL"]),
  circuit: z.string().max(20).optional(),
  circuitLabel: z.string().trim().max(180).optional(),
  court: z.string().min(1).max(60),
  courtLabel: z.string().trim().min(3).max(240),
  courtToken: z.string().min(20).max(100),
  number: z.string().min(3).max(40),
  caseType: z.string().trim().min(2).max(100),
  label: z.string().trim().max(120).optional(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url), 303);
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  if (!(await hasActiveProductAccess(session.organizationId, session.userId))) return NextResponse.redirect(new URL("/subscribe?error=subscription", request.url), 303);
  const form = await request.formData();
  const parsed = schema.safeParse(Object.fromEntries(form));
  const folders = z.array(z.string().uuid()).min(1).max(20).safeParse(form.getAll("folders"));
  if (!parsed.success || !folders.success) return NextResponse.redirect(new URL("/cases/new?error=validation", request.url), 303);
  try {
    const parsedNumber = normalizeCaseNumber(parsed.data.number);
    const courtScope = parsed.data.jurisdiction === "FEDERAL" ? `FEDERAL:${parsed.data.circuit}:court` : parsed.data.jurisdiction === "STJ" ? "STJ:court" : "JALISCO:court";
    if (!verifySelectionOption(courtScope, parsed.data.court, parsed.data.courtLabel, parsed.data.courtToken)) throw new Error("Órgano jurisdiccional no reconocido");
    if (parsed.data.jurisdiction === "FEDERAL") {
      if (!parsed.data.circuit) throw new Error("Circuito obligatorio");
      const provider = new FederalProvider();
      const id = await createMonitoredCase({
        organizationId: session.organizationId, userId: session.userId, jurisdiction: "FEDERAL",
        provider: provider.id, authorityName: provider.name, sourceUrl: "https://www.oaj.gob.mx/micrositios/dggj/paginas/serviciosTramites.htm?pageName=servicios%2FlistaSesion.htm",
        courtExternalId: parsed.data.court, courtName: parsed.data.courtLabel, circuitId: parsed.data.circuit, circuitName: parsed.data.circuitLabel ?? `Circuito ${parsed.data.circuit}`,
        courtType: inferFederalCourtType(parsed.data.courtLabel),
        caseNumber: parsed.data.number, caseType: parsed.data.caseType,
        folderIds: folders.data, label: parsed.data.label, monitorFrom: `${parsedNumber.year}-01-01`,
      });
      return NextResponse.redirect(new URL(`/cases/${id}?created=1`, request.url), 303);
    }
    const provider = parsed.data.jurisdiction === "STJ" ? new StjJaliscoProvider() : new JaliscoProvider();
    const id = await createMonitoredCase({
      organizationId: session.organizationId, userId: session.userId, jurisdiction: "JALISCO",
      provider: provider.id, authorityName: provider.name, sourceUrl: parsed.data.jurisdiction === "STJ" ? "https://consultas.stjjalisco.gob.mx/consultas/acuerdos" : "https://cjj.gob.mx/bulletin",
      courtExternalId: parsed.data.court, courtName: parsed.data.courtLabel, courtType: parsed.data.jurisdiction === "STJ" ? "STJ_CHAMBER" : undefined,
      caseNumber: parsed.data.number, caseType: parsed.data.caseType, folderIds: folders.data,
      label: parsed.data.label, monitorFrom: "1900-01-01",
    });
    return NextResponse.redirect(new URL(`/cases/${id}?created=1`, request.url), 303);
  } catch (error) {
    const target = new URL("/cases/new", request.url);
    target.searchParams.set("jurisdiction", parsed.data.jurisdiction);
    if (parsed.data.circuit) target.searchParams.set("circuit", parsed.data.circuit);
    target.searchParams.set("error", error instanceof Error ? "source" : "validation");
    return NextResponse.redirect(target, 303);
  }
}
