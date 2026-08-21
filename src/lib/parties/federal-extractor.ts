import * as cheerio from "cheerio";
import { cleanPartyRaw, inferPartyType, normalizePartyName } from "./normalization";
import { parsePartyNames } from "./parser";
import type { PartyCandidate, PartySide, PartyType } from "./types";

const MASKED_OR_GENERIC = /^(?:\*+|X{3,}|LA\s+)?(?:PARTE\s+)?(?:QUEJOS[OA]|ACTOR(?:A)?|DEMANDAD[OA]|TERCER[OA]\s+INTERESAD[OA]|PROMOVENTE|RECURRENTE)$/i;
const NON_PARTY_CONTEXT = /\b(?:JUEZ|JUEZA|MAGISTRAD[OA]|SECRETARI[OA]|ACTUARI[OA]|ABOGAD[OA]\s+AUTORIZAD[OA]|PERITO|PONENTE|PROYECTISTA)\b/i;
const LEGAL_PROSE = /^(?:DENTRO|CONTRA|MEDIANTE|RESPECTO|RELATIV[OA]|QUIEN|QUE|LA\s+PARTE|EL\s+ACTO|LOS?\s+ACTOS|SE\s+ORDENA|POR\s+CONDUCTO)\b/i;

const ROLE_PATTERNS: Array<{ label: RegExp; side: PartySide; partyType?: PartyType }> = [
  { label: /^(?:nombre\s+del\s+)?quejos[oa]$/i, side: "quejoso" },
  { label: /^(?:parte\s+)?actor(?:a)?$/i, side: "plaintiff" },
  { label: /^promovente$/i, side: "promovente" },
  { label: /^recurrente$/i, side: "recurrente" },
  { label: /^tercer[oa]\s+interesad[oa]$/i, side: "tercero_interesado" },
  { label: /^autoridad(?:es)?\s+responsable(?:s)?$/i, side: "autoridad_responsable", partyType: "AUTHORITY" },
  { label: /^(?:parte\s+)?demandad[oa]$/i, side: "defendant" },
];

function isUsableName(value: string): boolean {
  const clean = cleanPartyRaw(value);
  const normalized = normalizePartyName(clean);
  return normalized.length >= 4 && !MASKED_OR_GENERIC.test(clean) && !NON_PARTY_CONTEXT.test(clean) && !/^\*+$/.test(clean);
}

function candidatesFor(value: string | undefined, side: PartySide, method: string, roleRaw: string, confidence: number, partyType?: PartyType): PartyCandidate[] {
  if (!value || !isUsableName(value)) return [];
  return parsePartyNames(value, { side, roleRaw, extractionMethod: method, confidence, partyType: partyType ?? inferPartyType(value) });
}

function candidatesFromExplicitText(value: string, side: PartySide, roleRaw: string, fragment: string): PartyCandidate[] {
  const clean = cleanPartyRaw(value).replace(/^(?:C\.?|LIC\.?|LICENCIAD[OA]\.?|C\.\s*)\s+/i, "").trim();
  const tokens = normalizePartyName(clean).split(" ").filter(Boolean);
  if (tokens.length < 2 || tokens.length > 14 || LEGAL_PROSE.test(clean)) return [];
  return candidatesFor(clean, side, "federal_history_explicit", roleRaw, 0.82)
    .map((candidate) => ({ ...candidate, sourceFragment: cleanPartyRaw(fragment).slice(0, 500) }));
}

export function extractFederalParties(input: {
  structured?: Record<string, unknown> | null;
  rawHtml?: string | null;
  officialText?: string | null;
}): PartyCandidate[] {
  const candidates: PartyCandidate[] = [];
  const structured = input.structured ?? {};
  const structuredFields: Array<[string, PartySide, string, PartyType?]> = [
    ["complainant", "quejoso", "Quejoso"], ["plaintiff", "plaintiff", "Actor"],
    ["promoter", "promovente", "Promovente"], ["appellant", "recurrente", "Recurrente"],
    ["interestedThirdParty", "tercero_interesado", "Tercero interesado"],
    ["authority", "autoridad_responsable", "Autoridad responsable", "AUTHORITY"],
    ["defendant", "defendant", "Demandado"],
  ];
  for (const [field, side, role, partyType] of structuredFields) {
    const value = typeof structured[field] === "string" ? String(structured[field]) : undefined;
    candidates.push(...candidatesFor(value, side, "structured_field", role, 0.99, partyType));
  }
  if (candidates.length) return dedupe(candidates);

  if (input.rawHtml) {
    const $ = cheerio.load(input.rawHtml);
    $("tr").each((_, row) => {
      const cells = $(row).children("th,td");
      if (cells.length < 2) return;
      const label = cleanPartyRaw($(cells[0]).text()).replace(/:$/, "");
      const value = cleanPartyRaw($(cells[1]).text());
      const role = ROLE_PATTERNS.find((item) => item.label.test(label));
      if (role) candidates.push(...candidatesFor(value, role.side, "html_field", label, 0.96, role.partyType));
    });
    if (!candidates.length) {
      const explicitPatterns: Array<{ pattern: RegExp; side: PartySide; roleRaw: string }> = [
        { pattern: /(?:NOMBRE\s+DEL\s+)?QUEJOS[OA]\s*[:\-]\s*([^.;\n]{4,180})/gi, side: "quejoso", roleRaw: "Quejoso" },
        { pattern: /PROMOVENTE\s*[:\-]\s*([^.;\n]{4,180})/gi, side: "promovente", roleRaw: "Promovente" },
        { pattern: /PROMOVID[OA]\s+POR\s+([^,.;\n]{4,180})/gi, side: "promovente", roleRaw: "Promovido por" },
        { pattern: /TERCER[OA]\s+INTERESAD[OA]\s*[:\-]\s*([^.;\n]{4,180})/gi, side: "tercero_interesado", roleRaw: "Tercero interesado" },
        { pattern: /AUTORIDAD(?:ES)?\s+RESPONSABLE(?:S)?\s*[:\-]\s*([^.;\n]{4,180})/gi, side: "autoridad_responsable", roleRaw: "Autoridad responsable" },
      ];
      $("[id^='pBody'], .acuerdo, .sintesis, .detalle-acuerdo").each((_, element) => {
        const block = cleanPartyRaw($(element).text());
        if (!block) return;
        for (const rule of explicitPatterns) {
          rule.pattern.lastIndex = 0;
          for (const match of block.matchAll(rule.pattern)) {
            candidates.push(...candidatesFromExplicitText(match[1], rule.side, rule.roleRaw, match[0]));
          }
        }
      });
    }
  }
  if (candidates.length) return dedupe(candidates);

  const text = cleanPartyRaw(input.officialText ?? "");
  for (const role of ROLE_PATTERNS) {
    const source = role.label.source.replace(/^\^|\$$/g, "").replace(/\\s\+/g, "\\s+");
    const match = text.match(new RegExp(`(?:${source})\\s*[:\\-]\\s*([^.;]{4,220})`, "i"));
    if (match && !NON_PARTY_CONTEXT.test(match[1])) candidates.push(...candidatesFor(match[1], role.side, "official_text_rule", match[0].slice(0, 80), 0.78, role.partyType));
  }
  return dedupe(candidates);
}

function dedupe(candidates: PartyCandidate[]): PartyCandidate[] {
  return [...new Map(candidates.map((candidate) => [`${candidate.side}:${candidate.nameNormalized}`, candidate])).values()];
}
