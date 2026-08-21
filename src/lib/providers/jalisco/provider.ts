import { z } from "zod";
import { canonicalCaseKey, normalizeCaseNumber, sha256, stableJson } from "@/lib/domain/normalization";
import {
  ProviderError,
  type CourtCatalogItem,
  type JudicialSourceProvider,
  type NormalizedPublication,
  type ProviderHealth,
  type PublicationQuery,
  type RawPublication,
} from "@/lib/domain/types";
import { respectfulFetch } from "@/lib/providers/http";

const envelopeSchema = z.object({ success: z.union([z.number(), z.string()]), data: z.unknown() });
const judgeSchema = z.object({
  value: z.string().min(1),
  name: z.string().min(3),
  secretary: z.string().nullish(),
  position: z.string().nullish(),
  address: z.string().nullish(),
});
const publicationSchema = z.object({
  EXP: z.string().min(3),
  CVE_JUZ: z.string().nullish(),
  CLAVE_JUZGADO: z.string().nullish(),
  FCH_PRO: z.string().nullish(),
  FECHA_PROMOCION: z.string().nullish(),
  FCH_ACU: z.string().nullish(),
  FCH_ACUERDO: z.string().nullish(),
  FCH_BOLETIN: z.string().nullish(),
  BOLETIN: z.union([z.string(), z.number()]).nullish(),
  BOLETIN2: z.string().nullish(),
  BOLETIN3: z.string().nullish(),
  OBSERVACIONES: z.string().nullish(),
  NOTA: z.string().nullish(),
  TIPO: z.string().nullish(),
  DESCRIP: z.string().nullish(),
  act_names: z.string().nullish(),
  dem_names: z.string().nullish(),
  aut_names: z.string().nullish(),
  pro_names: z.string().nullish(),
}).passthrough();

export type JaliscoCourtFamily = "METROPOLITAN" | "FOREIGN" | "LABOR" | "TRADITIONAL_CRIMINAL" | "ORAL_CRIMINAL";

export interface JaliscoCourtCatalogItem extends CourtCatalogItem {
  family: JaliscoCourtFamily;
  group: string;
  address?: string;
  searchable: true;
}

export interface JaliscoCaseSearchResult {
  court: JaliscoCourtCatalogItem;
  caseNumber: string;
  retrievedAt: string;
  sourceUrl: string;
  records: RawPublication[];
}

const catalogSources: Array<{
  endpoint: string;
  family: JaliscoCourtFamily;
  group: string;
}> = [
  { endpoint: "zm_judges", family: "METROPOLITAN", group: "Primera instancia, Área Metropolitana" },
  { endpoint: "foraneos_judges", family: "FOREIGN", group: "Juzgados foráneos" },
  { endpoint: "labor_judges", family: "LABOR", group: "Juzgados laborales" },
  { endpoint: "puente_grande_judges", family: "TRADITIONAL_CRIMINAL", group: "Juzgados penales tradicionales" },
  { endpoint: "penal_oral_judges", family: "ORAL_CRIMINAL", group: "Juzgados de control y oralidad penal" },
];

let catalogCache: { expiresAt: number; value: JaliscoCourtCatalogItem[] } | null = null;
let catalogRequest: Promise<JaliscoCourtCatalogItem[]> | null = null;

function shiftBusinessDate(date: string, direction: -1 | 1): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  do parsed.setUTCDate(parsed.getUTCDate() + direction);
  while (parsed.getUTCDay() === 0 || parsed.getUTCDay() === 6);
  return parsed.toISOString().slice(0, 10);
}

export function previousJaliscoBusinessDate(date: string): string {
  return shiftBusinessDate(date, -1);
}

export function nextJaliscoBusinessDate(date: string): string {
  return shiftBusinessDate(date, 1);
}

function dateOnly(value: string | null | undefined): string | undefined {
  const match = value?.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0];
}

