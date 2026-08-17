import { describe, expect, it } from "vitest";
import { jaliscoDirectory, jaliscoDirectoryGroups, jaliscoDirectoryListingCount } from "@/lib/providers/jalisco/directory";

describe("directorio oficial de Jalisco", () => {
  it("conserva todos los grupos y entradas verificadas", () => {
    expect(jaliscoDirectory.groups).toHaveLength(24);
    expect(jaliscoDirectory.entryCount).toBe(270);
    expect(jaliscoDirectory.groups.flatMap((group) => group.entries)).toHaveLength(270);
    expect(jaliscoDirectoryGroups).toHaveLength(25);
    expect(jaliscoDirectoryListingCount).toBe(273);
  });

  it.each([
    "Juzgado Sexto de lo Civil y Extinción de Dominio",
    "Juzgado Primero Auxiliar Especializado en Materia Familiar",
    "Juzgado Primero Familiar en Linea",
    "Juzgado Segundo Familiar en Linea",
  ])("incluye %s", (court) => {
    expect(jaliscoDirectoryGroups.flatMap((group) => group.entries).map((entry) => entry.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))).toContain(court.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  });
});
