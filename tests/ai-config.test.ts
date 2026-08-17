import { describe, expect, it } from "vitest";
import { AiConfigurationError, getAiConfiguration } from "@/lib/ai/config";

describe("AI configuration", () => {
  it("reports a missing server key clearly", () => {
    expect(() => getAiConfiguration({ NODE_ENV: "test", AI_MODEL_FAST: "fast" } as NodeJS.ProcessEnv)).toThrow(AiConfigurationError);
    expect(() => getAiConfiguration({ NODE_ENV: "test", AI_MODEL_FAST: "fast" } as NodeJS.ProcessEnv)).toThrow("AI_API_KEY no está configurada");
  });

  it("accepts the recommended gateway variables without exposing or rewriting model identifiers", () => {
    expect(getAiConfiguration({ NODE_ENV: "test", AI_API_KEY: "secret", AI_BASE_URL: "https://gateway.example/v1", AI_MODEL_FAST: "provider/model" } as NodeJS.ProcessEnv)).toEqual({
      apiKey: "secret", baseURL: "https://gateway.example/v1", models: { fast: "provider/model", pro: undefined, premium: undefined }, provider: "openai-compatible",
    });
  });

  it("keeps legacy variables only as a compatibility fallback", () => {
    expect(getAiConfiguration({ NODE_ENV: "test", OPENAI_API_KEY: "legacy", OPENAI_MODEL: "legacy-model" } as NodeJS.ProcessEnv).models.fast).toBe("legacy-model");
  });
});
