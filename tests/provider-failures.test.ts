import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFederalAgreementHistoryHtml, parseFederalSessionHtml } from "@/lib/providers/federal/provider";

describe("contrato y degradación segura federal", () => {
  it("interpreta una lista a sesión anonimizada", () => {
    const html = readFileSync(resolve("tests/fixtures/federal/session-list.anonymized.html"), "utf8");
    const rows = parseFederalSessionHtml(html, { requestedDate: "2026-08-07", filter: "lista", sessionType: "ORDINARY" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ caseType: "Amparo Directo", caseNumber: "461/2024", sessionDate: "2026-08-14", filter: "lista" });
  });

  it("aborta expresamente si una estrategia responde con reCAPTCHA", () => {
    expect(() => parseFederalSessionHtml('<html><div class="g-recaptcha"></div></html>', { requestedDate: "2026-08-07", filter: "lista", sessionType: "ORDINARY" }))
      .toThrow(expect.objectContaining({ code: "SOURCE_ACCESS_RESTRICTED", retryable: false }));
  });

  it("no confunde una página vacía o rota con cero resultados", () => {
    expect(() => parseFederalSessionHtml("<html><body>Error temporal</body></html>", { requestedDate: "2026-08-07", filter: "lista", sessionType: "ORDINARY" }))
      .toThrow(expect.objectContaining({ code: "SCHEMA_DRIFT" }));
  });

  it("interpreta acuerdos y datos de sesión desde la ficha pública del expediente", () => {
    const html = `<html><body>
      <span id="lblNombreOrgano">Primer Tribunal Colegiado en Materia Civil del Tercer Circuito - Amparo Directo</span>
      <table><tr><td>Fecha lista asunto para resolución</td><td>07/08/2026</td></tr><tr><td>Fecha sesión</td><td>14/08/2026</td></tr><tr><td>Resultado sesión</td><td>Aprobado</td></tr><tr><td>Sentido sentencia</td><td>No ampara</td></tr></table>
      <table id="grvAcuerdos"><tr><th>No.</th><th>Fecha del Auto</th><th>Tipo Cuaderno</th><th>Fecha de publicación</th><th>Resumen</th><th>Ver síntesis completa</th></tr>
      <tr><td>1</td><td>31-10-2024</td><td>Juicio de Amparo Directo</td><td>04-11-2024</td><td>Se admite la demanda de amparo.</td><td><a href='javascript:DoVerAcuerdo(119,1,36285450,1,"31/10/2024 12:00:00 a.m.","04/11/2024 12:00:00 a.m.","461/2024")'>Ver síntesis</a></td></tr></table>
    </body></html>`;
    const parsed = parseFederalAgreementHistoryHtml(html, { caseNumber: "461/2024", caseType: "Amparo Directo", courtExternalId: "119", sourceUrl: "https://oficial.test/ficha" });
    expect(parsed.matched).toBe(true);
    expect(parsed.records[0]).toMatchObject({ agreementDate: "2024-10-31", publicationDate: "2024-11-04", neun: "36285450" });
    expect(parsed.records[0].detailUrl).toContain("VerAcuerdo.aspx");
    expect(parsed.caseSession).toEqual({ listDate: "2026-08-07", sessionDate: "2026-08-14", result: "Aprobado", judgmentSense: "No ampara" });
  });
});
