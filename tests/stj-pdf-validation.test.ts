import { describe, expect, it } from "vitest";
import { classifyStjDocument, parseStjJudgmentCandidates, validatePdfBytes } from "@/lib/providers/stj/sentences";

describe("STJ PDF validation", () => {
  it("accepts a PDF signature", () => {
    expect(validatePdfBytes({ bytes: Buffer.from("%PDF-1.7\nbody"), contentType: "application/pdf" }).byteSize).toBeGreaterThan(5);
  });

  it("rejects an HTML error returned as a document", () => {
    expect(() => validatePdfBytes({ bytes: Buffer.from("<html>Error</html>"), contentType: "text/html" })).toThrow("INVALID_DOCUMENT_CONTENT_TYPE");
  });

  it("rejects octet-stream data without a PDF signature", () => {
    expect(() => validatePdfBytes({ bytes: Buffer.from("not-a-pdf"), contentType: "application/octet-stream" })).toThrow("INVALID_DOCUMENT_SIGNATURE");
  });

  it("keeps every exact official document for the same Sala and Toca", () => {
    const candidates = parseStjJudgmentCandidates([
      { id: 101, sala_id: 3, numero: 93, periodo: 2026, tipo_documento: "Sentencia" },
      { id: 102, sala_id: 3, numero: 93, periodo: 2026, descripcion: "Aclaración de sentencia", derivado: "A" },
      { id: 103, sala_id: 4, numero: 93, periodo: 2026 },
      { id: 104, sala_id: 3, numero: 94, periodo: 2026 },
    ], "3", "93-2026");
    expect(candidates.map((candidate) => candidate.id)).toEqual([101, 102]);
    expect(classifyStjDocument(candidates[0], 1, 2)).toEqual({ kind: "JUDGMENT", label: "Sentencia" });
    expect(classifyStjDocument(candidates[1], 2, 2)).toEqual({ kind: "CLARIFICATION", label: "Aclaración de sentencia" });
  });

  it("does not guess the meaning of an unlabeled second file", () => {
    expect(classifyStjDocument({ id: 2, sala_id: 3, numero: 93, periodo: 2026 }, 2, 2))
      .toEqual({ kind: "RELATED", label: "Documento oficial 2 de 2" });
  });
});
