import { NextResponse } from "next/server";
import { z } from "zod";
import { createReportPdf } from "@/lib/reports/pdf";
import { listJudicialSearchMovements, searchJudicialCases } from "@/lib/product/repository";
import { formatGuadalajaraDateTime } from "@/lib/product/query";
import { getSession } from "@/lib/security/session";
import { hasActiveProductAccess } from "@/lib/billing/access";
import { verifiedNotebookLabel } from "@/lib/product/judicial-display";

export const maxDuration = 45;

const schema = z.object({
  scope: z.enum(["JALISCO", "FEDERAL", "GENERAL"]),
  mode: z.enum(["CASE", "PARTY"]),
  side: z.enum(["plaintiff", "defendant", "both"]).default("both"),
  q: z.string().trim().min(2).max(180),
  detail: z.enum(["simple", "rigorous"]),
});

function day(value?: string) {
  return value ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)) : "No publicada";
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url), 303);
  if (!(await hasActiveProductAccess(session.organizationId, session.userId))) return NextResponse.redirect(new URL("/subscribe?error=subscription", request.url), 303);
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Criterios de búsqueda inválidos" }, { status: 400 });
  let results;
  try {
    results = await searchJudicialCases({ organizationId: session.organizationId, query: parsed.data.q, mode: parsed.data.mode, scope: parsed.data.scope, side: parsed.data.side, limit: 200 });
  } catch {
    return NextResponse.json({ error: "No fue posible preparar el informe" }, { status: 400 });
  }
  const movements = parsed.data.detail === "rigorous" ? await listJudicialSearchMovements(results.map((result) => result.caseId)) : [];
  const total = results.length;
  const build = (result: (typeof results)[number], index: number) => {
    const agreements = movements.filter((movement) => movement.caseId === result.caseId);
    const body = parsed.data.detail === "rigorous"
      ? agreements.map((movement, movementIndex) => {
        const notebook = verifiedNotebookLabel(movement.notebook, movement.officialText);
        return `${agreements.length - movementIndex}. Publicación: ${day(movement.publicationDate)} | Acuerdo: ${day(movement.agreementDate)}${notebook ? ` | ${notebook}` : ""}\n${movement.officialText}`;
      }).join("\n\n")
      : undefined;
    return {
      number: total - index,
      heading: `${result.number} - ${result.caseType}`,
      meta: [result.courtName, `${result.jurisdiction === "JALISCO" ? "Poder Judicial del Estado de Jalisco" : "Poder Judicial de la Federación"} | ${result.publicationCount} publicaciones indexadas | Última: ${day(result.lastPublicationDate)}`],
      parties: [result.plaintiff, result.defendant].filter(Boolean).join(" / ") || "No publicadas por la fuente",
      body,
    };
  };
  const local = results.map((result, index) => ({ result, index })).filter(({ result }) => result.jurisdiction === "JALISCO").map(({ result, index }) => build(result, index));
  const federal = results.map((result, index) => ({ result, index })).filter(({ result }) => result.jurisdiction === "FEDERAL").map(({ result, index }) => build(result, index));
  const now = new Date();
  const detailLabel = parsed.data.detail === "rigorous" ? "Búsqueda rigurosa con historial de resoluciones" : "Búsqueda simple de datos generales";
  const bytes = await createReportPdf({
    title: detailLabel,
    subtitle: `Criterio: ${parsed.data.q}. Participación: ${parsed.data.side === "plaintiff" ? "actor / quejoso" : parsed.data.side === "defendant" ? "demandado / tercero / autoridad" : "cualquier posición"}.`,
    generatedLabel: `Generado ${formatGuadalajaraDateTime(now)} · Guadalajara`,
    notice: "El informe comprende publicaciones que Mi Boletín Judicial ha indexado de fuentes oficiales. No constituye certificación judicial ni acredita por sí solo la inexistencia de otros asuntos.",
    sections: [{ title: "Asuntos Locales", items: local }, { title: "Asuntos Federales", items: federal }],
    watermark: "MI BOLETÍN JUDICIAL",
  });
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new NextResponse(body, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="busqueda-${parsed.data.detail}-mi-boletin.pdf"`, "Cache-Control": "private, no-store" } });
}
