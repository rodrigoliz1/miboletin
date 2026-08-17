import { describe, expect, it } from "vitest";
import { determineAiTier, determineRequestType, fallbackTiers } from "@/lib/ai/routing";

describe("AI routing", () => {
  it("routes operational assistant tools to the economical tier", () => {
    const question = "Agrega el expediente 93/2026 de la Tercera Sala a General";
    expect(determineRequestType(question)).toBe("add_cases");
    expect(determineAiTier({ question })).toBe("fast");
  });

  it("uses pro and premium only for materially complex analysis", () => {
    expect(determineAiTier({ question: "Analiza las implicaciones de todos los movimientos", movementCount: 35 })).toBe("pro");
    expect(determineAiTier({ question: "Prepara un análisis jurídico exhaustivo de alta complejidad", movementCount: 50, caseCount: 9 })).toBe("premium");
  });

  it("has a finite one-way fallback chain", () => {
    expect(fallbackTiers("fast")).toEqual(["fast", "pro", "premium"]);
    expect(fallbackTiers("premium")).toEqual(["premium"]);
  });
});
