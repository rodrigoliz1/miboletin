import { describe, expect, it } from "vitest";
import { classifySubscriptionLifecycleEmail } from "@/lib/billing/retention-policy";

describe("subscription retention policy", () => {
  const now = new Date("2026-08-17T18:00:00.000Z");

  it("never reminds a customer with an active recurring Stripe subscription", () => {
    expect(classifySubscriptionLifecycleEmail({ organizationId: "org", status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: "2026-08-20T18:00:00.000Z" }, now)).toBeNull();
  });

  it("sends one daily warning during the final three local calendar days when recurrence is ending", () => {
    expect(classifySubscriptionLifecycleEmail({ organizationId: "org", status: "active", cancelAtPeriodEnd: true, currentPeriodEnd: "2026-08-20T18:00:00.000Z" }, now)).toEqual({
      kind: "SUBSCRIPTION_EXPIRING", dedupeKey: "subscription-expiring:org:2026-08-17", daysRemaining: 3, campaignVariant: 0,
    });
  });

  it("deduplicates expired-account campaigns by week", () => {
    const first = classifySubscriptionLifecycleEmail({ organizationId: "org", status: "canceled", cancelAtPeriodEnd: true, currentPeriodEnd: "2026-08-01T18:00:00.000Z" }, now);
    const second = classifySubscriptionLifecycleEmail({ organizationId: "org", status: "canceled", cancelAtPeriodEnd: true, currentPeriodEnd: "2026-08-01T18:00:00.000Z" }, new Date("2026-08-19T18:00:00.000Z"));
    expect(first?.kind).toBe("SUBSCRIPTION_RENEWAL");
    expect(second?.dedupeKey).toBe(first?.dedupeKey);
  });
});
