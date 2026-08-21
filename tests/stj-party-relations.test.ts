import { describe, expect, it } from "vitest";
import { resolveStjOriginCandidate, type StjOriginCandidate } from "@/lib/parties/stj-relations";

const candidate = (overrides: Partial<StjOriginCandidate> = {}): StjOriginCandidate => ({
  id: "one", caseNumber: "351/2025", courtExternalId: "C08", courtName: "Juzgado Octavo de lo Civil", matter: "Civil", ...overrides,
});

describe("relaciones conservadoras de Tocas STJ", () => {
  it("enlaza una coincidencia inequívoca y normaliza año corto", () => {
    expect(resolveStjOriginCandidate({ originCaseNumber: "351/25", originCourt: "8", judicialDistrict: "1", matter: "Civil" }, [candidate()])?.id).toBe("one");
  });
  it("no enlaza el mismo número en otro juzgado", () => {
    expect(resolveStjOriginCandidate({ originCaseNumber: "351/25", originCourt: "8", matter: "Civil" }, [candidate({ courtExternalId: "C09", courtName: "Juzgado Noveno" })])).toBeNull();
  });
  it("no elige entre múltiples candidatos plausibles", () => {
    expect(resolveStjOriginCandidate({ originCaseNumber: "351/2025", originCourt: "8", matter: "Civil" }, [candidate(), candidate({ id: "two", courtExternalId: "M08" })])).toBeNull();
  });
  it("no enlaza sin juzgado u origen", () => {
    expect(resolveStjOriginCandidate({ originCaseNumber: "351/2025" }, [candidate()])).toBeNull();
    expect(resolveStjOriginCandidate({ originCaseNumber: "351/2025", originCourt: "99" }, [candidate()])).toBeNull();
  });
  it("no enlaza una materia distinta", () => {
    expect(resolveStjOriginCandidate({ originCaseNumber: "351/2025", originCourt: "8", matter: "Penal" }, [candidate()])).toBeNull();
  });
});