export function normalizeJaliscoSourceCaseNumber(value: string) {
  const compact = value.trim().replace(/\s+/g, "").toUpperCase();
  // The CJJ sometimes returns a two-digit year, but most rows already contain
  // four digits. The suffix must start with a separator so `192/2026` cannot
  // be misread as year `20` plus suffix `26`.
  const shortYear = compact.match(/^(\d{1,8})[/-](\d{2})((?:[-/][A-Z0-9-]+)?)$/);
  if (!shortYear) return normalizeCaseNumber(compact);
  const currentShortYear = Number(new Date().getUTCFullYear().toString().slice(-2));
  const year = Number(shortYear[2]) <= currentShortYear ? `20${shortYear[2]}` : `19${shortYear[2]}`;
  return normalizeCaseNumber(`${shortYear[1]}/${year}${shortYear[3]}`);
}

function courtMatter(name: string, family: JaliscoCourtFamily): string {
  const upper = name.toUpperCase();
  if (family === "LABOR") return "Laboral";
  if (family === "TRADITIONAL_CRIMINAL" || family === "ORAL_CRIMINAL") return "Penal";
  if (upper.includes("FAMIL")) return "Familiar";
  if (upper.includes("MERCANT")) return "Mercantil";
  if (upper.includes("ADOLESC")) return "Justicia para adolescentes";
  return "Civil";
}

function usableText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned === "0" || cleaned === "OTRO") return undefined;
  return cleaned;
}

function officialExtract(record: z.infer<typeof publicationSchema>): string {
  const values = [record.BOLETIN, record.BOLETIN3, record.BOLETIN2, record.OBSERVACIONES, record.NOTA]
    .map(usableText)
    .filter((value): value is string => Boolean(value));
  return [...new Set(values)].join(" ") || "El portal oficial no publicó extracto para este movimiento.";
}

function recordToPublication(
  record: z.infer<typeof publicationSchema>,
  court: JaliscoCourtCatalogItem,
  index: number,
): RawPublication {
  const agreementDate = dateOnly(record.FCH_ACU ?? record.FCH_ACUERDO);
  const promotionDate = dateOnly(record.FCH_PRO ?? record.FECHA_PROMOCION);
  const publicationDate = dateOnly(record.FCH_BOLETIN)
    ?? (agreementDate ? nextJaliscoBusinessDate(agreementDate) : undefined)
    ?? promotionDate
    ?? new Date().toISOString().slice(0, 10);
  return {
    externalId: `${court.family}:${court.externalId}:${record.EXP}:${agreementDate ?? publicationDate}:${index}`,
    courtExternalId: court.externalId,
    courtName: court.name,
    caseNumberRaw: record.EXP,
    caseType: usableText(record.DESCRIP) ?? usableText(record.TIPO),
    officialText: officialExtract(record),
    parties: {
      plaintiff: usableText(record.act_names) ?? usableText(record.aut_names),
      defendant: usableText(record.dem_names) ?? usableText(record.pro_names),
    },
    publicationDate,
    agreementDate,
    promotionDate,
    sourceUrl: "https://cjj.gob.mx/bulletin",
    rawPayload: record,
  };
}

export class JaliscoProvider implements JudicialSourceProvider {
  readonly id = "jalisco-cjj";
  readonly name = "Consejo de la Judicatura del Estado de Jalisco";
  readonly providerVersion = "2.0.1";
  readonly parserVersion = "jalisco-multi-family-json-3";
  private readonly base = process.env.JALISCO_API_BASE ?? "https://api.cjj.gob.mx";
  private readonly officialPage = "https://cjj.gob.mx/bulletin";
  constructor(private readonly catalogOverride?: JaliscoCourtCatalogItem[]) {}

  async discover() {
    return {
      sourceUrl: this.officialPage,
      capabilities: [
        "194-court-live-catalog",
        "publications-by-date",
        "publications-by-case",
        "structured-json",
        "metropolitan",
        "foreign",
        "labor",
        "traditional-criminal",
        "oral-criminal",
      ],
    };
  }

