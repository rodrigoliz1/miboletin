import { describe, expect, it } from "vitest";
import { selectCurrentSessionMovements, verifiedNotebookLabel } from "@/lib/product/judicial-display";

describe("presentación judicial prudente", () => {
  it("oculta Principal cuando el extracto oficial trata un incidente de suspensión", () => {
    expect(verifiedNotebookLabel("Principal", "Se abre la audiencia para resolver el incidente de suspensión.")).toBeUndefined();
  });

  it("sólo muestra el cuaderno cuando texto y etiqueta oficial son consistentes", () => {
    expect(verifiedNotebookLabel("Incidental", "Se resuelve el incidente de suspensión.")).toBe("Cuaderno incidental");
    expect(verifiedNotebookLabel("Principal", "Se agrega oficio.")).toBeUndefined();
  });

  it("conserva únicamente el ciclo de sesión vigente", () => {
    const movements = [
      { id: "new-list", publicationKind: "SESSION_LISTED", publicationDate: "2026-07-31", sessionDate: "2026-08-20" },
      { id: "old-result", publicationKind: "SESSION_RESULT", publicationDate: "2026-05-08", sessionDate: "2026-05-08" },
      { id: "old-list", publicationKind: "SESSION_LISTED", publicationDate: "2026-04-29", sessionDate: "2026-05-08" },
    ];
    expect(selectCurrentSessionMovements(movements).map((movement) => movement.id)).toEqual(["new-list"]);
  });
});
