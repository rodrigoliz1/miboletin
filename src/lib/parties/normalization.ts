import type { PartyType } from "./types";

const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g;
const COMPANY_MARKERS = /\b(?:S\s*A(?:\s*P\s*I)?|SOCIEDAD(?:\s+ANONIMA|\s+FINANCIERA|\s+CIVIL)?|S\s+DE\s+R\s*L|S\s*P\s*R|SOFOM|FINANCIERA|ASOCIACION\s+CIVIL|I\s*A\s*P|A\s*C|BANCO|ASEGURADORA|INMOBILIARIA|DESARROLLADORA|CONSTRUCTORA|CORPORATIVO|COMERCIALIZADORA|EMPRESA|COOPERATIVA)\b/i;
const AUTHORITY_MARKERS = /\b(?:JUZGADO|TRIBUNAL|SECRETARIA|FISCALIA|AYUNTAMIENTO|MUNICIPIO|GOBIERNO|INSTITUTO\s+MEXICANO|COMISION\s+NACIONAL|AUTORIDAD)\b/i;
const CORPORATE_ENDINGS = [
  /\bS\s*A\s*P\s*I\s+DE\s+C\s*V(?:\s+SOFOM(?:\s+E\s*N\s*R)?)?$/,
  /\bS\s*A\s+DE\s+C\s*V(?:\s+SOFOM(?:\s+E\s*N\s*R)?)?$/,
  /\bS\s+DE\s+R\s*L(?:\s+DE\s+C\s*V)?$/,
  /\bS\s*P\s*R\s+DE\s+R\s*L(?:\s+DE\s+C\s*V)?$/,
  /\bSOFOM(?:\s+E\s*N\s*R)?$/,
  /\b(?:A\s*C|I\s*A\s*P|S\s*C)$/,
  /\bSOCIEDAD\s+(?:ANONIMA|CIVIL)(?:\s+DE\s+CAPITAL\s+VARIABLE)?$/,
  /\bSOCIEDAD\s+FINANCIERA\s+DE\s+OBJETO\s+MULTIPLE(?:\s+ENTIDAD\s+NO\s+REGULADA)?$/,
];

export function cleanPartyRaw(value: string): string {
  return value.normalize("NFKC").replace(INVISIBLE, "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizePartyName(value: string): string {
  return cleanPartyRaw(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/Ñ/g, "N")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function inferPartyType(value: string): PartyType {
  const normalized = normalizePartyName(value);
  if (!normalized) return "UNKNOWN";
  if (AUTHORITY_MARKERS.test(normalized)) return "AUTHORITY";
  if (COMPANY_MARKERS.test(normalized)) return "COMPANY";
  const tokens = normalized.split(" ");
  return tokens.length >= 2 && tokens.length <= 9 && tokens.every((token) => /^(?:[A-Z]{2,}|[A-Z])$/.test(token)) ? "PERSON" : "UNKNOWN";
}

export function corporateSearchName(value: string): string {
  let result = normalizePartyName(value);
  let previous = "";
  while (result && result !== previous) {
    previous = result;
    for (const suffix of CORPORATE_ENDINGS) result = result.replace(suffix, "").trim();
  }
  return result || normalizePartyName(value);
}

export function searchablePartyName(value: string, type = inferPartyType(value)): string {
  return type === "COMPANY" ? corporateSearchName(value) : normalizePartyName(value);
}

export function nameTokens(value: string): string[] {
  return [...new Set(normalizePartyName(value).split(" ").filter((token) => token.length > 1))];
}
