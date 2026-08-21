import { describe, expect, it } from "vitest";
import { canonicalCaseKey, normalizeCaseNumber, normalizeName, sha256, stableJson } from "@/lib/domain/normalization";
import { normalizeJaliscoSourceCaseNumber } from "@/lib/providers/jalisco/provider";

describe("normalizeCaseNumber", () => {
  it.each(["192/2025", "192 / 2025", "00192/2025", "192-2025"])("normaliza %s sin perder número y año", (raw) => {
    expect(normalizeCaseNumber(raw)).toEqual({ normalized: "192/2025", number: 192, year: 2025 });
  });
  it("conserva sufijos oficiales de expedientes penales", () => {
    expect(normalizeCaseNumber("335/2005-D-S-A")).toEqual({ normalized: "335/2005-D-S-A", number: 335, year: 2005, suffix: "D-S-A" });
  });
  it("rechaza representaciones sin año de cuatro dígitos", () => expect(() => normalizeCaseNumber("192/25")).toThrow());
  it("normaliza años históricos abreviados sólo en el adaptador oficial CJJ", () => {
    expect(normalizeJaliscoSourceCaseNumber("1693/96").normalized).toBe("1693/1996");
    expect(normalizeJaliscoSourceCaseNumber("192/25").normalized).toBe("192/2025");
    expect(normalizeJaliscoSourceCaseNumber("192/2025").normalized).toBe("192/2025");
    expect(normalizeJaliscoSourceCaseNumber("335/2005-D-S-A").normalized).toBe("335/2005-D-S-A");
  });
});

describe("normalización canónica", () => {
  it("normaliza nombres sin tildes ni ruido", () => expect(normalizeName("  María, José Álvarez  ")).toBe("MARIA JOSE ALVAREZ"));
  it("incluye jurisdicción y órgano en la llave", () => {
    expect(canonicalCaseKey({ jurisdiction: "JALISCO", provider: "cjj", courtExternalId: "C01", caseType: "Civil ordinario", number: 192, year: 2025 })).toBe("JALISCO:cjj:C01:CIVIL ORDINARIO:192:2025");
  });
  it("incluye el sufijo cuando forma parte del expediente", () => {
    expect(canonicalCaseKey({ jurisdiction: "JALISCO", provider: "cjj", courtExternalId: "09P", number: 335, year: 2005, suffix: "D-S-A" })).toBe("JALISCO:cjj:09P:SIN TIPO:335:2005:D-S-A");
  });
  it("genera JSON y hash determinísticos", () => expect(sha256(stableJson({ b: 2, a: 1 }))).toBe(sha256(stableJson({ a: 1, b: 2 }))));
});
