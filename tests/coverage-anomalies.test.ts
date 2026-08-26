import { describe, expect, it } from "vitest";
import { shouldFlagZeroPartyExtraction } from "@/lib/parties/coverage";

describe("anomalías de extracción de partes", () => {
  it("no confunde publicaciones duplicadas con una falla del extractor", () => {
    expect(shouldFlagZeroPartyExtraction("jalisco-cjj", { recordsInserted: 0, partiesFound: 0 })).toBe(false);
  });

  it("alerta cuando una carga nueva considerable no produce ningún nombre", () => {
    expect(shouldFlagZeroPartyExtraction("jalisco-cjj", { recordsInserted: 12, partiesFound: 0 })).toBe(true);
  });

  it("no aplica la regla específica de Jalisco a otra fuente", () => {
    expect(shouldFlagZeroPartyExtraction("federal-pjf-session-lists", { recordsInserted: 12, partiesFound: 0 })).toBe(false);
  });
});
