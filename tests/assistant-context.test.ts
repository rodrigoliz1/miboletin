import { describe, expect, it } from "vitest";
import { resolveAssistantPeriod } from "@/lib/assistant/context";

const now = new Date("2026-08-15T18:00:00.000Z");

describe("assistant period resolution", () => {
  it("understands common Spanish periods", () => {
    expect(resolveAssistantPeriod("¿Qué autos salieron hoy?", now)).toEqual({ from: "2026-08-15", to: "2026-08-15", label: "hoy" });
    expect(resolveAssistantPeriod("Muéstrame lo de ayer", now)).toEqual({ from: "2026-08-14", to: "2026-08-14", label: "ayer" });
    expect(resolveAssistantPeriod("¿Qué pasó este mes?", now)).toEqual({ from: "2026-08-01", to: "2026-08-15", label: "este mes" });
  });

  it("uses explicit Mexican dates and orders ranges", () => {
    expect(resolveAssistantPeriod("Del 03/08/2026 al 10/08/2026", now)).toEqual({ from: "2026-08-03", to: "2026-08-10", label: "2026-08-03 a 2026-08-10" });
  });
});
