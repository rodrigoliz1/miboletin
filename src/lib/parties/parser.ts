import { cleanPartyRaw, inferPartyType, normalizePartyName, searchablePartyName } from "./normalization";
import type { PartyCandidate, PartySide, PartyType } from "./types";

export const PARTY_PARSER_VERSION = "party-name-parser-2";

const CORPORATE_CONTINUATION = /^(?:SOCIEDAD(?:\s+AN[ÓO]NIMA|\s+FINANCIERA|\s+CIVIL)?|S\.?\s*A\.?|S\.?\s*DE\s*R\.?\s*L\.?|S\.?\s*P\.?\s*R\.?|SOFOM|ENTIDAD\s+NO\s+REGULADA|DE\s+CAPITAL\s+VARIABLE)\b/i;
const COMPLETE_COMPANY = /(?:S\.?\s*A\.?(?:\s*P\.?\s*I\.?)?(?:\s+DE\s+C\.?\s*V\.?)?|S\.?\s+DE\s+R\.?\s*L\.?(?:\s+DE\s+C\.?\s*V\.?)?|S\.?\s*P\.?\s*R\.?\s+DE\s+R\.?\s*L\.?|SOFOM(?:\s+E\.?\s*N\.?\s*R\.?)?|A\.?\s*C\.?|I\.?\s*A\.?\s*P\.?|S\.?\s*C\.?)\s*$/i;
const MASKED = /^(?:\*+|X{3,}|ANONIM[OA]|NOMBRE\s+RESERVADO)$/i;

export interface ParsePartyNamesOptions {
  side: PartySide;
  roleRaw?: string;
  extractionMethod?: string;
  confidence?: number;
  partyType?: PartyType;
}

function looksLikePerson(value: string): boolean {
  const normalized = normalizePartyName(value);
  const tokens = normalized.split(" ").filter(Boolean);
  return tokens.length >= 2 && tokens.length <= 8 && !/\d/.test(normalized) && inferPartyType(value) === "PERSON";
}

function splitConservatively(raw: string): { values: string[]; ambiguous: boolean; omittedOthers: boolean } {
  const omittedOthers = /\bY\s+OTR[OA]S?\b/i.test(raw);
  const withoutOthers = raw.replace(/(?:,?\s*)\bY\s+OTR[OA]S?\b\.?/gi, "").trim();
  const semicolonParts = withoutOthers.split(/\s*;\s*/).filter(Boolean);
  const output: string[] = [];
  let ambiguous = false;

  for (const semicolonPart of semicolonParts) {
    const pieces = semicolonPart.split(/\s*,\s*/).map(cleanPartyRaw).filter(Boolean);
    if (pieces.length === 1) {
      output.push(pieces[0]);
      continue;
    }
    let buffer = pieces[0];
    for (let index = 1; index < pieces.length; index += 1) {
      const next = pieces[index];
      const currentType = inferPartyType(buffer);
      const nextType = inferPartyType(next);
      const nextIsContinuation = CORPORATE_CONTINUATION.test(next);
      const currentCompleteCompany = currentType === "COMPANY" && COMPLETE_COMPANY.test(buffer);

      if (nextIsContinuation || (currentType === "COMPANY" && !currentCompleteCompany && nextType !== "PERSON")) {
        buffer = `${buffer}, ${next}`;
      } else if (currentCompleteCompany && looksLikePerson(next)) {
        output.push(buffer);
        buffer = next;
      } else if (looksLikePerson(buffer) && (looksLikePerson(next) || nextType === "COMPANY")) {
        output.push(buffer);
        buffer = next;
      } else if (currentType === "COMPANY" && nextType === "COMPANY") {
        output.push(buffer);
        buffer = next;
      } else {
        buffer = `${buffer}, ${next}`;
        ambiguous = true;
      }
    }
    output.push(buffer);
  }
  return { values: output, ambiguous, omittedOthers };
}

export function parsePartyNames(value: string | null | undefined, options: ParsePartyNamesOptions): PartyCandidate[] {
  if (!value) return [];
  const raw = cleanPartyRaw(value);
  if (!raw || MASKED.test(raw)) return [];
  const parsed = splitConservatively(raw);
  return parsed.values.flatMap((name): PartyCandidate[] => {
    const clean = cleanPartyRaw(name);
    const normalized = normalizePartyName(clean);
    if (!normalized || MASKED.test(normalized) || normalized.length < 3) return [];
    const partyType = options.partyType ?? inferPartyType(clean);
    const baseConfidence = options.confidence ?? 0.96;
    const confidence = Math.max(0.5, Math.min(1, baseConfidence - (parsed.ambiguous ? 0.2 : 0) - (partyType === "UNKNOWN" ? 0.08 : 0)));
    return [{
      nameRaw: clean,
      nameNormalized: normalized,
      searchName: searchablePartyName(clean, partyType),
      canonicalName: clean,
      partyType,
      side: options.side,
      roleRaw: options.roleRaw,
      confidence,
      extractionMethod: options.extractionMethod ?? "structured_field",
      metadata: { parserVersion: PARTY_PARSER_VERSION, ambiguous: parsed.ambiguous, omittedOthers: parsed.omittedOthers },
    }];
  });
}
