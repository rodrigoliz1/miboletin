import { normalizeName } from "@/lib/domain/normalization";
import type { Jurisdiction } from "@/lib/domain/types";

export type JudicialCourtSource = "JALISCO_CJJ" | "STJ_JALISCO" | "FEDERAL_PJF";
export type CourtResolutionStatus = "RESOLVED" | "AMBIGUOUS" | "NOT_FOUND" | "SOURCE_UNAVAILABLE";
export type CourtResolutionConfidence = "EXACT" | "HIGH" | "MEDIUM" | "LOW";
export type CourtResolutionMethod = "EXACT_ALIAS" | "STRUCTURED_MATCH" | "FUZZY_MATCH" | "SOURCE_VERIFIED" | "USER_CONFIRMED";
export type JudicialOrganType = "SALA" | "JUZGADO" | "TRIBUNAL_COLEGIADO" | "TRIBUNAL_APELACION" | "TRIBUNAL" | "PLENO" | "CENTRO";

export interface CanonicalJudicialCourt {
  externalId: string;
  name: string;
  jurisdiction: Jurisdiction;
  source: JudicialCourtSource;
  matter?: string;
  courtType?: string;
  circuit?: string;
  circuitName?: string;
  city?: string;
  group?: string;
}

export interface JudicialCourtResolutionInput {
  rawQuery: string;
  caseNumber?: string | null;
  caseType?: string | null;
  jurisdictionHint?: Jurisdiction | null;
  sourceHint?: JudicialCourtSource | null;
  stateHint?: string | null;
  matterHint?: string | null;
  organTypeHint?: string | null;
}

export interface JudicialCourtCandidate {
  court: CanonicalJudicialCourt;
  score: number;
  confidence: CourtResolutionConfidence;
  matchedSignals: string[];
}

export interface JudicialCourtResolution {
  status: CourtResolutionStatus;
  court?: CanonicalJudicialCourt;
  confidence: CourtResolutionConfidence;
  method?: CourtResolutionMethod;
  score?: number;
  margin?: number;
  alternatives: JudicialCourtCandidate[];
  rawQuery: string;
}

interface CourtFeatures {
  normalized: string;
  tokens: string[];
  relevantTokens: string[];
  ordinal?: number;
  matter?: string;
  organType?: JudicialOrganType;
  institution?: JudicialCourtSource;
  state?: string;
  city?: string;
}

const DIRECT_ORDINALS: Record<string, number> = {
  PRIMERO: 1, PRIMERA: 1, PRIMER: 1,
  SEGUNDO: 2, SEGUNDA: 2,
  TERCERO: 3, TERCERA: 3, TERCER: 3,
  CUARTO: 4, CUARTA: 4,
  QUINTO: 5, QUINTA: 5,
  SEXTO: 6, SEXTA: 6,
  SEPTIMO: 7, SEPTIMA: 7,
  OCTAVO: 8, OCTAVA: 8,
  NOVENO: 9, NOVENA: 9,
  DECIMO: 10, DECIMA: 10,
  UNDECIMO: 11, UNDECIMA: 11,
  DUODECIMO: 12, DUODECIMA: 12,
};

const TENS_ORDINALS: Record<string, number> = {
  DECIMO: 10, DECIMA: 10,
  VIGESIMO: 20, VIGESIMA: 20,
  TRIGESIMO: 30, TRIGESIMA: 30,
  CUADRAGESIMO: 40, CUADRAGESIMA: 40,
};

const COMPOUND_ORDINALS = Object.fromEntries(
  Object.entries(TENS_ORDINALS).flatMap(([tensWord, tensValue]) =>
    Object.entries(DIRECT_ORDINALS)
      .filter(([, unitValue]) => unitValue < 10)
      .map(([unitWord, unitValue]) => [`${tensWord}${unitWord}`, tensValue + unitValue]),
  ),
) as Record<string, number>;

const TYPO_VOCABULARY = [
  "JUZGADO", "SALA", "TRIBUNAL", "COLEGIADO", "APELACION", "PLENO", "CENTRO",
  "MERCANTIL", "CIVIL", "PENAL", "FAMILIAR", "LABORAL", "ADMINISTRATIVO", "ADOLESCENTES",
  "SUPREMO", "JUSTICIA", "DISTRITO", "CIRCUITO", "JALISCO", "GUADALAJARA", "ZAPOPAN",
  ...Object.keys(DIRECT_ORDINALS), ...Object.keys(TENS_ORDINALS),
];

