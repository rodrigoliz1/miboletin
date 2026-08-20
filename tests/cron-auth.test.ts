import { afterEach, describe, expect, it } from "vitest";
import { isCronRequestAuthorized } from "@/lib/security/cron";

const originalSecret = process.env.CRON_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

describe("cron authorization", () => {
  it("accepts only the configured bearer token", () => {
    process.env.CRON_SECRET = "cron-secret-long-enough-2026";
    expect(isCronRequestAuthorized(new Request("https://miboletin.lat/api/cron/refresh", { headers: { authorization: "Bearer cron-secret-long-enough-2026" } }))).toBe(true);
    expect(isCronRequestAuthorized(new Request("https://miboletin.lat/api/cron/refresh", { headers: { authorization: "Bearer incorrect" } }))).toBe(false);
  });

  it("rejects missing and weak server secrets", () => {
    delete process.env.CRON_SECRET;
    expect(isCronRequestAuthorized(new Request("https://miboletin.lat/api/cron/refresh"))).toBe(false);
    process.env.CRON_SECRET = "short";
    expect(isCronRequestAuthorized(new Request("https://miboletin.lat/api/cron/refresh", { headers: { authorization: "Bearer short" } }))).toBe(false);
  });
});
