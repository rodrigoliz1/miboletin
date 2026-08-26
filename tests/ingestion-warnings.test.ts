import { describe, expect, it } from "vitest";
import type { JudicialSourceProvider, NormalizedPublication, RawPublication } from "@/lib/domain/types";
import { runIngestion } from "@/lib/ingestion/pipeline";

const validRaw: RawPublication = {
  courtExternalId: "M01",
  courtName: "Juzgado de prueba",
  caseNumberRaw: "10/2026",
  caseType: "Civil",
  officialText: "Acuerdo válido",
  publicationDate: "2026-08-26",
  sourceUrl: "https://oficial.test/acuerdo",
  rawPayload: {},
};

function normalized(record: RawPublication): NormalizedPublication {
  return {
    ...record,
    caseNumberNormalized: "10/2026",
    number: 10,
    year: 2026,
    canonicalCaseKey: "JALISCO:test:M01:CIVIL:10:2026",
    contentHash: "a".repeat(64),
    snapshotHash: "b".repeat(64),
    retrievedAt: "2026-08-26T12:00:00.000Z",
    parserVersion: "test-parser",
    providerVersion: "test-provider",
  };
}

function provider(records: RawPublication[]): JudicialSourceProvider {
  return {
    id: "test-provider",
    name: "Fuente de prueba",
    providerVersion: "test-provider",
    parserVersion: "test-parser",
    discover: async () => ({ sourceUrl: "https://oficial.test", capabilities: [] }),
    healthCheck: async () => ({ provider: "test-provider", status: "ONLINE", checkedAt: new Date().toISOString(), latencyMs: 1, recordsFetched: records.length, message: "OK" }),
    fetchCatalogs: async () => [],
    fetchPublications: async () => records,
    fetchByDate: async () => records,
    validate: () => undefined,
    normalize: async (record) => {
      if (record.caseNumberRaw === "815/20206") throw new Error("Número de expediente inválido: 815/20206");
      return normalized(record);
    },
  };
}

describe("ingestión tolerante a filas oficiales malformadas", () => {
  it("conserva la unidad como exitosa cuando sólo una fila es inválida", async () => {
    const malformed = { ...validRaw, caseNumberRaw: "815/20206", officialText: "Fila oficial malformada" };
    const result = await runIngestion(provider([validRaw, malformed]), { date: "2026-08-26", courtExternalId: "M01" }, true);
    expect(result.recordsFetched).toBe(2);
    expect(result.normalized).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(["Número de expediente inválido: 815/20206"]);
  });

  it("sí degrada el parser cuando todas las filas son inválidas", async () => {
    const malformed = { ...validRaw, caseNumberRaw: "815/20206" };
    const result = await runIngestion(provider([malformed]), { date: "2026-08-26", courtExternalId: "M01" }, true);
    expect(result.normalized).toHaveLength(0);
    expect(result.errors[0]).toMatch(/^PARSER_DEGRADED/);
    expect(result.warnings).toHaveLength(1);
  });
});
