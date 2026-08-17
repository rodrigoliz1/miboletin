import { normalizeCaseNumber, normalizeName } from "./normalization";
import type { MatchResult } from "./types";

export interface MatchableCase {
  jurisdiction: string;
  provider: string;
  courtExternalId: string;
  caseType?: string;
  caseNumber: string;
}

export function matchCase(watched: MatchableCase, publication: MatchableCase): MatchResult {
  let watchedNumber: string;
  let publicationNumber: string;
  try {
    watchedNumber = normalizeCaseNumber(watched.caseNumber).normalized;
    publicationNumber = normalizeCaseNumber(publication.caseNumber).normalized;
  } catch {
    return "NO_MATCH";
  }
  if (watchedNumber !== publicationNumber) return "NO_MATCH";
  if (watched.jurisdiction !== publication.jurisdiction || watched.provider !== publication.provider) return "NO_MATCH";
  if (watched.courtExternalId !== publication.courtExternalId) return "AMBIGUOUS";
  const leftType = normalizeName(watched.caseType ?? "");
  const rightType = normalizeName(publication.caseType ?? "");
  if (leftType && rightType && leftType !== rightType) return "PROBABLE";
  return "EXACT";
}

export function matchName(rule: string, candidate: string, mode: "EXACT" | "FLEXIBLE"): MatchResult {
  const normalizedRule = normalizeName(rule);
  const normalizedCandidate = normalizeName(candidate);
  if (!normalizedRule || !normalizedCandidate) return "NO_MATCH";
  if (normalizedRule === normalizedCandidate) return "EXACT";
  if (mode === "EXACT") return "NO_MATCH";
  const tokens = normalizedRule.split(" ").filter((token) => token.length > 2);
  if (tokens.length >= 2 && tokens.every((token) => normalizedCandidate.includes(token))) return "PROBABLE";
  return "NO_MATCH";
}
