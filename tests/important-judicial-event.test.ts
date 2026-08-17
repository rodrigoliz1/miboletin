import { describe, expect, it } from "vitest";
import { importantJudicialEventTitle, isImportantJudicialEvent } from "@/lib/product/important-judicial-event";

describe("important judicial email policy", () => {
  it("keeps session events", () => {
    expect(isImportantJudicialEvent("SESSION_LISTED", "LISTADO PARA SESIÓN")).toBe(true);
    expect(isImportantJudicialEvent("SESSION_RESULT", "SE RESUELVE")).toBe(true);
  });

  it("keeps resolutions that mention sentencia as a word", () => {
    expect(isImportantJudicialEvent("AGREEMENT", "Se dicta Sentencia, se modifica.")).toBe(true);
    expect(isImportantJudicialEvent("AGREEMENT", "Se cita para sentencias.")).toBe(true);
    expect(importantJudicialEventTitle("AGREEMENT", "Se cita para sentencia")).toContain("sentencia");
  });

  it("does not email ordinary resolutions", () => {
    expect(isImportantJudicialEvent("AGREEMENT", "Se recibe escrito y se ordena agregar.")).toBe(false);
    expect(isImportantJudicialEvent("AGREEMENT", "La representación comparece.")).toBe(false);
  });
});
