import { describe, expect, it } from "vitest";
import { dateInMexicoCity, isIsoDate, monthStartInMexicoCity, normalizeDateRange, optionalUuid, resolutionIsVisibleOn, resolutionVisibilityDates, wasDetectedLateOnPublicationDate } from "@/lib/product/query";

describe("product query normalization", () => {
  it("turns empty and malformed UUID filters into null", () => {
    expect(optionalUuid("")).toBeNull();
    expect(optionalUuid("not-a-uuid")).toBeNull();
    expect(optionalUuid("  60ad1d51-c87c-4aee-bb0b-0661dc613a6e  ")).toBe("60ad1d51-c87c-4aee-bb0b-0661dc613a6e");
  });

  it("rejects impossible calendar dates", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2024-02-29")).toBe(true);
  });

  it("repairs invalid and inverted periods", () => {
    const now = new Date("2026-08-15T18:00:00.000Z");
    expect(normalizeDateRange({ from: "", to: "bad" }, now)).toEqual({ from: "2026-08-15", to: "2026-08-15", corrected: true });
    expect(normalizeDateRange({ from: "2026-08-10", to: "2026-08-01" }, now)).toEqual({ from: "2026-08-01", to: "2026-08-10", corrected: true });
    expect(dateInMexicoCity(now)).toBe("2026-08-15");
    expect(monthStartInMexicoCity(now)).toBe("2026-08-01");
  });

  it("keeps same-day agreements visible on their publication day and the following day", () => {
    expect(resolutionVisibilityDates("2026-08-18", "2026-08-18")).toEqual(["2026-08-18", "2026-08-19"]);
    expect(resolutionIsVisibleOn("2026-08-18", "2026-08-18", "2026-08-19")).toBe(true);
    expect(resolutionIsVisibleOn("2026-08-18", "2026-08-17", "2026-08-19")).toBe(false);
    expect(resolutionIsVisibleOn("fecha-invalida", "fecha-invalida", "2026-08-19")).toBe(false);
  });

  it("keeps an agreement detected at or after 15:00 Mexico City visible the following day", () => {
    expect(wasDetectedLateOnPublicationDate("2026-08-18", "2026-08-18T20:59:59.000Z")).toBe(false);
    expect(wasDetectedLateOnPublicationDate("2026-08-18", "2026-08-18T21:00:00.000Z")).toBe(true);
    expect(wasDetectedLateOnPublicationDate("2026-08-18", "2026-08-19T21:00:00.000Z")).toBe(false);
    expect(resolutionVisibilityDates("2026-08-18", "2026-08-17", "2026-08-18T21:30:00.000Z")).toEqual(["2026-08-18", "2026-08-19"]);
    expect(resolutionIsVisibleOn("2026-08-18", "2026-08-17", "2026-08-19", "2026-08-18T21:30:00.000Z")).toBe(true);
  });
});
