import { normalizeName } from "@/lib/domain/normalization";

export interface NamedMatch<T> {
  item: T;
  score: number;
  margin: number;
}

export function inferAssistantJurisdiction(
  courtName: string,
  declared: "JALISCO" | "FEDERAL" | null,
): "JALISCO" | "FEDERAL" {
  const federalCourt = /tribunal\s+colegiado|juzgado(?:\s+\w+){0,5}\s+de\s+distrito|centro\s+de\s+justicia\s+penal\s+federal|tribunal\s+laboral\s+federal|pleno\s+regional|tribunal\s+colegiado\s+de\s+apelacion/i.test(normalizeName(courtName));
  if (federalCourt) return "FEDERAL";
  return declared ?? "JALISCO";
}

function tokens(value: string): string[] {
  return normalizeName(value).split(" ").filter(Boolean);
}

function isHistoricalName(value: string): boolean {
  return /\(\s*\d{2}\s+\d{2}\s+\d{4}\s+\d{2}\s+\d{2}\s+\d{4}\s*\)/.test(normalizeName(value));
}

function similarity(candidateName: string, requested: string): number {
  const target = normalizeName(requested);
  const candidate = normalizeName(candidateName);
  if (!target || !candidate) return 0;
  if (candidate === target) return 1;

  const targetTokens = tokens(target);
  const candidateTokens = tokens(candidate);
  const targetSet = new Set(targetTokens);
  const candidateSet = new Set(candidateTokens);
  const common = targetTokens.filter((token) => candidateSet.has(token)).length;
  const recall = common / targetTokens.length;
  const precision = [...candidateSet].filter((token) => targetSet.has(token)).length / candidateSet.size;
  const containsWholePhrase = candidate === target || candidate.startsWith(`${target} `) || candidate.endsWith(` ${target}`) || candidate.includes(` ${target} `);
  const reverseContains = target.startsWith(`${candidate} `) || target.endsWith(` ${candidate}`) || target.includes(` ${candidate} `);
  const sequenceBonus = containsWholePhrase ? 0.12 : reverseContains ? 0.07 : 0;
  const historicalPenalty = isHistoricalName(candidateName) ? 0.16 : 0;
  const tokenScore = (recall * 0.68) + (precision * 0.2) + sequenceBonus;
  const officialCoreScore = reverseContains && candidateTokens.length >= 5
    ? 0.82 + (Math.min(candidateTokens.length / targetTokens.length, 1) * 0.14)
    : 0;
  return Math.max(0, Math.max(tokenScore, officialCoreScore) - historicalPenalty);
}

export function rankNamed<T extends { name: string }>(items: T[], requested: string): Array<{ item: T; score: number }> {
  return items
    .map((item) => ({ item, score: similarity(item.name, requested) }))
    .sort((left, right) => right.score - left.score || left.item.name.length - right.item.name.length);
}

export function matchNamed<T extends { name: string }>(items: T[], requested: string): NamedMatch<T> | null {
  const ranked = rankNamed(items, requested);
  const first = ranked[0];
  if (!first || first.score < 0.74) return null;
  const secondScore = ranked[1]?.score ?? 0;
  const margin = first.score - secondScore;
  if (first.score < 0.995 && margin < 0.035) return null;
  return { item: first.item, score: first.score, margin };
}

export function bestNamed<T extends { name: string }>(items: T[], requested: string): T | null {
  return matchNamed(items, requested)?.item ?? null;
}
