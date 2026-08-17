export interface SubscriptionLifecycleInput {
  organizationId: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd?: string | Date | null;
}

export type SubscriptionLifecycleEmail =
  | { kind: "SUBSCRIPTION_EXPIRING"; dedupeKey: string; daysRemaining: number; campaignVariant: 0 }
  | { kind: "SUBSCRIPTION_RENEWAL"; dedupeKey: string; campaignVariant: number };

const TIME_ZONE = "America/Mexico_City";

function localDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayDifference(left: string, right: string): number {
  return Math.round((new Date(`${left}T12:00:00.000Z`).valueOf() - new Date(`${right}T12:00:00.000Z`).valueOf()) / 86_400_000);
}

function weekStart(date: string): string {
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay() || 7;
  return shiftDate(date, 1 - weekday);
}

function campaignVariant(organizationId: string, week: string): number {
  return [...`${organizationId}:${week}`].reduce((total, character) => total + character.charCodeAt(0), 0) % 4;
}

export function classifySubscriptionLifecycleEmail(input: SubscriptionLifecycleInput, now = new Date()): SubscriptionLifecycleEmail | null {
  if (!input.currentPeriodEnd) return null;
  const today = localDate(now);
  const endDate = localDate(input.currentPeriodEnd);
  const endInstant = new Date(input.currentPeriodEnd).valueOf();
  if (!Number.isFinite(endInstant)) return null;
  const recurringActive = (input.status === "active" || input.status === "trialing") && !input.cancelAtPeriodEnd;
  if (recurringActive) return null;
  const remaining = dayDifference(endDate, today);
  if (remaining >= 1 && remaining <= 3) return {
    kind: "SUBSCRIPTION_EXPIRING",
    dedupeKey: `subscription-expiring:${input.organizationId}:${today}`,
    daysRemaining: remaining,
    campaignVariant: 0,
  };
  if (remaining < 0) {
    const week = weekStart(today);
    return {
      kind: "SUBSCRIPTION_RENEWAL",
      dedupeKey: `subscription-renewal:${input.organizationId}:${week}`,
      campaignVariant: campaignVariant(input.organizationId, week),
    };
  }
  return null;
}
