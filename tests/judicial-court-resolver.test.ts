import { describe, expect, it } from "vitest";
import { JudicialOrganResolver, inferJudicialCourtSource, type CanonicalJudicialCourt } from "@/lib/judicial/court-resolver";
import { stjChambers } from "@/lib/providers/stj/provider";

const stjCatalog: CanonicalJudicialCourt[] = stjChambers.map((court) => ({
  ...court,
  jurisdiction: "JALISCO",
  source: "STJ_JALISCO",
  courtType: "STJ_CHAMBER",
}));

const localCatalog: CanonicalJudicialCourt[] = [
  { externalId: "C05", name: "JUZGADO QUINTO DE LO CIVIL", jurisdiction: "JALISCO", source: "JALISCO_CJJ", matter: "Civil" },
  { externalId: "M05", name: "JUZGADO QUINTO DE LO MERCANTIL", jurisdiction: "JALISCO", source: "JALISCO_CJJ", matter: "Mercantil" },
  { externalId: "F05", name: "JUZGADO QUINTO DE LO FAMILIAR", jurisdiction: "JALISCO", source: "JALISCO_CJJ", matter: "Familiar" },
  { externalId: "OM05", name: "JUZGADO DÉCIMO QUINTO ORAL MERCANTIL", jurisdiction: "JALISCO", source: "JALISCO_CJJ", matter: "Mercantil" },
];

describe("JudicialOrganResolver", () => {
  it.each([
    "Novena Sala Especializada en Materia Civil",
    "TOCA 210/2026 Novena Sala Civil del Supremo Tribunal de Justicia del Estado de Jalisco",
    "210/2026 novena sala civil",
    "toca 210/2026 sala novena civil",
    "agrega 210/2026 de la 9 sala civil",
    "agrega toca 210/2026 9a sala civil jalisco",
    "210/2026 Novena Civil STJ",
    "agrega el toca 210/2026 en la novena sala",
    "TOCA: 210/2026 | Novena Sala Civil del Supremo Tribunal de Justicia del Estado de Jalisco",
  ])("resuelve variantes STJ al mismo identificador: %s", (rawQuery) => {
    const result = new JudicialOrganResolver(stjCatalog).resolve({ rawQuery, caseNumber: "210/2026", caseType: "Toca", jurisdictionHint: "JALISCO" });
    expect(result).toMatchObject({ status: "RESOLVED", court: { externalId: "9" } });
  });

  it.each([
    "12/2025 Juzgado Quinto Mercantil Jalisco",
    "12/2025 quinto mercantil",
    "exp 12/2025 5 mercantil",
    "agrega 12/2025 del juzgado 5 de lo mercantil",
    "expediente 12/2025 quinto de lo mercantil",
    "12/2025 juzgado quinto mercantil guadalajara",
    "juzgado quinto mercantl",
  ])("resuelve variantes mercantiles sin confundir Décimo Quinto: %s", (rawQuery) => {
    const result = new JudicialOrganResolver(localCatalog).resolve({ rawQuery, caseNumber: "12/2025", jurisdictionHint: "JALISCO" });
    expect(result).toMatchObject({ status: "RESOLVED", court: { externalId: "M05" } });
  });

  it("rechaza contradicciones de materia y ordinal", () => {
    const resolver = new JudicialOrganResolver(localCatalog);
    expect(resolver.resolve({ rawQuery: "Quinto Civil", jurisdictionHint: "JALISCO" }).court?.externalId).toBe("C05");
    expect(resolver.resolve({ rawQuery: "Quinto Civil", jurisdictionHint: "JALISCO" }).alternatives.some((item) => item.court.externalId === "M05")).toBe(false);
    expect(new JudicialOrganResolver(stjCatalog).resolve({ rawQuery: "Octava Sala Civil", caseType: "Toca" }).court?.externalId).toBe("8");
  });

  it("distingue una ambigüedad auténtica de un órgano no encontrado", () => {
    const resolver = new JudicialOrganResolver(localCatalog);
    const ambiguous = resolver.resolve({ rawQuery: "juzgado quinto", jurisdictionHint: "JALISCO" });
    expect(ambiguous.status).toBe("AMBIGUOUS");
    expect(ambiguous.alternatives.map((item) => item.court.externalId)).toEqual(expect.arrayContaining(["C05", "M05", "F05"]));
    expect(resolver.resolve({ rawQuery: "Sala vigésima tributaria", jurisdictionHint: "JALISCO" }).status).toBe("NOT_FOUND");
  });

  it("tolera errores menores del tipo de órgano y conserva la fuente correcta", () => {
    const result = new JudicialOrganResolver(stjCatalog).resolve({ rawQuery: "novena sla civil supremo tribnal", caseType: "Toca" });
    expect(result).toMatchObject({ status: "RESOLVED", court: { externalId: "9" } });
    expect(inferJudicialCourtSource({ rawQuery: "Juzgado Primero de Distrito", jurisdictionHint: null })).toBe("FEDERAL_PJF");
  });

  it("prioriza la Sala local sobre un tipo genérico y conserva las quejas colegiadas como federales", () => {
    expect(inferJudicialCourtSource({
      rawQuery: "Novena Sala Civil del STJ", caseType: "Toca / Queja", jurisdictionHint: "JALISCO",
    })).toBe("STJ_JALISCO");
    expect(inferJudicialCourtSource({
      rawQuery: "recurso de queja del Tercer Tribunal Colegiado", caseType: "Queja", jurisdictionHint: null,
    })).toBe("FEDERAL_PJF");
  });

  it("normaliza ordinales compuestos escritos juntos o separados", () => {
    const resolver = new JudicialOrganResolver(localCatalog);
    expect(resolver.resolve({ rawQuery: "décimo quinto oral mercantil", jurisdictionHint: "JALISCO" }).court?.externalId).toBe("OM05");
    expect(resolver.resolve({ rawQuery: "decimoquinto oral mercantil", jurisdictionHint: "JALISCO" }).court?.externalId).toBe("OM05");
  });
});
