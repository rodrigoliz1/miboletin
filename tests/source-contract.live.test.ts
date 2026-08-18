import { describe, expect, it } from "vitest";
import { JaliscoProvider } from "@/lib/providers/jalisco/provider";
import { FederalProvider } from "@/lib/providers/federal/provider";
import { StjJaliscoProvider } from "@/lib/providers/stj/provider";
import { JudicialOrganResolver } from "@/lib/judicial/court-resolver";

describe.skipIf(process.env.LIVE_SOURCE_TESTS !== "1")("contrato en vivo de Jalisco", () => {
  it("mantiene los cinco catálogos y sus campos esenciales", async () => {
    const provider = new JaliscoProvider();
    const courts = await provider.fetchCatalogs();
    expect(courts.length).toBeGreaterThanOrEqual(190);
    expect(new Set(courts.map((court) => court.externalId)).size).toBe(courts.length);
    expect(new Set(courts.map((court) => court.family))).toEqual(new Set(["METROPOLITAN", "FOREIGN", "LABOR", "TRADITIONAL_CRIMINAL", "ORAL_CRIMINAL"]));
    expect(courts[0]).toMatchObject({ jurisdiction: "JALISCO" });
  }, 30_000);

  it.each([
    ["metropolitano", "C01", "11/2026"],
    ["foráneo", "AH1", "76/2025"],
    ["laboral", "L03", "23/2023"],
    ["penal tradicional", "09P", "335/2005-D-S-A"],
    ["penal oral", "D14", "10214/2024"],
  ])("consulta un expediente real del catálogo %s", async (_family, court, caseNumber) => {
    const result = await new JaliscoProvider().searchCase(caseNumber, court);
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records[0].courtExternalId).toBe(court);
    expect(result.records[0].officialText.length).toBeGreaterThan(5);
  }, 30_000);
});

describe.skipIf(process.env.LIVE_SOURCE_TESTS !== "1")("contrato en vivo de Salas del STJ Jalisco", () => {
  it("mantiene las once Salas y consulta estrictamente un Toca real", async () => {
    const provider = new StjJaliscoProvider();
    expect(await provider.fetchCatalogs()).toHaveLength(11);
    const result = await provider.searchCase("125/2026", "5");
    expect(result.records).toHaveLength(3);
    expect(result.records.every((record) => record.courtExternalId === "5" && record.caseNumberRaw === "125/2026")).toBe(true);
    expect(result.records.some((record) => /Se dicta Sentencia/i.test(record.officialText))).toBe(true);
  }, 30_000);

  it("declara la protección interactiva del portal de sentencias sin evadirla", async () => {
    expect(await new StjJaliscoProvider().probeJudgmentSearchAccess()).toBe("RECAPTCHA_REQUIRED");
  }, 30_000);

  it("resuelve lenguaje natural y verifica el Toca 210/2026 en la Novena Sala Civil", async () => {
    const provider = new StjJaliscoProvider();
    const catalog = (await provider.fetchCatalogs()).map((court) => ({ ...court, jurisdiction: "JALISCO" as const, source: "STJ_JALISCO" as const, courtType: "STJ_CHAMBER" }));
    const resolution = new JudicialOrganResolver(catalog).resolve({
      rawQuery: "Novena Sala Civil del Supremo Tribunal de Justicia del Estado de Jalisco",
      caseNumber: "210/2026", caseType: "Toca", jurisdictionHint: "JALISCO", sourceHint: "STJ_JALISCO",
    });
    expect(resolution).toMatchObject({ status: "RESOLVED", court: { externalId: "9" } });
    expect((await provider.searchCase("210/2026", resolution.court!.externalId)).records.length).toBeGreaterThan(0);
  }, 30_000);
});

