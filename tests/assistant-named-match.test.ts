import { describe, expect, it } from "vitest";
import { bestNamed, inferAssistantJurisdiction, matchNamed } from "@/lib/assistant/named-match";

describe("coincidencia de nombres judiciales", () => {
  it("elige el juzgado vigente sobre un órgano histórico parecido", () => {
    const current = { id: "5749", name: "Juzgado Primero de Distrito en Materia Civil en el Estado de Jalisco, con residencia en Zapopan" };
    const historical = { id: "694", name: "Juzgado Primero de Distrito en Materias Administrativa, Civil y de Trabajo en el Estado de Jalisco, con residencia en Zapopan. (29/03/2004 - 01/09/2024)" };
    expect(bestNamed([historical, current], "Juzgado Primero de Distrito en Materia Civil en el Estado de Jalisco")).toBe(current);
  });

  it("acepta el sufijo oficial del partido judicial en un órgano local", () => {
    const court = { id: "1", name: "Juzgado Primero de lo Civil" };
    expect(bestNamed([court], "Juzgado Primero de lo Civil del Primer Partido Judicial")).toBe(court);
  });

  it("no decide entre órganos realmente ambiguos", () => {
    const courts = [
      { id: "1", name: "Juzgado Primero de Distrito en Materia Civil en el Estado de Jalisco" },
      { id: "2", name: "Juzgado Primero de Distrito en Materia Administrativa en el Estado de Jalisco" },
    ];
    expect(matchNamed(courts, "Juzgado Primero de Distrito en el Estado de Jalisco")).toBeNull();
  });

  it("distingue ordinales por palabra completa", () => {
    const first = { id: "1", name: "Juzgado Primero de lo Civil" };
    const second = { id: "2", name: "Juzgado Segundo de lo Civil" };
    expect(bestNamed([second, first], "Juzgado Primero de lo Civil")).toBe(first);
  });

  it("corrige como federal un Juzgado de Distrito aunque el modelo declare Jalisco", () => {
    expect(inferAssistantJurisdiction("Juzgado Primero de Distrito en Materia Civil en el Estado de Jalisco", "JALISCO")).toBe("FEDERAL");
  });

  it("conserva como local un juzgado del Poder Judicial de Jalisco", () => {
    expect(inferAssistantJurisdiction("Juzgado Décimo Segundo de lo Civil del Primer Partido Judicial", "JALISCO")).toBe("JALISCO");
  });
});