  private async fetchCatalogSource(source: (typeof catalogSources)[number]): Promise<JaliscoCourtCatalogItem[]> {
    const url = `${this.base}/bulletin/${source.endpoint}?url=bulletin/${source.endpoint}`;
    const response = await respectfulFetch(url);
    if (!response.ok) throw new ProviderError("SOURCE_UNAVAILABLE", `Catálogo ${source.endpoint} HTTP ${response.status}`, true);
    const body = envelopeSchema.parse(await response.json());
    const parsed = z.array(judgeSchema).safeParse(body.data);
    if (!parsed.success) throw new ProviderError("SCHEMA_DRIFT", `El catálogo ${source.endpoint} cambió de estructura`, false);
    return parsed.data.map((court) => {
      const name = court.name.replace(/\s+/g, " ").trim();
      return {
        externalId: court.value,
        name,
        jurisdiction: "JALISCO",
        matter: courtMatter(name, source.family),
        family: court.value === "FNI" || court.value === "XF1" ? "FOREIGN" : source.family,
        group: source.group,
        address: usableText(court.address),
        searchable: true,
      };
    });
  }

  async fetchCatalogs(): Promise<JaliscoCourtCatalogItem[]> {
    if (this.catalogOverride?.length) return this.catalogOverride;
    if (catalogCache && catalogCache.expiresAt > Date.now()) return catalogCache.value;
    if (catalogRequest) return catalogRequest;
    const stale = catalogCache?.value;
    catalogRequest = Promise.allSettled(catalogSources.map((source) => this.fetchCatalogSource(source)))
      .then((groups) => {
        const successful = groups.flatMap((group) => group.status === "fulfilled" ? group.value : []);
        if (successful.length < 190 && stale?.length && stale.length > successful.length) {
          catalogCache = { value: stale, expiresAt: Date.now() + 10 * 60 * 1000 };
          return stale;
        }
        if (!successful.length) {
          const failure = groups.find((group) => group.status === "rejected");
          throw failure?.status === "rejected" ? failure.reason : new ProviderError("SOURCE_UNAVAILABLE", "Los catálogos de Jalisco no respondieron", true);
        }
        const value = successful.sort((a, b) => a.group.localeCompare(b.group, "es") || a.name.localeCompare(b.name, "es"));
        catalogCache = { value, expiresAt: Date.now() + (value.length >= 190 ? 6 * 60 * 60 * 1000 : 5 * 60 * 1000) };
        return value;
      })
      .finally(() => { catalogRequest = null; });
    return catalogRequest;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      const courts = await this.fetchCatalogs();
      return {
        provider: this.id,
        status: courts.length >= 190 ? "ONLINE" : "DEGRADED",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        recordsFetched: courts.length,
        message: courts.length >= 190 ? "Cinco catálogos estructurados disponibles" : "Faltan órganos respecto al contrato esperado",
        details: {
          expectedMinimumCourts: 190,
          families: Object.fromEntries(catalogSources.map((source) => [source.family, courts.filter((court) => court.family === source.family).length])),
        },
      };
    } catch (error) {
      return {
        provider: this.id,
        status: "FAILED",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        recordsFetched: 0,
        message: error instanceof Error ? error.message : "Falla desconocida",
      };
    }
  }

  private async court(externalId: string): Promise<JaliscoCourtCatalogItem> {
    const court = (await this.fetchCatalogs()).find((item) => item.externalId === externalId);
    if (!court) throw new ProviderError("INVALID_RESPONSE", `Órgano no reconocido por el boletín: ${externalId}`, false);
    return court;
  }

  private endpoint(court: JaliscoCourtCatalogItem, mode: "date" | "expedient"): string {
    const stem = court.family === "METROPOLITAN"
      ? "zmg"
      : court.family === "TRADITIONAL_CRIMINAL"
        ? "penal"
        : court.family === "ORAL_CRIMINAL"
          ? "penal_oral"
          : "forean";
    return `${stem}_${mode}`;
  }

  private async records(endpoint: string, parameters: Record<string, string>): Promise<z.infer<typeof publicationSchema>[]> {
    const params = new URLSearchParams({ ...parameters, url: `bulletin/${endpoint}` });
    const response = await respectfulFetch(`${this.base}/bulletin/${endpoint}?${params}`);
    if (!response.ok) throw new ProviderError("SOURCE_UNAVAILABLE", `Boletín Jalisco HTTP ${response.status}`, true);
    const body = envelopeSchema.parse(await response.json());
    const parsed = z.array(publicationSchema).safeParse(body.data);
    if (!parsed.success) throw new ProviderError("SCHEMA_DRIFT", `La consulta ${endpoint} cambió de estructura`, false);
    return parsed.data;
  }

  async fetchPublications(query: PublicationQuery): Promise<RawPublication[]> {
    if (!query.courtExternalId) throw new ProviderError("INVALID_RESPONSE", "Jalisco requiere identificador de juzgado", false);
    const court = await this.court(query.courtExternalId);
    const endpoint = this.endpoint(court, "date");
    const records = await this.records(endpoint, { judged: court.externalId, date: previousJaliscoBusinessDate(query.date) });
    const requested = query.caseNumber ? normalizeCaseNumber(query.caseNumber).normalized : null;
    return records
      .filter((record) => !requested || normalizeJaliscoSourceCaseNumber(record.EXP).normalized === requested)
      .map((record, index) => recordToPublication(record, court, index));
  }

  async fetchByDate(query: PublicationQuery): Promise<RawPublication[]> {
    return this.fetchPublications(query);
  }

  async searchCase(caseNumber: string, courtExternalId: string): Promise<JaliscoCaseSearchResult> {
    const parsedCase = normalizeCaseNumber(caseNumber);
    const court = await this.court(courtExternalId);
    const endpoint = this.endpoint(court, "expedient");
    const records = await this.records(endpoint, { judged: court.externalId, expedient: parsedCase.normalized });
    const publications = records
      .filter((record) => {
        try { return normalizeJaliscoSourceCaseNumber(record.EXP).normalized === parsedCase.normalized; } catch { return false; }
      })
      .map((record, index) => recordToPublication(record, court, index))
      .sort((a, b) => (b.agreementDate ?? b.publicationDate).localeCompare(a.agreementDate ?? a.publicationDate));
    return {
      court,
      caseNumber: parsedCase.normalized,
      retrievedAt: new Date().toISOString(),
      sourceUrl: this.officialPage,
      records: publications,
    };
  }

  async fetchCase(caseNumber: string, courtExternalId: string): Promise<RawPublication[]> {
    return (await this.searchCase(caseNumber, courtExternalId)).records;
  }

  validate(record: RawPublication): void {
    normalizeJaliscoSourceCaseNumber(record.caseNumberRaw);
    if (!record.courtExternalId || !record.officialText || !/^\d{4}-\d{2}-\d{2}$/.test(record.publicationDate)) {
      throw new ProviderError("SCHEMA_DRIFT", "Publicación Jalisco incompleta", false);
    }
  }

  async normalize(record: RawPublication): Promise<NormalizedPublication> {
    this.validate(record);
    const parsed = normalizeJaliscoSourceCaseNumber(record.caseNumberRaw);
    const retrievedAt = new Date().toISOString();
    const canonicalKey = canonicalCaseKey({
      jurisdiction: "JALISCO",
      provider: this.id,
      courtExternalId: record.courtExternalId,
      caseType: record.caseType,
      number: parsed.number,
      year: parsed.year,
      suffix: parsed.suffix,
    });
    return {
      ...record,
      caseNumberNormalized: parsed.normalized,
      number: parsed.number,
      year: parsed.year,
      canonicalCaseKey: canonicalKey,
      contentHash: sha256([canonicalKey, record.agreementDate ?? record.publicationDate, record.promotionDate ?? "", record.officialText].join("|")),
      snapshotHash: sha256(stableJson(record.rawPayload)),
      retrievedAt,
      parserVersion: this.parserVersion,
      providerVersion: this.providerVersion,
    };
  }
}
