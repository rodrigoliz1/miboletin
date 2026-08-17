import { describe, expect, it } from "vitest";
import { matchCase, matchName } from "@/lib/domain/matching";

const base = { jurisdiction: "JALISCO", provider: "jalisco-cjj", courtExternalId: "C01", caseType: "CIVIL ORDINARIO", caseNumber: "192/2025" };

describe("matching determinístico", () => {
  it("confirma coincidencia exacta", () => expect(matchCase(base, { ...base, caseNumber: "00192 / 2025" })).toBe("EXACT"));
  it("marca órgano distinto como ambiguo", () => expect(matchCase(base, { ...base, courtExternalId: "C02" })).toBe("AMBIGUOUS"));
  it("marca tipo distinto como probable", () => expect(matchCase(base, { ...base, caseType: "CIVIL SUMARIO" })).toBe("PROBABLE"));
  it("rechaza jurisdicción distinta", () => expect(matchCase(base, { ...base, jurisdiction: "FEDERAL" })).toBe("NO_MATCH"));
});

describe("matching de nombres", () => {
  it("respeta coincidencia exacta normalizada", () => expect(matchName("María Álvarez", "MARIA ALVAREZ", "EXACT")).toBe("EXACT"));
  it("etiqueta coincidencia flexible como probable", () => expect(matchName("Constructora del Valle", "CONSTRUCTORA DEL VALLE SA DE CV", "FLEXIBLE")).toBe("PROBABLE"));
  it("no suaviza reglas exactas", () => expect(matchName("Constructora del Valle", "CONSTRUCTORA DEL VALLE SA", "EXACT")).toBe("NO_MATCH"));
});
