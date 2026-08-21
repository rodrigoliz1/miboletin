import { describe, expect, it } from "vitest";
import { canonicalSimilarity, findCanonicalParty } from "@/lib/parties/canonicalization";
import { extractFederalParties } from "@/lib/parties/federal-extractor";
import { corporateSearchName, normalizePartyName, partyTokenSignature } from "@/lib/parties/normalization";
import { parsePartyNames } from "@/lib/parties/parser";
import { extractParties } from "@/lib/parties/extractor";

const parse = (value: string) => parsePartyNames(value, { side: "plaintiff" });

describe("PartyNameParser", () => {
  it("conserva una persona física simple", () => {
    expect(parse("LUIS EDUARDO RODRIGUEZ COVARRUBIAS")).toMatchObject([{ nameNormalized: "LUIS EDUARDO RODRIGUEZ COVARRUBIAS", partyType: "PERSON" }]);
  });

  it("reconoce una sociedad", () => {
    expect(parse("DESARROLLADORA YEMANYA S.A. DE C.V.")).toMatchObject([{ partyType: "COMPANY", searchName: "DESARROLLADORA YEMANYA" }]);
  });

  it("no rompe una sociedad larga con comas internas", () => {
    const result = parse("SWELL FINANZAS EN MOVIMIENTO, SOCIEDAD ANÓNIMA PROMOTORA DE INVERSIÓN DE CAPITAL VARIABLE, SOCIEDAD FINANCIERA DE OBJETO MÚLTIPLE ENTIDAD NO REGULADA");
    expect(result).toHaveLength(1);
    expect(result[0].partyType).toBe("COMPANY");
    expect(result[0].nameRaw).toContain("SOCIEDAD FINANCIERA");
  });

  it("separa conservadoramente una empresa y dos personas", () => {
    const result = parse("INMOBILIARIA DEL PACÍFICO PYI S.A. DE C.V., ERIK BRISEÑO AHUMADA, MARIA GUADALUPE ESPINOZA RAMIREZ");
    expect(result.map((item) => item.nameNormalized)).toEqual([
      "INMOBILIARIA DEL PACIFICO PYI S A DE C V",
      "ERIK BRISENO AHUMADA",
      "MARIA GUADALUPE ESPINOZA RAMIREZ",
    ]);
  });

  it("no inventa las personas comprendidas por 'y otros'", () => {
    const result = parse("JUAN PEREZ GONZALEZ Y OTROS");
    expect(result).toHaveLength(1);
    expect(result[0].nameNormalized).toBe("JUAN PEREZ GONZALEZ");
    expect(result[0].metadata.omittedOthers).toBe(true);
  });

  it("normaliza Unicode, tildes, puntuación e invisibles", () => {
    expect(normalizePartyName("  JOSÉ\u200b PÉREZ\n")).toBe("JOSE PEREZ");
    expect(normalizePartyName("JOSE PEREZ")).toBe(normalizePartyName("JOSÉ PÉREZ"));
  });

  it("genera una forma societaria simplificada sin perder palabras distintivas", () => {
    expect(corporateSearchName("BANCO ABC, S.A. DE C.V.")).toBe("BANCO ABC");
  });

  it.each([
    "José Pérez López",
    "JOSE PEREZ LOPEZ",
    "PÉREZ LÓPEZ, JOSÉ",
    "C. José Pérez López",
  ])("produce la misma firma de tokens para %s", (value) => {
    expect(partyTokenSignature(value)).toBe("JOSE LOPEZ PEREZ");
  });

  it("equipara razones sociales abreviadas y desarrolladas", () => {
    expect(corporateSearchName("EMPRESA EJEMPLO SA DE CV")).toBe("EMPRESA EJEMPLO");
    expect(corporateSearchName("EMPRESA EJEMPLO, S.A. DE C.V.")).toBe("EMPRESA EJEMPLO");
    expect(corporateSearchName("EMPRESA EJEMPLO SOCIEDAD ANÓNIMA DE CAPITAL VARIABLE")).toBe("EMPRESA EJEMPLO");
  });

  it("no convierte nombres distintos en firmas exactas", () => {
    expect(partyTokenSignature("JOSE PEREZ LOPEZ")).not.toBe(partyTokenSignature("JOSE PEREZ LOPEZ GARCIA"));
  });
});

