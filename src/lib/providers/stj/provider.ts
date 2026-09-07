import * as cheerio from "cheerio";
import { canonicalCaseKey, normalizeCaseNumber, sha256, stableJson } from "@/lib/domain/normalization";
import type { CourtCatalogItem, JudicialSourceProvider, NormalizedPublication, ProviderHealth, PublicationQuery, RawPublication } from "@/lib/domain/types";
import { ProviderError } from "@/lib/domain/types";
import { respectfulFetch } from "@/lib/providers/http";

export const STJ_AGREEMENTS_URL = "https://consultas.stjjalisco.gob.mx/consultas/acuerdos";
export const STJ_JUDGMENTS_URL = "https://publicacionsentencias.stjjalisco.gob.mx/sentencias";
const STJ_JUDGMENTS_API = "https://publica-sentencias-backend.stjjalisco.gob.mx";

export const stjChambers = [
  { externalId: "1", name: "Primera Sala Especializada en Materia Penal", matter: "Penal" },
  { externalId: "2", name: "Segunda Sala Especializada en Materia Penal", matter: "Penal" },
  { externalId: "3", name: "Tercera Sala Especializada en Materia Civil", matter: "Civil" },
  { externalId: "4", name: "Cuarta Sala Especializada en Materia Civil", matter: "Civil" },
  { externalId: "5", name: "Quinta Sala Especializada en Materia Civil", matter: "Civil" },
  { externalId: "6", name: "Sexta Sala Especializada en Materia Penal", matter: "Penal" },
  { externalId: "7", name: "Séptima Sala Especializada en Materia Civil", matter: "Civil" },
  { externalId: "8", name: "Octava Sala Especializada en Materia Civil", matter: "Civil" },
  { externalId: "9", name: "Novena Sala Especializada en Materia Civil", matter: "Civil" },
  { externalId: "10", name: "Décima Sala Especializada en Justicia Integral para Adolescentes y Penal", matter: "Justicia para adolescentes y penal" },
  { externalId: "11", name: "Décima Primera Sala Especializada en Materia Penal", matter: "Penal" },
] as const;

export type StjSentenceSignal = "NONE" | "PENDING" | "DECISION";

export interface StjAgreementMetadata {
  toca: string;
  bis?: string;
  proceeding?: string;
  appealType?: string;
  originCourt?: string;
  matter?: string;
  originCaseNumber?: string;
  judicialDistrict?: string;
  sentenceSignal: StjSentenceSignal;
}

export interface StjCaseSearchResult {
  court: CourtCatalogItem;
  caseNumber: string;
  retrievedAt: string;
  sourceUrl: string;
  records: RawPublication[];
}

let crossChamberCache = new Map<string, { expiresAt: number; value: StjCaseSearchResult[] }>();
const caseSearchCache = new Map<string, { expiresAt: number; promise: Promise<StjCaseSearchResult> }>();

function clean(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function officialDate(value: string): string {
  const match = clean(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new ProviderError("SCHEMA_DRIFT", `Fecha de acuerdo STJ no reconocida: ${value}`, false);
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export function classifyStjSentenceSignal(text: string): StjSentenceSignal {
  const normalized = clean(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\b(se dicta sentencia|dicta sentencia|sentencia definitiva|resolucion definitiva|se emite sentencia|fallo definitivo|engrose|ejecutoria|se resuelve el recurso)\b/.test(normalized)) return "DECISION";
  if (/\b(se aclara|aclaracion de sentencia)\b/.test(normalized)) return "PENDING";
  if (/\b(sentencia|fallo|resolucion definitiva|engrose|ejecutoria)\b/.test(normalized)) return "PENDING";
  return "NONE";
}

export function parseStjAgreementsHtml(html: string, chamberExternalId: string, requestedToca: string): Array<RawPublication & { metadata: StjAgreementMetadata }> {
  if (/g-recaptcha|captcha/i.test(html)) throw new ProviderError("SOURCE_ACCESS_RESTRICTED", "La consulta de acuerdos STJ exige verificación interactiva", false);
  const chamber = stjChambers.find((item) => item.externalId === chamberExternalId);
  if (!chamber) throw new ProviderError("INVALID_RESPONSE", "Sala STJ no reconocida", false);
  const requested = normalizeCaseNumber(requestedToca).normalized;
  const $ = cheerio.load(html);
  const headers = $(".resultados table thead th").map((_, element) => clean($(element).text())).get();
  if (!headers.length && !/Resultados/i.test($("body").text())) throw new ProviderError("SCHEMA_DRIFT", "La fuente de acuerdos STJ cambió de estructura", false);
  const records: Array<RawPublication & { metadata: StjAgreementMetadata }> = [];
  $(".resultados table tbody tr").each((index, element) => {
    const cells = $(element).find("td").map((_, cell) => clean($(cell).text())).get();
    if (cells.length < 10) return;
    let toca: string;
    try { toca = normalizeCaseNumber(cells[1]).normalized; } catch { return; }
    if (toca !== requested) return;
    const agreementDate = officialDate(cells[0]);
    const officialText = cells[9] || "El portal oficial no publicó extracto para este acuerdo.";
    const metadata: StjAgreementMetadata = {
      toca,
      bis: cells[2] || undefined,
      proceeding: cells[3] || undefined,
      appealType: cells[4] || undefined,
      originCourt: cells[5] || undefined,
      matter: cells[6] || undefined,
      originCaseNumber: cells[7] || undefined,
      judicialDistrict: cells[8] || undefined,
      sentenceSignal: classifyStjSentenceSignal(officialText),
    };
    records.push({
      externalId: `stj:${chamberExternalId}:${toca}:${agreementDate}:${sha256(officialText).slice(0, 14)}`,
      courtExternalId: chamberExternalId,
      courtName: chamber.name,
      caseNumberRaw: toca,
      caseType: "Toca",
      officialText,
      publicationDate: agreementDate,
      agreementDate,
      sourceUrl: `${STJ_AGREEMENTS_URL}/page:1/sala:${chamberExternalId}/search_value:${toca.replace("/", ".")}/m:0`,
      rawPayload: { metadata, row: Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ""])) },
      metadata,
    });
  });
  return records;
}

