import { extractFederalParties } from "./federal-extractor";
import { parsePartyNames } from "./parser";
import type { PartyCandidate, PartyExtractionInput } from "./types";

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function extractParties(input: PartyExtractionInput): PartyCandidate[] {
  const payload = input.rawPayload ?? {};
  if (input.provider === "jalisco-cjj") {
    const plaintiff = textValue(payload.act_names) ?? textValue(payload.aut_names) ?? input.parties?.plaintiff;
    const defendant = textValue(payload.dem_names) ?? textValue(payload.pro_names) ?? input.parties?.defendant;
    return [
      ...parsePartyNames(plaintiff, { side: "plaintiff", roleRaw: "Actor", extractionMethod: "structured_field", confidence: 0.99 }),
      ...parsePartyNames(defendant, { side: "defendant", roleRaw: "Demandado", extractionMethod: "structured_field", confidence: 0.99 }),
    ];
  }
  if (input.provider === "federal-pjf-session-lists") {
    const record = objectValue(payload.record);
    const direct = input.parties ? { plaintiff: input.parties.plaintiff, defendant: input.parties.defendant } : null;
    // VerCaptura contiene el historial HTML y el parser del proveedor puede haber
    // identificado campos procesales en esa misma ficha. La versión anterior
    // descartaba `input.parties` precisamente cuando había HTML, dejando en cero
    // expedientes federales que sí habían publicado una parte explícita.
    const structured = record ?? direct;
    return extractFederalParties({ structured, rawHtml: input.rawText, officialText: input.officialText });
  }
  return [];
}
