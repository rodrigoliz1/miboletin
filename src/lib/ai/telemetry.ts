import { db } from "@/lib/db/client";
import type { AiTier } from "@/lib/ai/config";

export interface ModelPricing {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cachedInputUsdPerMillion?: number;
}

// Intencionalmente vacío: los precios del gateway pueden cambiar. Puede
// ampliarse mediante AI_MODEL_PRICING_JSON sin desplegar código nuevo.
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = Object.freeze({});

function configuredPricing(raw = process.env.AI_MODEL_PRICING_JSON): Record<string, ModelPricing> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<ModelPricing>>;
    return Object.fromEntries(Object.entries(parsed).flatMap(([model, price]) => {
      const input = Number(price.inputUsdPerMillion);
      const output = Number(price.outputUsdPerMillion);
      const cached = price.cachedInputUsdPerMillion === undefined ? undefined : Number(price.cachedInputUsdPerMillion);
      return Number.isFinite(input) && input >= 0 && Number.isFinite(output) && output >= 0 && (cached === undefined || (Number.isFinite(cached) && cached >= 0))
        ? [[model, { inputUsdPerMillion: input, outputUsdPerMillion: output, ...(cached === undefined ? {} : { cachedInputUsdPerMillion: cached }) }]]
        : [];
    }));
  } catch { return {}; }
}

export function estimateAiCostUsd(input: { model: string; inputTokens?: number; outputTokens?: number; cachedInputTokens?: number }, pricing: Record<string, ModelPricing> = { ...MODEL_PRICING, ...configuredPricing() }): number | null {
  const price = pricing[input.model];
  if (!price) return null;
  const cached = Math.min(input.inputTokens ?? 0, input.cachedInputTokens ?? 0);
  const uncached = Math.max(0, (input.inputTokens ?? 0) - cached);
  const amount = (uncached * price.inputUsdPerMillion + cached * (price.cachedInputUsdPerMillion ?? price.inputUsdPerMillion) + (input.outputTokens ?? 0) * price.outputUsdPerMillion) / 1_000_000;
  return Number(amount.toFixed(8));
}

export interface AiUsageEvent {
  requestId: string;
  organizationId?: string;
  userId?: string;
  conversationId?: string;
  provider: string;
  modelUsed: string;
  tier: AiTier;
  attemptNumber: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  latencyMs: number;
  fallbackUsed: boolean;
  fallbackFrom?: string;
  requestType: string;
  success: boolean;
  errorType?: string;
  estimatedCostUsd?: number | null;
  providerResponseId?: string;
}

export async function recordAiUsage(input: AiUsageEvent): Promise<void> {
  await db()`
    INSERT INTO ai_usage_events (
      request_id, organization_id, user_id, conversation_id, provider, model_used, tier,
      attempt_number, input_tokens, output_tokens, total_tokens, cached_input_tokens,
      latency_ms, fallback_used, fallback_from, request_type, success, error_type,
      estimated_cost_usd, provider_response_id
    ) VALUES (
      ${input.requestId}, ${input.organizationId ?? null}, ${input.userId ?? null}, ${input.conversationId ?? null},
      ${input.provider}, ${input.modelUsed}, ${input.tier}, ${input.attemptNumber},
      ${input.inputTokens ?? null}, ${input.outputTokens ?? null}, ${input.totalTokens ?? null}, ${input.cachedInputTokens ?? null},
      ${input.latencyMs}, ${input.fallbackUsed}, ${input.fallbackFrom ?? null}, ${input.requestType}, ${input.success},
      ${input.errorType ?? null}, ${input.estimatedCostUsd ?? null}, ${input.providerResponseId ?? null}
    )
    ON CONFLICT (request_id, attempt_number) DO NOTHING
  `;
}
