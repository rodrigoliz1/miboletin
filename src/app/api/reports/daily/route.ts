import { NextResponse } from "next/server";
import { createReportPdf } from "@/lib/reports/pdf";
import { getSession } from "@/lib/security/session";
import { hasActiveProductAccess } from "@/lib/billing/access";
import { dateInMexicoCity, formatGuadalajaraDateTime, formatGuadalajaraTime, isIsoDate, optionalUuid } from "@/lib/product/query";
import { listOrganizationMovements } from "@/lib/product/repository";
import { verifiedNotebookLabel } from "@/lib/product/judicial-display";

export const maxDuration = 30;

function dateLabel(value: string | null) {
  if (!value) return "No publicada";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url), 303);
  if (!(await hasActiveProductAccess(session.organizationId, session.userId))) return NextResponse.redirect(new URL("/subscribe?error=subscription", request.url), 303);
  const query = new URL(request.url).searchParams;
  const date = isIsoDate(query.get("date")) ? query.get("date")! : dateInMexicoCity();
  const folder = optionalUuid(query.get("folder"));
  const movements = (await listOrganizationMovements(session.organizationId, date, date, folder ?? undefined)).filter((item) => item.publication_kind === "AGREEMENT");
  const ordered = [...movements].sort((a, b) => b.display_date.localeCompare(a.display_date) || b.publication_date.localeCompare(a.publication_date) || b.detected_at.localeCompare(a.detected_at));
  const total = ordered.length;
  const item = (movement: (typeof ordered)[number], index: number) => {
    const notebook = verifiedNotebookLabel(movement.notebook, movement.official_text);
    return ({
    number: total - index,
    heading: `${movement.case_number} - ${movement.court_name}`,
    meta: [
      `${movement.case_type} | Fecha de publicación: ${dateLabel(movement.publication_date)} | Fecha del acuerdo: ${dateLabel(movement.agreement_date)}`,
      ...(movement.carried_forward ? [`Revisión adicional del día: se mantiene visible por coincidir la fecha del acuerdo y la publicación oficial.`] : []),
      `Hora de consulta del registro: ${formatGuadalajaraTime(movement.retrieved_at)} hrs (Guadalajara)${notebook ? ` | ${notebook}` : ""}`,
    ],
    parties: [movement.plaintiff, movement.defendant].filter(Boolean).join(" / ") || undefined,
    body: movement.official_text,
    });
  };
  const local = ordered.map((movement, index) => ({ movement, index })).filter(({ movement }) => movement.jurisdiction === "JALISCO").map(({ movement, index }) => item(movement, index));
  const federal = ordered.map((movement, index) => ({ movement, index })).filter(({ movement }) => movement.jurisdiction === "FEDERAL").map(({ movement, index }) => item(movement, index));
  const now = new Date();
  const bytes = await createReportPdf({
    title: "Boletín de Resoluciones",
    subtitle: `Publicaciones de los asuntos vigilados correspondientes al ${dateLabel(date)}.`,
    generatedLabel: `Hora de Consulta: ${formatGuadalajaraTime(now)} hrs · Guadalajara`,
    notice: `Hora de Consulta: ${formatGuadalajaraTime(now)}. Aviso: Los Órganos Jurisdiccionales publican los acuerdos en horarios variados, se recomienda volver a revisar en otro horario. Documento generado ${formatGuadalajaraDateTime(now)}.`,
    sections: [{ title: "Asuntos Locales", items: local }, { title: "Asuntos Federales", items: federal }],
    watermark: "MI BOLETÍN JUDICIAL",
  });
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new NextResponse(body, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="boletin-resoluciones-${date}.pdf"`, "Cache-Control": "private, no-store" } });
}