const STOP_WORDS = new Set([
  "DE", "DEL", "LA", "LAS", "EL", "LOS", "LO", "EN", "Y", "PARA", "CON", "MATERIA",
  "ESTADO", "PODER", "JUDICIAL", "JUSTICIA", "ORGANO", "JURISDICCIONAL", "PARTIDO",
]);

function editDistance(left: string, right: string): number {
  if (left === right) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function canonicalToken(token: string): string {
  if (token === "SLA") return "SALA";
  if (token === "JDO") return "JUZGADO";
  if (token.length < 4 || TYPO_VOCABULARY.includes(token)) return token;
  let best = token;
  let distance = token.length >= 7 ? 3 : 2;
  for (const known of TYPO_VOCABULARY) {
    if (Math.abs(known.length - token.length) > 2 || known[0] !== token[0]) continue;
    const candidateDistance = editDistance(token, known);
    const allowed = Math.max(token.length, known.length) >= 7 ? 2 : 1;
    if (candidateDistance <= allowed && candidateDistance < distance) {
      best = known;
      distance = candidateDistance;
    }
  }
  return best;
}

export function normalizeJudicialCourtText(value: string): string {
  return normalizeName(value.replace(/\b\d{1,8}\s*[\/-]\s*(?:19|20)\d{2}(?:[-/][A-Z0-9-]+)?\b/gi, " "))
    .replace(/\b(\d{1,2})[AO]\b/g, "$1")
    .split(" ")
    .filter(Boolean)
    .map(canonicalToken)
    .join(" ");
}

function ordinalOccurrences(tokens: string[]): Array<{ value: number; index: number; end: number }> {
  const occurrences: Array<{ value: number; index: number; end: number }> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const numeric = Number(tokens[index]);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 50) {
      occurrences.push({ value: numeric, index, end: index });
      continue;
    }
    const compound = COMPOUND_ORDINALS[tokens[index]];
    if (compound) {
      occurrences.push({ value: compound, index, end: index });
      continue;
    }
    const tens = TENS_ORDINALS[tokens[index]];
    const unit = DIRECT_ORDINALS[tokens[index + 1]];
    if (tens && unit && unit < 10) {
      occurrences.push({ value: tens + unit, index, end: index + 1 });
      index += 1;
      continue;
    }
    const direct = DIRECT_ORDINALS[tokens[index]];
    if (direct) occurrences.push({ value: direct, index, end: index });
  }
  return occurrences;
}

function organTokenIndex(tokens: string[]): number | undefined {
  const indexes = ["SALA", "JUZGADO", "TRIBUNAL", "PLENO", "CENTRO"]
    .map((token) => tokens.indexOf(token))
    .filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : undefined;
}

function primaryOrdinal(tokens: string[]): number | undefined {
  const occurrences = ordinalOccurrences(tokens);
  if (!occurrences.length) return undefined;
  const organIndex = organTokenIndex(tokens);
  if (organIndex === undefined) return occurrences[0].value;
  return occurrences
    .map((occurrence) => ({
      ...occurrence,
      distance: Math.min(Math.abs(occurrence.index - organIndex), Math.abs(occurrence.end - organIndex)),
      contextualPenalty: ["PARTIDO", "CIRCUITO", "DISTRITO"].some((token) => {
        const index = tokens.indexOf(token);
        return index >= 0 && Math.abs(index - occurrence.index) <= 2;
      }) ? 10 : 0,
    }))
    .sort((left, right) => (left.distance + left.contextualPenalty) - (right.distance + right.contextualPenalty) || left.index - right.index)[0].value;
}

function matterFrom(tokens: string[], explicit?: string | null): string | undefined {
  const combined = [...tokens, ...normalizeJudicialCourtText(explicit ?? "").split(" ")];
  if (combined.includes("MERCANTIL")) return "MERCANTIL";
  if (combined.includes("FAMILIAR")) return "FAMILIAR";
  if (combined.includes("LABORAL")) return "LABORAL";
  if (combined.includes("ADMINISTRATIVO") || combined.includes("ADMINISTRATIVA")) return "ADMINISTRATIVO";
  if (combined.includes("ADOLESCENTES") || combined.includes("ADOLESCENTE")) return "ADOLESCENTES";
  if (combined.includes("PENAL")) return "PENAL";
  if (combined.includes("CIVIL")) return "CIVIL";
  return undefined;
}

