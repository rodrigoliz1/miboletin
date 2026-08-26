import { describe, expect, it } from "vitest";
import { parseJaliscoPublicationData } from "@/lib/providers/jalisco/provider";

describe("contrato de publicaciones del boletín de Jalisco", () => {
  it("considera vacía una tabla que el catálogo oficial todavía no provisiona", () => {
    expect(parseJaliscoPublicationData({
      code: "ER_NO_SUCH_TABLE",
      message: "Table 'app_cjj.LIBD61' doesn't exist",
      sqlState: "42S02",
    }, "penal_oral_date")).toEqual([]);
  });

  it("no oculta otros errores estructurados del API oficial", () => {
    expect(() => parseJaliscoPublicationData({
      code: "ER_LOCK_WAIT_TIMEOUT",
      message: "Lock wait timeout exceeded",
    }, "zmg_date")).toThrow(expect.objectContaining({ code: "SOURCE_UNAVAILABLE", retryable: true }));
  });

  it("detecta una respuesta incompatible sin confundirla con cero resultados", () => {
    expect(() => parseJaliscoPublicationData({ unexpected: true }, "zmg_date"))
      .toThrow(expect.objectContaining({ code: "SCHEMA_DRIFT", retryable: false }));
  });
});
