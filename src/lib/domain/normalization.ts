import { createHash } from "node:crypto";
import type { Jurisdiction } from "./types";

export function normalizeCaseNumber(value: string): { normalized: string; number: number; year: number; suffix?: string } {
  const cleaned = value.trim().replace(/\s+/g, "").toUpperCase();
  const match = cleaned.match(/^0*(\d{1,8})[/-](\d{4})(?:[-/]([A-Z0-9-]+))?$/);
  if (!match) throw new Error(`Número de expediente inválido: ${value}`);
  const number = Number(match[1]);
  const year = Number(match[2]);
  if (number < 1 || year < 1900 || year > 2200) throw new Error(`Número de expediente fuera de rango: ${value}`);
  const suffix = match[3]?.replace(/^-+|-+$/g, "");
  return { normalized: `${number}/${year}${suffix ? `-${suffix}` : ""}`, number, year, ...(suffix ? { suffix } : {}) };
}

export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9Ñ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalCaseKey(input: {
  jurisdiction: Jurisdiction;
  provider: string;
  courtExternalId: string;
  caseType?: string;
  number: number;
  year: number;
  suffix?: string;
}): string {
  return [input.jurisdiction, input.provider, input.courtExternalId, normalizeName(input.caseType ?? "SIN-TIPO"), input.number, input.year, ...(input.suffix ? [input.suffix] : [])].join(":");
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}