function organTypeFrom(tokens: string[], explicit?: string | null): JudicialOrganType | undefined {
  const combined = [...tokens, ...normalizeJudicialCourtText(explicit ?? "").split(" ")];
  if (combined.includes("SALA")) return "SALA";
  if (combined.includes("PLENO")) return "PLENO";
  if (combined.includes("CENTRO")) return "CENTRO";
  if (combined.includes("TRIBUNAL") && combined.includes("COLEGIADO")) return "TRIBUNAL_COLEGIADO";
  if (combined.includes("TRIBUNAL") && combined.includes("APELACION")) return "TRIBUNAL_APELACION";
  if (combined.includes("TRIBUNAL")) return "TRIBUNAL";
  if (combined.includes("JUZGADO")) return "JUZGADO";
  return undefined;
}

function institutionFrom(tokens: string[]): JudicialCourtSource | undefined {
  const joined = tokens.join(" ");
  if (/\bSUPREMO\b.*\bTRIBUNAL\b|\bSTJ\b/.test(joined)) return "STJ_JALISCO";
  if (/\bPJF\b|\bFEDERACION\b|\bFEDERAL\b/.test(joined)) return "FEDERAL_PJF";
  return undefined;
}

function features(value: string, hints: Pick<JudicialCourtResolutionInput, "matterHint" | "organTypeHint" | "stateHint"> = {}): CourtFeatures {
  const normalized = normalizeJudicialCourtText(value);
  const tokens = normalized.split(" ").filter(Boolean);
  return {
    normalized,
    tokens,
    relevantTokens: tokens.filter((token) => !STOP_WORDS.has(token) && !/^\d+$/.test(token)),
    ordinal: primaryOrdinal(tokens),
    matter: matterFrom(tokens, hints.matterHint),
    organType: organTypeFrom(tokens, hints.organTypeHint),
    institution: institutionFrom(tokens),
    state: tokens.includes("JALISCO") || normalizeJudicialCourtText(hints.stateHint ?? "").includes("JALISCO") ? "JALISCO" : undefined,
    city: ["GUADALAJARA", "ZAPOPAN", "TLAQUEPAQUE", "TLAJOMULCO", "TONALA"].find((city) => tokens.includes(city)),
  };
}

function candidateFeatures(court: CanonicalJudicialCourt): CourtFeatures {
  const result = features(`${court.name} ${court.matter ?? ""} ${court.city ?? ""} ${court.group ?? ""}`, { organTypeHint: court.courtType });
  result.institution = court.source;
  result.state = court.jurisdiction === "JALISCO" ? "JALISCO" : result.state;
  return result;
}

function overlapScore(requested: string[], candidate: string[]): number {
  if (!requested.length || !candidate.length) return 0;
  const candidateSet = new Set(candidate);
  return requested.filter((token) => candidateSet.has(token)).length / new Set(requested).size;
}

function bigramScore(left: string, right: string): number {
  const bigrams = (value: string) => {
    const compact = value.replace(/\s+/g, " ");
    return Array.from({ length: Math.max(0, compact.length - 1) }, (_, index) => compact.slice(index, index + 2));
  };
  const leftPairs = bigrams(left);
  const rightPairs = bigrams(right);
  if (!leftPairs.length || !rightPairs.length) return 0;
  const remaining = [...rightPairs];
  let matches = 0;
  for (const pair of leftPairs) {
    const index = remaining.indexOf(pair);
    if (index >= 0) {
      matches += 1;
      remaining.splice(index, 1);
    }
  }
  return (2 * matches) / (leftPairs.length + rightPairs.length);
}

function confidenceFor(score: number, exact = false): CourtResolutionConfidence {
  if (exact) return "EXACT";
  if (score >= 72) return "HIGH";
  if (score >= 50) return "MEDIUM";
  return "LOW";
}

