import type { AiTier } from "@/lib/ai/config";

export type AiRequestType = "add_cases" | "case_lookup" | "publication_list" | "session_lookup" | "summary" | "legal_analysis" | "general";

export interface AiRoutingContext {
  question: string;
  requestType?: AiRequestType;
  movementCount?: number;
  sessionCount?: number;
  caseCount?: number;
  documentCount?: number;
}

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function determineRequestType(question: string): AiRequestType {
  const text = normalized(question);
  if (/\b(agrega|anade|añade|registra|vigila|da de alta)\b/.test(text) && /\b(expediente|amparo|queja|toca|asunto)\b/.test(text)) return "add_cases";
  if (/\b(listad[oa]|sesion|sesiono|ponente|sentido)\b/.test(text)) return "session_lookup";
  if (/\b(analiza|interpretacion|implicaciones|estrategia|riesgo procesal|razonamiento juridico)\b/.test(text)) return "legal_analysis";
  if (/\b(resume|resumen|explica|que ocurrio|cronologia)\b/.test(text)) return "summary";
  if (/\b(publicaciones|resoluciones|acuerdos|autos|boletin)\b/.test(text)) return "publication_list";
  if (/\b(expediente|asunto|carpeta|organo|juzgado|tribunal|sala)\b/.test(text)) return "case_lookup";
  return "general";
}

export function determineAiTier(input: AiRoutingContext): AiTier {
  const text = normalized(input.question);
  const requestType = input.requestType ?? determineRequestType(input.question);
  if (requestType === "add_cases" || requestType === "case_lookup" || requestType === "publication_list" || requestType === "session_lookup") return "fast";
  const movements = input.movementCount ?? 0;
  const sessions = input.sessionCount ?? 0;
  const cases = input.caseCount ?? 0;
  const documents = input.documentCount ?? 0;
  const premiumLanguage = /\b(analisis juridico exhaustivo|estrategia procesal|riesgo procesal|constitucionalidad|control de convencionalidad|conflicto de criterios|alta complejidad|opinion juridica integral)\b/.test(text);
  if (input.question.length > 2600 || documents >= 8 || (premiumLanguage && (movements >= 45 || cases >= 8))) return "premium";
  const proLanguage = /\b(analiza|compara|cronologia|antecedentes|implicaciones|interpretacion|razonamiento juridico|todos los movimientos|varios expedientes)\b/.test(text);
  if (requestType === "legal_analysis" || input.question.length > 800 || movements >= 30 || sessions >= 12 || documents >= 3 || (proLanguage && (movements >= 8 || cases >= 3))) return "pro";
  return "fast";
}

export const AI_TIER_LIMITS: Record<AiTier, { maxOutputTokens: number; timeoutMs: number }> = {
  fast: { maxOutputTokens: 800, timeoutMs: 60_000 },
  pro: { maxOutputTokens: 1_900, timeoutMs: 90_000 },
  premium: { maxOutputTokens: 3_500, timeoutMs: 120_000 },
};

export function fallbackTiers(initial: AiTier): AiTier[] {
  if (initial === "fast") return ["fast", "pro", "premium"];
  if (initial === "pro") return ["pro", "premium"];
  return ["premium"];
}
