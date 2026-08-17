export type AiTier = "fast" | "pro" | "premium";

export interface AiConfiguration {
  apiKey: string;
  baseURL: string;
  models: Partial<Record<AiTier, string>>;
  provider: string;
}

export class AiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigurationError";
  }
}

function value(input: string | undefined): string | undefined {
  const normalized = input?.trim();
  return normalized || undefined;
}

export function getAiConfiguration(env: NodeJS.ProcessEnv = process.env): AiConfiguration {
  const apiKey = value(env.AI_API_KEY) ?? value(env.OPENAI_API_KEY);
  if (!apiKey) throw new AiConfigurationError("AI_API_KEY no está configurada");
  const baseURL = value(env.AI_BASE_URL) ?? value(env.OPENAI_BASE_URL) ?? "https://api.openai.com/v1";
  let parsed: URL;
  try { parsed = new URL(baseURL); }
  catch { throw new AiConfigurationError("AI_BASE_URL no es una URL válida"); }
  if (parsed.protocol !== "https:" && env.NODE_ENV === "production") throw new AiConfigurationError("AI_BASE_URL debe usar HTTPS en producción");
  const models: Partial<Record<AiTier, string>> = {
    fast: value(env.AI_MODEL_FAST) ?? value(env.OPENAI_MODEL),
    pro: value(env.AI_MODEL_PRO),
    premium: value(env.AI_MODEL_PREMIUM),
  };
  if (!models.fast && !models.pro && !models.premium) throw new AiConfigurationError("No hay modelos de IA configurados");
  return {
    apiKey,
    baseURL: parsed.toString().replace(/\/$/, ""),
    models,
    provider: parsed.hostname.toLowerCase().includes("tokease.com") ? "tokease" : "openai-compatible",
  };
}

export function isAiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try { getAiConfiguration(env); return true; }
  catch { return false; }
}