function maxPage(html: string): number {
  const $ = cheerio.load(html);
  let maximum = 1;
  $("a[href*='/consultas/acuerdos/page:']").each((_, element) => {
    const match = ($(element).attr("href") ?? "").match(/\/page:(\d+)/);
    if (match) maximum = Math.max(maximum, Number(match[1]));
  });
  return Math.min(maximum, 30);
}

export class StjJaliscoProvider implements JudicialSourceProvider {
  readonly id = "jalisco-stj-chambers";
  readonly name = "Supremo Tribunal de Justicia del Estado de Jalisco";
  readonly providerVersion = "1.0.0";
  readonly parserVersion = "stj-agreements-html-1";

  async discover() {
    return { sourceUrl: STJ_AGREEMENTS_URL, capabilities: ["eleven-chambers", "agreements-by-toca", "sentence-signal", "public-judgment-link", "strict-chamber-toca-match"] };
  }

  async fetchCatalogs(): Promise<CourtCatalogItem[]> {
    return stjChambers.map((chamber) => ({ ...chamber, jurisdiction: "JALISCO" as const }));
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      const response = await respectfulFetch(STJ_AGREEMENTS_URL, { headers: { Accept: "text/html", Referer: "https://consultas.stjjalisco.gob.mx/" } }, 1);
      const html = await response.text();
      const available = response.ok && /Consulta de Acuerdos/i.test(html) && /AcuerdosSalaId/.test(html);
      const judgmentsAccess = await this.probeJudgmentSearchAccess();
      return { provider: this.id, status: available ? "ONLINE" : "DEGRADED", checkedAt: new Date().toISOString(), latencyMs: Date.now() - started, recordsFetched: available ? 11 : 0, message: available ? (judgmentsAccess === "AVAILABLE" ? "Acuerdos y sentencias disponibles" : "Consulta de acuerdos disponible; los documentos de sentencia se enlazan cuando el portal permite validarlos") : "El portal respondió sin el contrato esperado", details: { agreementsStatus: available ? "OPERATIONAL" : "SCHEMA_CHANGED", sentencesStatus: judgmentsAccess === "AVAILABLE" ? "OPERATIONAL" : "INTERACTIVE_VALIDATION", judgmentsUrl: STJ_JUDGMENTS_URL } };
    } catch (error) {
      return { provider: this.id, status: "FAILED", checkedAt: new Date().toISOString(), latencyMs: Date.now() - started, recordsFetched: 0, message: error instanceof Error ? error.message : "Falla desconocida" };
    }
  }

  private async searchCaseUncached(caseNumber: string, chamberExternalId: string): Promise<StjCaseSearchResult> {
    const parsed = normalizeCaseNumber(caseNumber);
    const court = (await this.fetchCatalogs()).find((item) => item.externalId === chamberExternalId);
    if (!court) throw new ProviderError("INVALID_RESPONSE", "Sala STJ no reconocida", false);
    const stem = `${STJ_AGREEMENTS_URL}/page:1/sala:${chamberExternalId}/search_value:${parsed.normalized.replace("/", ".")}/m:0`;
    const first = await respectfulFetch(stem, { headers: { Accept: "text/html", Referer: STJ_AGREEMENTS_URL } });
    if (!first.ok) throw new ProviderError("SOURCE_UNAVAILABLE", `Acuerdos STJ HTTP ${first.status}`, true);
    const firstHtml = await first.text();
    const records = parseStjAgreementsHtml(firstHtml, chamberExternalId, parsed.normalized);
    const pages = maxPage(firstHtml);
    for (let page = 2; page <= pages; page += 1) {
      const url = stem.replace("/page:1/", `/page:${page}/`);
      const response = await respectfulFetch(url, { headers: { Accept: "text/html", Referer: stem } });
      if (!response.ok) throw new ProviderError("SOURCE_UNAVAILABLE", `Acuerdos STJ página ${page} HTTP ${response.status}`, true);
      records.push(...parseStjAgreementsHtml(await response.text(), chamberExternalId, parsed.normalized));
    }
    const unique = [...new Map(records.map((record) => [record.externalId, record])).values()]
      .sort((left, right) => (right.agreementDate ?? right.publicationDate).localeCompare(left.agreementDate ?? left.publicationDate));
    return { court, caseNumber: parsed.normalized, retrievedAt: new Date().toISOString(), sourceUrl: stem, records: unique };
  }

  async searchCase(caseNumber: string, chamberExternalId: string): Promise<StjCaseSearchResult> {
    const normalized = normalizeCaseNumber(caseNumber).normalized;
    const key = `${chamberExternalId}:${normalized}`;
    const cached = caseSearchCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;
    const promise = this.searchCaseUncached(normalized, chamberExternalId).catch((error) => {
      caseSearchCache.delete(key);
      throw error;
    });
    caseSearchCache.set(key, { expiresAt: Date.now() + 60_000, promise });
    if (caseSearchCache.size > 200) caseSearchCache.delete(caseSearchCache.keys().next().value as string);
    return promise;
  }

  async searchAcrossChambers(caseNumber: string): Promise<StjCaseSearchResult[]> {
    const normalized = normalizeCaseNumber(caseNumber).normalized;
    const cached = crossChamberCache.get(normalized);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const results: StjCaseSearchResult[] = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < stjChambers.length) {
        const chamber = stjChambers[cursor++];
        try {
          const result = await this.searchCase(normalized, chamber.externalId);
          if (result.records.length) results.push(result);
        } catch (error) {
          if (error instanceof ProviderError && !error.retryable) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 90));
      }
    };
    await Promise.all([worker(), worker()]);
    results.sort((left, right) => Number(left.court.externalId) - Number(right.court.externalId));
    crossChamberCache.set(normalized, { value: results, expiresAt: Date.now() + 5 * 60 * 1000 });
    if (crossChamberCache.size > 100) crossChamberCache = new Map([...crossChamberCache.entries()].slice(-50));
    return results;
  }

  async fetchCase(caseNumber: string, courtExternalId: string): Promise<RawPublication[]> {
    return (await this.searchCase(caseNumber, courtExternalId)).records;
  }

  async fetchPublications(query: PublicationQuery): Promise<RawPublication[]> {
    if (!query.caseNumber || !query.courtExternalId) throw new ProviderError("INVALID_RESPONSE", "STJ requiere Sala y número de Toca", false);
    return this.fetchCase(query.caseNumber, query.courtExternalId);
  }

  async fetchByDate(query: PublicationQuery): Promise<RawPublication[]> { return this.fetchPublications(query); }

  validate(record: RawPublication): void {
    normalizeCaseNumber(record.caseNumberRaw);
    if (!record.courtExternalId || !record.officialText || !/^\d{4}-\d{2}-\d{2}$/.test(record.publicationDate)) throw new ProviderError("SCHEMA_DRIFT", "Acuerdo STJ incompleto", false);
  }

  async normalize(record: RawPublication): Promise<NormalizedPublication> {
    this.validate(record);
    const parsed = normalizeCaseNumber(record.caseNumberRaw);
    const canonicalKey = canonicalCaseKey({ jurisdiction: "JALISCO", provider: this.id, courtExternalId: record.courtExternalId, caseType: record.caseType, number: parsed.number, year: parsed.year, suffix: parsed.suffix });
    return { ...record, caseNumberNormalized: parsed.normalized, number: parsed.number, year: parsed.year, canonicalCaseKey: canonicalKey, contentHash: sha256([canonicalKey, record.agreementDate ?? record.publicationDate, record.officialText].join("|")), snapshotHash: sha256(stableJson(record.rawPayload)), retrievedAt: new Date().toISOString(), parserVersion: this.parserVersion, providerVersion: this.providerVersion };
  }

  async probeJudgmentSearchAccess(): Promise<"AVAILABLE" | "RECAPTCHA_REQUIRED"> {
    const response = await respectfulFetch(`${STJ_JUDGMENTS_API}/tocas?page=1&paginador=1&recaptcha_token=`, { headers: { Accept: "application/json", Origin: "https://publicacionsentencias.stjjalisco.gob.mx", Referer: STJ_JUDGMENTS_URL } }, 1);
    if (response.status === 403) return "RECAPTCHA_REQUIRED";
    return response.ok ? "AVAILABLE" : "RECAPTCHA_REQUIRED";
  }
}
