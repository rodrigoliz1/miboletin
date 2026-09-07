import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyStjSentenceSignal, parseStjAgreementsHtml, stjChambers } from "@/lib/providers/stj/provider";

describe("STJ Jalisco agreements", () => {
  it("uses the official eleven-chamber catalog", () => {
    expect(stjChambers).toHaveLength(11);
    expect(stjChambers[4]).toMatchObject({ externalId: "5", matter: "Civil" });
  });

  it("matches strictly by chamber and Toca and maps origin metadata", () => {
    const html = readFileSync(resolve("tests/fixtures/stj/agreements.anonymized.html"), "utf8");
    const records = parseStjAgreementsHtml(html, "5", "125/2026");
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ courtExternalId: "5", caseNumberRaw: "125/2026", agreementDate: "2026-06-04", publicationDate: "2026-06-05" });
    expect(records[0].metadata).toMatchObject({ originCaseNumber: "101/2022", originCourt: "7", sentenceSignal: "DECISION" });
    expect(records.some((record) => record.caseNumberRaw === "999/2026")).toBe(false);
  });

  it("distinguishes a final decision from a citation for judgment", () => {
    expect(classifyStjSentenceSignal("Se dicta sentencia definitiva")).toBe("DECISION");
    expect(classifyStjSentenceSignal("Se cita para sentencia")).toBe("PENDING");
    expect(classifyStjSentenceSignal("Se aclara.")).toBe("PENDING");
    expect(classifyStjSentenceSignal("Se integra la Sala")).toBe("NONE");
  });

  it("fails closed on an interactive access challenge", () => {
    expect(() => parseStjAgreementsHtml('<div class="g-recaptcha"></div>', "5", "125/2026"))
      .toThrow(expect.objectContaining({ code: "SOURCE_ACCESS_RESTRICTED" }));
  });
});
