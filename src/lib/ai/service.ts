import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { AiConfigurationError, getAiConfiguration, type AiConfiguration, type AiTier } from "@/lib/ai/config";
import { AI_TIER_LIMITS, fallbackTiers } from "@/lib/ai/routing";
import { estimateAiCostUsd, recordAiUsage, type AiUsageEvent } from "@/lib/ai/telemetry";

export interface AiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface AiProviderResponse {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string | null; tool_calls?: AiToolCall[] } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    input_tokens_details?: { cached_tokens?: number };
  };
}

export interface AiProviderTransport {
  complete(body: Record<string, unknown>, options: { timeoutMs: number; apiKey: string; baseURL: string }): Promise<AiProviderResponse>;
}

let cachedClient: { identity: string; client: OpenAI } | null = null;

function providerClient(configuration: { apiKey: string; baseURL: string }): OpenAI {
  const identity = `${configuration.baseURL}\u0000${configuration.apiKey}`;
  if (cachedClient?.identity !== identity) cachedClient = {
    identity,
    client: new OpenAI({ apiKey: configuration.apiKey, baseURL: configuration.baseURL, maxRetries: 0, timeout: 120_000 }),
  };
  return cachedClient.client;
}

const defaultTransport: AiProviderTransport = {
  async complete(body, options) {
    const response = await providerClient(options).chat.completions.create(
      body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      { timeout: options.timeoutMs, maxRetries: 0 },
    );
    return response as unknown as AiProviderResponse;
  },
};

export class AiOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiOutputError";
  }
}

export interface AiExecutionResult<T> {
  value: T;
  model: string;
  tier: AiTier;
  responseId: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  fallbackUsed: boolean;
  fallbackFrom?: string;
}

interface ErrorClassification {
  type: string;
  recoverable: boolean;
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || !error) return undefined;
  const status = "status" in error ? Number(error.status) : "statusCode" in error ? Number(error.statusCode) : undefined;
  return Number.isFinite(status) ? status : undefined;
}

export function classifyAiError(error: unknown): ErrorClassification {
  if (error instanceof AiConfigurationError) return { type: "configuration", recoverable: false };
  if (error instanceof AiOutputError) return { type: "invalid_model_output", recoverable: true };
  const status = statusOf(error);
  const message = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : String(error).toLowerCase();
  if (status === 401 || status === 403) return { type: "authentication", recoverable: false };
  if (status === 400 && /(?:tool|function)[-_ ]?(?:call|calling)?.*(?:unsupported|not supported|not available)|(?:unsupported|not supported).*(?:tool|function)/.test(message)) return { type: "model_capability", recoverable: true };
  if (status === 400 || status === 404 || status === 422) return { type: "invalid_request", recoverable: false };
  if (status === 408) return { type: "timeout", recoverable: true };
  if (status === 429) return { type: "rate_limit", recoverable: true };
  if (status !== undefined && status >= 500) return { type: "provider_unavailable", recoverable: true };
  if (/timeout|timed out|abort/.test(message)) return { type: "timeout", recoverable: true };
  if (/connection|network|fetch failed|econnreset|socket/.test(message)) return { type: "network", recoverable: true };
  return { type: "unknown", recoverable: false };
}

function usageOf(response: AiProviderResponse) {
  const usage = response.usage;
  const inputTokens = usage?.prompt_tokens ?? usage?.input_tokens;
  const outputTokens = usage?.completion_tokens ?? usage?.output_tokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens: usage?.total_tokens ?? (inputTokens !== undefined || outputTokens !== undefined ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined),
    cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? usage?.input_tokens_details?.cached_tokens,
  };
}

export async function executeAiRequest<T>(input: {
  initialTier: AiTier;
  requestType: string;
  body: Record<string, unknown>;
  parse: (response: AiProviderResponse) => T;
  organizationId?: string;
  userId?: string;
  conversationId?: string;
}, dependencies: {
  configuration?: AiConfiguration;
  transport?: AiProviderTransport;
  recordUsage?: (event: AiUsageEvent) => Promise<void>;
  requestId?: string;
} = {}): Promise<AiExecutionResult<T>> {
  const configuration = dependencies.configuration ?? getAiConfiguration();
  const transport = dependencies.transport ?? defaultTransport;
  const telemetry = dependencies.recordUsage ?? recordAiUsage;
  const requestId = dependencies.requestId ?? randomUUID();
  const tiers = fallbackTiers(input.initialTier).filter((tier) => configuration.models[tier]);
  if (!tiers.length) throw new AiConfigurationError(`No hay un modelo configurado para el tier ${input.initialTier} ni sus fallbacks`);
  let previousModel: string | undefined;
  let lastError: unknown;

  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index];
    const model = configuration.models[tier]!;
    const started = Date.now();
    let event: AiUsageEvent;
    try {
      const response = await transport.complete({ ...input.body, model, max_completion_tokens: AI_TIER_LIMITS[tier].maxOutputTokens }, {
        timeoutMs: AI_TIER_LIMITS[tier].timeoutMs,
        apiKey: configuration.apiKey,
        baseURL: configuration.baseURL,
      });
      const value = input.parse(response);
      const usage = usageOf(response);
      event = {
        requestId, organizationId: input.organizationId, userId: input.userId, conversationId: input.conversationId,
        provider: configuration.provider, modelUsed: model, tier, attemptNumber: index + 1,
        ...usage, latencyMs: Math.max(0, Date.now() - started), fallbackUsed: index > 0,
        fallbackFrom: previousModel, requestType: input.requestType, success: true,
        estimatedCostUsd: estimateAiCostUsd({ model, ...usage }), providerResponseId: response.id,
      };
      await telemetry(event).catch((error) => console.error("AI telemetry could not be recorded", { requestId, error: error instanceof Error ? error.message : "unknown" }));
      return { value, model, tier, responseId: response.id ?? requestId, ...usage, fallbackUsed: index > 0, fallbackFrom: previousModel };
    } catch (error) {
      lastError = error;
      const classification = classifyAiError(error);
      event = {
        requestId, organizationId: input.organizationId, userId: input.userId, conversationId: input.conversationId,
        provider: configuration.provider, modelUsed: model, tier, attemptNumber: index + 1,
        latencyMs: Math.max(0, Date.now() - started), fallbackUsed: index > 0, fallbackFrom: previousModel,
        requestType: input.requestType, success: false, errorType: classification.type,
      };
      await telemetry(event).catch((telemetryError) => console.error("AI telemetry could not be recorded", { requestId, error: telemetryError instanceof Error ? telemetryError.message : "unknown" }));
      previousModel = model;
      if (!classification.recoverable || index === tiers.length - 1) throw error;
    }
  }
  throw lastError ?? new Error("AI_REQUEST_FAILED");
}
