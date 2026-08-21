import { nameTokens, normalizePartyName } from "./normalization";
import type { PartyCandidate } from "./types";

export interface ExistingPartyIdentity {
  id: string;
  nameRaw: string;
  nameNormalized: string;
  side: string;
  partyType: string;
}

function initialCompatible(shorter: string[], longer: string[]): boolean {
  return shorter.every((token) => longer.some((candidate) => candidate === token || (token.length === 1 && candidate.startsWith(token))));
}

export function canonicalSimilarity(left: string, right: string): number {
  const leftNormalized = normalizePartyName(left);
  const rightNormalized = normalizePartyName(right);
  if (!leftNormalized || !rightNormalized) return 0;
  if (leftNormalized === rightNormalized) return 1;
  const a = nameTokens(leftNormalized);
  const b = nameTokens(rightNormalized);
  const intersection = a.filter((token) => b.includes(token)).length;
  const union = new Set([...a, ...b]).size;
  const jaccard = union ? intersection / union : 0;
  const coverage = Math.min(a.length, b.length) ? intersection / Math.min(a.length, b.length) : 0;
  return Math.max(jaccard, initialCompatible(a.length <= b.length ? a : b, a.length <= b.length ? b : a) ? coverage * 0.94 : 0);
}

export function findCanonicalParty(candidate: PartyCandidate, existing: ExistingPartyIdentity[]): ExistingPartyIdentity | null {
  const sameContext = existing.filter((party) => party.side === candidate.side && party.partyType === candidate.partyType);
  const exact = sameContext.find((party) => party.nameNormalized === candidate.nameNormalized);
  if (exact) return exact;
  const ranked = sameContext.map((party) => ({ party, score: canonicalSimilarity(candidate.nameNormalized, party.nameNormalized) }))
    .sort((left, right) => right.score - left.score);
  if (!ranked.length || ranked[0].score < 0.92) return null;
  if (ranked[1] && ranked[0].score - ranked[1].score < 0.08) return null;
  const candidateTokens = nameTokens(candidate.nameNormalized);
  const partyTokens = nameTokens(ranked[0].party.nameNormalized);
  if (candidateTokens.length < 3 || partyTokens.length < 3) return null;
  return ranked[0].party;
}