describe("canonicalización conservadora", () => {
  const existing = [{ id: "one", nameRaw: "ANACLETO GABRIEL DE LA DOLOROSA COVARRUBIAS GARCIA", nameNormalized: "ANACLETO GABRIEL DE LA DOLOROSA COVARRUBIAS GARCIA", side: "plaintiff", partyType: "PERSON" }];
  it("tolera orden de tokens e iniciales dentro del mismo expediente y rol", () => {
    expect(canonicalSimilarity(existing[0].nameNormalized, "COVARRUBIAS GARCIA ANACLETO GABRIEL DE LA DOLOROSA")).toBe(1);
    const candidate = parse("ANACLETO GABRIEL DE LA DOLOROSA COVARRUBIAS G.")[0];
    expect(findCanonicalParty(candidate, existing)?.id).toBe("one");
  });
  it("no fusiona nombres cortos parecidos", () => {
    const candidate = parse("JUAN PEREZ")[0];
    const people = [{ id: "a", nameRaw: "JUAN CARLOS PEREZ", nameNormalized: "JUAN CARLOS PEREZ", side: "plaintiff", partyType: "PERSON" }];
    expect(findCanonicalParty(candidate, people)).toBeNull();
  });
  it("respeta lado y tipo procesal", () => {
    const candidate = parsePartyNames("ANACLETO GABRIEL DE LA DOLOROSA COVARRUBIAS GARCIA", { side: "defendant" })[0];
    expect(findCanonicalParty(candidate, existing)).toBeNull();
  });
});

describe("FederalPartyExtractor", () => {
  it("prefiere campos estructurados", () => {
    const result = extractFederalParties({ structured: { complainant: "JOSE PEREZ LOPEZ", authority: "INSTITUTO EJEMPLO" } });
    expect(result.map((item) => item.side)).toEqual(["quejoso", "autoridad_responsable"]);
  });
  it("extrae HTML semiestructurado por etiquetas", () => {
    const result = extractFederalParties({ rawHtml: "<table><tr><td>Quejoso</td><td>MARIA LOPEZ RAMIREZ</td></tr><tr><td>Tercero interesado</td><td>EMPRESA EJEMPLO S.A. DE C.V.</td></tr></table>" });
    expect(result.map((item) => item.side)).toEqual(["quejoso", "tercero_interesado"]);
  });
  it("no indexa contenido anonimizado ni cargos judiciales", () => {
    expect(extractFederalParties({ structured: { complainant: "****" } })).toEqual([]);
    expect(extractFederalParties({ officialText: "Quejoso: JUEZ JUAN PEREZ. Secretario: PEDRO LOPEZ" })).toEqual([]);
  });
  it("conserva una autoridad responsable explícita", () => {
    const result = extractFederalParties({ structured: { authority: "AYUNTAMIENTO DE EJEMPLO" } });
    expect(result[0]).toMatchObject({ side: "autoridad_responsable", partyType: "AUTHORITY" });
  });
  it("no descarta las partes ya obtenidas de VerCaptura cuando también existe HTML", () => {
    const result = extractParties({
      provider: "federal-pjf-session-lists",
      parties: { plaintiff: "PERSONA PUBLICADA DE PRUEBA" },
      rawPayload: {}, rawText: "<html><body><div id='pBody1'>Historial oficial</div></body></html>",
      officialText: "Acuerdo publicado",
    });
    expect(result).toMatchObject([{ side: "plaintiff", nameNormalized: "PERSONA PUBLICADA DE PRUEBA" }]);
  });
  it("extrae sólo etiquetas explícitas del historial y rechaza prosa jurídica genérica", () => {
    const result = extractFederalParties({
      rawHtml: "<html><body><div id='pBody1'>Quejoso: MARIA ELENA RAMIREZ LOPEZ.</div><div id='pBody2'>Autoridad responsable: dentro del expediente 44/2026.</div></body></html>",
    });
    expect(result).toMatchObject([{ side: "quejoso", nameNormalized: "MARIA ELENA RAMIREZ LOPEZ" }]);
    expect(result).toHaveLength(1);
  });
});

describe("ingestión estructurada Jalisco", () => {
  it("convierte los campos oficiales actor/demandado en identidades trazables", () => {
    const result = extractParties({
      provider: "jalisco-cjj",
      rawPayload: { act_names: "JOSEFINA FUENTES CORRAL", dem_names: "EMPRESA EJEMPLO, S.A. DE C.V." },
      officialText: "Se provee escrito.",
    });
    expect(result).toMatchObject([
      { nameNormalized: "JOSEFINA FUENTES CORRAL", side: "plaintiff", extractionMethod: "structured_field", confidence: 0.99 },
      { searchName: "EMPRESA EJEMPLO", side: "defendant", partyType: "COMPANY", extractionMethod: "structured_field" },
    ]);
  });
});
