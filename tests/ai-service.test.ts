import { describe, expect, it, vi } from "vitest";
import { executeAiRequest, type AiProviderTransport, type AiProviderResponse } from "@/lib/ai/service";
import type { AiConfiguration } from "@/lib/ai/config";

const configuration: AiConfiguration = {
  apiKey: "test-key-never-logged",
  baseURL: "https://gateway.example/v1",
  provider: "test-gateway",
  models: { fast: "fast-model", pro: "pro-model", premium: "premium-model" },
};

function ok(content = "respuesta"): AiProviderResponse {
  return { id: "response-1", choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } };
}

describe("AI service", () => {
  it("falls back once per configured tier and records each attempt", async () => {
    const complete = vi.fn<AiProviderTransport["complete"]>()
      .mockRejectedValueOnce(Object.assign(new Error("rate limited"), { status: 429 }))
      .mockResolvedValueOnce(ok());
    const events: unknown[] = [];
    const result = await executeAiRequest({ initialTier: "fast", requestType: "general", body: { messages: [] }, parse: (response) => response.choices?.[0]?.message?.content ?? "" }, {
      configuration, transport: { complete }, recordUsage: async (event) => { events.push(event); }, requestId: "00000000-0000-4000-8000-000000000001",
    });
    expect(complete.mock.calls.map(([body]) => body.model)).toEqual(["fast-model", "pro-model"]);
    expect(result).toMatchObject({ model: "pro-model", tier: "pro", fallbackUsed: true, inputTokens: 10, outputTokens: 4 });
    expect(events).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain(configuration.apiKey);
  });

  it("does not mask an authentication failure with another model", async () => {
    const complete = vi.fn<AiProviderTransport["complete"]>().mockRejectedValue(Object.assign(new Error("unauthorized"), { status: 401 }));
    await expect(executeAiRequest({ initialTier: "fast", requestType: "general", body: {}, parse: () => "" }, {
      configuration, transport: { complete }, recordUsage: async () => undefined,
    })).rejects.toThrow("unauthorized");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("falls back from pro to premium without trying fast", async () => {
    const complete = vi.fn<AiProviderTransport["complete"]>()
      .mockRejectedValueOnce(Object.assign(new Error("timeout"), { status: 408 }))
      .mockResolvedValueOnce(ok());
    const result = await executeAiRequest({ initialTier: "pro", requestType: "summary", body: {}, parse: (response) => response.choices?.[0]?.message?.content ?? "" }, {
      configuration, transport: { complete }, recordUsage: async () => undefined,
    });
    expect(complete.mock.calls.map(([body]) => body.model)).toEqual(["pro-model", "premium-model"]);
    expect(result.tier).toBe("premium");
  });

  it("contains model-specific tool incompatibility inside the provider layer", async () => {
    const complete = vi.fn<AiProviderTransport["complete"]>()
      .mockRejectedValueOnce(Object.assign(new Error("function calling is not supported by this model"), { status: 400 }))
      .mockResolvedValueOnce(ok());
    const result = await executeAiRequest({ initialTier: "fast", requestType: "add_cases", body: { tools: [] }, parse: () => "ok" }, {
      configuration, transport: { complete }, recordUsage: async () => undefined,
    });
    expect(result.tier).toBe("pro");
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("stops after the three-tier fallback budget", async () => {
    const complete = vi.fn<AiProviderTransport["complete"]>().mockRejectedValue(Object.assign(new Error("provider down"), { status: 503 }));
    await expect(executeAiRequest({ initialTier: "fast", requestType: "general", body: {}, parse: () => "" }, {
      configuration, transport: { complete }, recordUsage: async () => undefined,
    })).rejects.toThrow("provider down");
    expect(complete).toHaveBeenCalledTimes(3);
  });
});
