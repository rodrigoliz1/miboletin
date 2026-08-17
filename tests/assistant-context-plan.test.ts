import { describe, expect, it } from "vitest";
import { planAssistantContext } from "@/lib/assistant/context";

describe("assistant context planning", () => {
  const now = new Date("2026-08-17T18:00:00.000Z");

  it("does not load judicial history when adding cases", () => {
    const plan = planAssistantContext("Agrega el expediente 1585/2025 al Juzgado Primero de Distrito", now);
    expect(plan).toMatchObject({ requestType: "add_cases", caseLimit: 0, needsMovements: false, needsSessions: false, needsDocuments: false });
  });

  it("bounds generic context to thirty days", () => {
    const plan = planAssistantContext("Muéstrame las resoluciones", now);
    expect(plan.period).toEqual({ from: "2026-07-18", to: "2026-08-17", label: "los últimos 30 días" });
  });
});