function scoreCandidate(input: JudicialCourtResolutionInput, requested: CourtFeatures, court: CanonicalJudicialCourt): JudicialCourtCandidate | null {
  const candidate = candidateFeatures(court);
  const matchedSignals: string[] = [];
  const exact = requested.normalized === normalizeJudicialCourtText(court.name);
  let score = exact ? 105 : 0;

  const sourceHint = input.sourceHint ?? requested.institution;
  if (sourceHint) {
    if (sourceHint !== court.source) return null;
    score += 14;
    matchedSignals.push("fuente");
  }
  if (input.jurisdictionHint) {
    if (input.jurisdictionHint !== court.jurisdiction) return null;
    score += 8;
    matchedSignals.push("jurisdicción");
  }
  if (requested.organType) {
    const compatibleTribunal = requested.organType === "TRIBUNAL" && candidate.organType?.startsWith("TRIBUNAL");
    if (requested.organType !== candidate.organType && !compatibleTribunal) return null;
    score += 27;
    matchedSignals.push("tipo de órgano");
  }
  if (requested.ordinal !== undefined) {
    if (candidate.ordinal !== requested.ordinal) return null;
    score += 36;
    matchedSignals.push("ordinal");
  }
  if (requested.matter) {
    if (candidate.matter && candidate.matter !== requested.matter) return null;
    if (candidate.matter === requested.matter) {
      score += 30;
      matchedSignals.push("materia");
    }
  }
  if (requested.institution) {
    if (requested.institution !== court.source) return null;
    score += 18;
    matchedSignals.push("institución");
  }
  if (requested.state && court.jurisdiction === "JALISCO") {
    score += 6;
    matchedSignals.push("entidad");
  }
  if (requested.city) {
    if (candidate.city && requested.city !== candidate.city) return null;
    if (requested.city === candidate.city) {
      score += 12;
      matchedSignals.push("ciudad");
    }
  }

  const tokenOverlap = overlapScore(requested.relevantTokens, candidate.relevantTokens);
  const fuzzy = bigramScore(requested.normalized, candidate.normalized);
  score += tokenOverlap * 16;
  score += fuzzy * 7;
  if (tokenOverlap >= 0.65) matchedSignals.push("denominación");
  if (/\(\s*\d{2}\s+\d{2}\s+\d{4}/.test(normalizeName(court.name))) score -= 18;

  const strongSignals = [requested.organType, requested.ordinal, requested.matter, requested.institution].filter((value) => value !== undefined).length;
  if (!exact && strongSignals === 0 && tokenOverlap < 0.55) return null;
  return { court, score: Number(score.toFixed(3)), confidence: confidenceFor(score, exact), matchedSignals };
}

export function inferJudicialCourtSource(input: JudicialCourtResolutionInput): JudicialCourtSource {
  if (input.sourceHint) return input.sourceHint;
  const text = normalizeJudicialCourtText(`${input.rawQuery} ${input.caseType ?? ""} ${input.organTypeHint ?? ""}`);
  if (input.jurisdictionHint === "FEDERAL") return "FEDERAL_PJF";
  // "Queja" también puede describir el tipo de resolución de un Toca local.
  // La referencia explícita a Sala/STJ/Toca debe prevalecer sobre ese término genérico.
  if (/\b(?:SALA|STJ|SUPREMO TRIBUNAL|TOCA)\b/.test(text)) return "STJ_JALISCO";
  if (/\b(?:JUZGADO .* DISTRITO|TRIBUNAL COLEGIADO|PLENO REGIONAL|FEDERAL|AMPARO|QUEJA)\b/.test(text)) return "FEDERAL_PJF";
  return "JALISCO_CJJ";
}

export class JudicialOrganResolver {
  constructor(private readonly catalog: CanonicalJudicialCourt[]) {}

  resolve(input: JudicialCourtResolutionInput): JudicialCourtResolution {
    const requested = features(input.rawQuery, input);
    const sourceHint = input.sourceHint ?? inferJudicialCourtSource(input);
    const ranked = this.catalog
      .map((court) => scoreCandidate({ ...input, sourceHint }, requested, court))
      .filter((candidate): candidate is JudicialCourtCandidate => Boolean(candidate))
      .sort((left, right) => right.score - left.score || left.court.name.localeCompare(right.court.name, "es"));
    const first = ranked[0];
    if (!first || first.score < 42) return { status: "NOT_FOUND", confidence: "LOW", alternatives: ranked.slice(0, 5), rawQuery: input.rawQuery };
    const secondScore = ranked[1]?.score ?? 0;
    const margin = first.score - secondScore;
    const exact = first.confidence === "EXACT";
    const dominant = exact || (first.score >= 68 && margin >= 12) || (first.score >= 58 && ranked.length === 1);
    if (dominant) return {
      status: "RESOLVED", court: first.court, confidence: exact ? "EXACT" : "HIGH",
      method: exact ? "EXACT_ALIAS" : "STRUCTURED_MATCH", score: first.score, margin,
      alternatives: ranked.slice(0, 5), rawQuery: input.rawQuery,
    };
    return {
      status: "AMBIGUOUS", confidence: first.score >= 50 ? "MEDIUM" : "LOW",
      method: first.matchedSignals.length ? "STRUCTURED_MATCH" : "FUZZY_MATCH",
      score: first.score, margin, alternatives: ranked.slice(0, 5), rawQuery: input.rawQuery,
    };
  }
}

export function sourceVerifiedResolution(base: JudicialCourtResolution, court: CanonicalJudicialCourt): JudicialCourtResolution {
  return { ...base, status: "RESOLVED", court, confidence: "HIGH", method: "SOURCE_VERIFIED", alternatives: base.alternatives };
}
