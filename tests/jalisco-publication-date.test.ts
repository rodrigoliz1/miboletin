import { describe, expect, it } from "vitest";
import { formalJaliscoPublicationDate, nextJaliscoBusinessDate, previousJaliscoBusinessDate } from "@/lib/providers/jalisco/provider";

describe("fechas del boletín judicial de Jalisco", () => {
  it("publica el acuerdo en el siguiente día hábil", () => {
    expect(nextJaliscoBusinessDate("2026-08-17")).toBe("2026-08-18");
    expect(nextJaliscoBusinessDate("2026-08-21")).toBe("2026-08-24");
    expect(nextJaliscoBusinessDate("2026-08-22")).toBe("2026-08-24");
    expect(nextJaliscoBusinessDate("2026-09-04")).toBe("2026-09-07");
  });

  it("uses the formal next-business-day date even when the portal exposes the auto early", () => {
    expect(formalJaliscoPublicationDate("2026-09-04", "2026-09-04")).toBe("2026-09-07");
    expect(formalJaliscoPublicationDate("2026-09-04", "2026-09-05")).toBe("2026-09-07");
  });

  it("consulta el día hábil anterior al boletín solicitado", () => {
    expect(previousJaliscoBusinessDate("2026-08-18")).toBe("2026-08-17");
    expect(previousJaliscoBusinessDate("2026-08-24")).toBe("2026-08-21");
    expect(previousJaliscoBusinessDate("2026-08-23")).toBe("2026-08-21");
  });
});