describe.skipIf(process.env.LIVE_SOURCE_TESTS !== "1")("resolución en vivo de órganos locales de Jalisco", () => {
  it("resuelve Quinto Mercantil sin confundirlo con Décimo Quinto", async () => {
    const provider = new JaliscoProvider();
    const catalog = (await provider.fetchCatalogs()).map((court) => ({ ...court, jurisdiction: "JALISCO" as const, source: "JALISCO_CJJ" as const }));
    const resolution = new JudicialOrganResolver(catalog).resolve({
      rawQuery: "Juzgado Quinto mercantil jalisco", caseNumber: "12/2025",
      jurisdictionHint: "JALISCO", sourceHint: "JALISCO_CJJ", matterHint: "Mercantil",
    });
    expect(resolution).toMatchObject({ status: "RESOLVED", court: { externalId: "M05" } });
    expect((await provider.searchCase("12/2025", resolution.court!.externalId)).records.length).toBeGreaterThan(0);
  }, 30_000);
});

describe.skipIf(process.env.LIVE_SOURCE_TESTS !== "1")("contrato en vivo de listas a sesión federales", () => {
  it("resuelve una abreviatura natural contra el catálogo vigente del Tercer Circuito", async () => {
    const provider = new FederalProvider();
    const circuit = (await provider.getCircuits()).find((item) => item.externalId === "3");
    expect(circuit).toBeDefined();
    const catalog = (await provider.getCourts("3")).map((court) => ({
      ...court,
      jurisdiction: "FEDERAL" as const,
      source: "FEDERAL_PJF" as const,
      circuit: circuit!.externalId,
      circuitName: circuit!.name,
    }));
    const resolution = new JudicialOrganResolver(catalog).resolve({
      rawQuery: "3er Tribunal Colegiado Civil del Tercer Circuito",
      caseNumber: "29/2026", caseType: "Queja", jurisdictionHint: "FEDERAL", sourceHint: "FEDERAL_PJF",
    });
    expect(resolution).toMatchObject({ status: "RESOLVED", court: { externalId: "136" } });
  }, 30_000);

  it("mantiene aislada la Queja 29/2026 por órgano, número y tipo", async () => {
    const records = await new FederalProvider().fetchCase("29/2026", "136", "Queja");
    const sessions = records.filter((record) => String(record.externalId).includes("case-"));
    expect(records.every((record) => record.caseType === "Queja")).toBe(true);
    expect(sessions.some((record) => record.publicationDate === "2026-07-31" && record.agreementDate === "2026-08-20")).toBe(true);
    expect(sessions.every((record) => record.agreementDate === "2026-08-20")).toBe(true);
  }, 30_000);

  it("obtiene los acuerdos y el estado de sesión de un expediente federal real", async () => {
    const records = await new FederalProvider().fetchCase("461/2024", "119", "Amparo Directo");
    expect(records.filter((record) => String(record.externalId).startsWith("agreement:"))).toHaveLength(5);
    expect(records.some((record) => String(record.externalId).endsWith("-listed"))).toBe(true);
    expect(records.some((record) => record.officialText.includes("SENTIDO: No ampara"))).toBe(true);
    expect(records[0].sourceUrl).toContain("VerAcuerdo.aspx");
  }, 30_000);

  it("obtiene circuito, tribunal, calendario y lista completa sin CAPTCHA", async () => {
    const provider = new FederalProvider();
    const circuits = await provider.getCircuits();
    expect(circuits).toHaveLength(32);
    const courts = await provider.getCourts("3");
    expect(courts.some((court) => court.externalId === "119")).toBe(true);
    const dates = await provider.getAvailableDates("119", "lista", 2026, 8);
    expect(dates).toContain("2026-08-07");
    const records = await provider.fetchByDate({ date: "2026-08-07", circuitId: "3", courtExternalId: "119", sourceMode: "LISTED" });
    expect(records.length).toBeGreaterThanOrEqual(40);
    expect(records[0]).toMatchObject({ courtExternalId: "119", sourceUrl: expect.stringContaining("oaj.gob.mx") });
    expect(records[0].agreementDate).toMatch(/^2026-08-/);
  }, 30_000);
});
