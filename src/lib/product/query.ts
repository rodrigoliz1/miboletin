const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function optionalUuid(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && UUID_PATTERN.test(normalized) ? normalized : null;
}

export function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function dateInMexicoCity(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function monthStartInMexicoCity(now = new Date()): string {
  return `${dateInMexicoCity(now).slice(0, 7)}-01`;
}

export function normalizeDateRange(
  input: { from?: string | null; to?: string | null },
  now = new Date(),
): { from: string; to: string; corrected: boolean } {
  const fallback = dateInMexicoCity(now);
  let from = isIsoDate(input.from) ? input.from : fallback;
  let to = isIsoDate(input.to) ? input.to : fallback;
  let corrected = from !== input.from || to !== input.to;

  if (from > to) {
    [from, to] = [to, from];
    corrected = true;
  }

  return { from, to, corrected };
}
