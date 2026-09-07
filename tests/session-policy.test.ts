import { describe, expect, it } from "vitest";
import { REMEMBERED_SESSION_SECONDS, TRANSIENT_SESSION_SECONDS, sessionPolicy } from "@/lib/security/session-policy";

describe("session persistence policy", () => {
  it("uses a browser-session cookie by default", () => {
    expect(sessionPolicy(false)).toEqual({ tokenLifetimeSeconds: TRANSIENT_SESSION_SECONDS });
  });

  it("persists only when the user opts in", () => {
    expect(sessionPolicy(true)).toEqual({
      tokenLifetimeSeconds: REMEMBERED_SESSION_SECONDS,
      cookieMaxAge: REMEMBERED_SESSION_SECONDS,
    });
  });
});
