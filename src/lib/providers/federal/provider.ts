import * as cheerio from "cheerio";
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
import { normalizeName } from "@/lib/domain/normalization";

const catalogItemSchema = z.object({ IdItem: z.number(), Valor: z.string() });

export interface FederalCircuit {
  externalId: string;
  name: string;
}

export interface FederalCourt extends CourtCatalogItem {
  jurisdiction: "FEDERAL";
  circuit: string;
  courtType: "DISTRICT" | "COLLEGIATE" | "APPEAL" | "REGIONAL" | "LABOR" | "OTHER";
  sessionCapable: boolean;
}

export type FederalSessionFilter = "lista" | "sesion";
export type FederalSessionType = "ORDINARY" | "EXTRAORDINARY";

export interface FederalSessionRecord {
  rowId: string;
  neun?: string;
  caseType: string;
  caseNumber: string;
  complainant?: string;
  authority?: string;
  rapporteur?: string;
  projectSecretary?: string;
  listDate: string;
  sessionDate?: string;
  result?: string;
  judgment?: string;
  projectPublicity?: string;
  file?: string;
  filter: FederalSessionFilter;
  sessionType: FederalSessionType;
}

export interface FederalAgreementRecord {
  order: string;
  neun?: string;
  notebook: string;
  caseNumber: string;
  agreementDate: string;
  publicationDate: string;
  summary: string;
  detailUrl: string;
}

interface FederalCaseSession {
  listDate?: string;
  sessionDate?: string;
  result?: string;
  judgmentSense?: string;
}

const baseDefault = "https://www.dgej.cjf.gob.mx/SiseInternet";
const sessionTypeId: Record<FederalSessionType, string> = { ORDINARY: "20651", EXTRAORDINARY: "20652" };
let circuitCache: { expires: number; value: FederalCircuit[] } | null = null;
const courtCache = new Map<string, { expires: number; value: FederalCourt[] }>();

function clean(value: string | undefined): string | undefined {
  const text = value?.replace(/\*+/g, "").replace(/\s+/g, " ").trim();
  return text || undefined;
}

function isoFromDmy(value: string | undefined): string | undefined {
  const match = value?.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : undefined;
}

function dmyFromIso(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new ProviderError("INVALID_RESPONSE", `Fecha federal inválida: ${value}`, false);
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function hasChallenge(html: string): boolean {
  return /g-recaptcha|recaptcha|captcha/i.test(html);
}

export function inferFederalCourtType(name: string): FederalCourt["courtType"] {
  if (/tribunal laboral federal/i.test(name)) return "LABOR";
  if (/apelaci[oó]n/i.test(name)) return "APPEAL";
  if (/colegiado/i.test(name)) return "COLLEGIATE";
  if (/pleno regional/i.test(name)) return "REGIONAL";
  if (/juzgado .+ distrito|juzgado de distrito|centro de justicia penal federal/i.test(name)) return "DISTRICT";
  return "OTHER";
}

export function isFederalSessionCourt(courtType: string | undefined): boolean {
  return courtType === "COLLEGIATE" || courtType === "APPEAL" || courtType === "REGIONAL";
}

function agreementTypeIds(caseType: string | undefined): string[] {
  const normalized = caseType?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() ?? "";
  if (normalized.includes("amparo contra leyes")) return ["10"];
  if (normalized.includes("amparo indirecto")) return ["1"];
  if (normalized.includes("amparo directo")) return ["10"];
  if (normalized.includes("conflictos de acumulacion")) return ["17"];
  if (normalized.includes("impedimento")) return ["13"];
  if (normalized.includes("incidentes de inejecucion")) return ["23"];
  if (normalized.includes("reconocimiento de inocencia")) return ["26"];
  if (normalized.includes("repeticion del acto reclamado")) return ["24"];
  if (normalized.includes("revision contenciosa")) return ["14"];
  if (normalized.includes("revision fiscal")) return ["16"];
  if (normalized.includes("causa penal")) return ["2"];
  if (normalized.includes("declaratoria general de inconstitucionalidad")) return ["71"];
  if (normalized.includes("ejecucion de penas")) return ["67"];
  if (normalized.includes("juicio oral mercantil")) return ["68"];
  if (normalized.includes("medidas precautorias")) return ["18"];
  if (normalized.includes("extradicion")) return ["19"];
  if (normalized.includes("revision")) return ["11"];
  if (normalized.includes("conflicto") || normalized.includes("competencial")) return ["12"];
  if (normalized.includes("queja")) return ["15"];
  if (normalized.includes("reclam")) return ["20"];
  if (normalized.includes("inconform")) return ["25"];
  if (normalized.includes("civil") || normalized.includes("administrativ")) return ["4"];
  return [];
}

export function supportsFederalCaseType(caseType: string | undefined): boolean {
  return agreementTypeIds(caseType).length > 0;
}

function federalCaseTypeKey(value: string | undefined): string {
  const normalized = normalizeName(value ?? "").toLowerCase();
  if (!normalized) return "";
  if (normalized.includes("amparo contra leyes")) return "AMPARO_CONTRA_LEYES";
  if (normalized.includes("amparo directo")) return "AMPARO_DIRECTO";
  if (normalized.includes("revision fiscal")) return "REVISION_FISCAL";
  if (normalized.includes("revision contenciosa")) return "REVISION_CONTENCIOSA";
  if (normalized.includes("amparo") && normalized.includes("revision")) return "AMPARO_REVISION";
  if (normalized.includes("amparo indirecto")) return "AMPARO_INDIRECTO";
  if (normalized.includes("conflicto") && normalized.includes("acumulacion")) return "CONFLICTO_ACUMULACION";
  if (normalized.includes("conflicto") || normalized.includes("competencial")) return "CONFLICTO_COMPETENCIAL";
  if (normalized.includes("incidente") && normalized.includes("inejecucion")) return "INCIDENTE_INEJECUCION";
  if (normalized.includes("repeticion") && normalized.includes("acto reclamado")) return "REPETICION_ACTO";
  if (normalized.includes("reconocimiento") && normalized.includes("inocencia")) return "RECONOCIMIENTO_INOCENCIA";
  if (normalized.includes("inconform")) return "INCONFORMIDAD";
  if (normalized.includes("impedimento")) return "IMPEDIMENTO";
  if (normalized.includes("queja")) return "QUEJA";
  if (normalized.includes("reclam")) return "RECLAMACION";
  return normalized.toUpperCase().replace(/\s+/g, "_");
}

export function federalCaseTypeMatches(requested: string | undefined, published: string | undefined): boolean {
  const left = federalCaseTypeKey(requested);
  const right = federalCaseTypeKey(published);
  return Boolean(left && right && left === right);
}

function agreementDetailUrl(args: string[]): string {
  const [organism, order, neun, matterId, autoDate, publicationDate, caseNumber] = args;
  const query = new URLSearchParams({
    listaAcOrd: order,
    listaAsuId: matterId,
    listaCatOrg: organism,
    listaExped: caseNumber,
    listaFAuto: autoDate.split(" ")[0],
    listaFPublicacion: publicationDate.split(" ")[0],
    listaNeun: neun,
  });
  return `${baseDefault}/Actuaria/VerAcuerdo.aspx?${query.toString()}`;
}

function courtNameFromCaseTitle(title: string): string {
  const separator = title.lastIndexOf(" - ");
  return (separator > 0 ? title.slice(0, separator) : title).trim();
}

export function parseFederalAgreementHistoryHtml(
  html: string,
  params: { caseNumber: string; caseType: string; courtExternalId: string; sourceUrl: string },
): { matched: boolean; courtName?: string; records: FederalAgreementRecord[]; caseSession?: FederalCaseSession; parties?: { plaintiff?: string; defendant?: string } } {
  if (hasChallenge(html)) throw new ProviderError("SOURCE_ACCESS_RESTRICTED", "La ficha federal respondió con CAPTCHA; la consulta se abortó", false);
  if (/No existe el n[uú]mero de expediente/i.test(html)) return { matched: false, records: [] };
  const $ = cheerio.load(html);
  const title = clean($("#lblNombreOrgano").text());
  if (!title) throw new ProviderError("SCHEMA_DRIFT", "La ficha federal no confirmó el órgano ni el tipo de asunto", false);
  const titleSeparator = title.lastIndexOf(" - ");
  const publishedCaseType = titleSeparator >= 0 ? title.slice(titleSeparator + 3).trim() : undefined;
  if (!federalCaseTypeMatches(params.caseType, publishedCaseType)) return { matched: false, records: [] };
  const formAction = $("form#form1").attr("action")?.replace(/&amp;/g, "&");
  if (!formAction) throw new ProviderError("SCHEMA_DRIFT", "La ficha federal no publicó su identidad de expediente y órgano", false);
  const actionUrl = new URL(formAction, params.sourceUrl);
  const actionCase = actionUrl.searchParams.get("expediente");
  const actionCourt = actionUrl.searchParams.get("organismo");
  let confirmedCase = false;
  try {
    confirmedCase = Boolean(actionCase && normalizeCaseNumber(actionCase).normalized === normalizeCaseNumber(params.caseNumber).normalized);
  } catch { confirmedCase = false; }
  if (!confirmedCase || actionCourt !== params.courtExternalId) {
    throw new ProviderError("SCHEMA_DRIFT", "La ficha federal no confirmó el expediente y órgano solicitados", false);
  }
  const headers = $("#grvAcuerdos tr").first().find("th").map((_, cell) => clean($(cell).text()) ?? "").get();
  const fieldValue = (label: RegExp): string | undefined => {
    let value: string | undefined;
    $("tr").each((_, row) => {
      const cells = $(row).children("td");
      if (cells.length >= 2 && label.test(clean($(cells[0]).text()) ?? "")) value = clean($(cells[1]).text());
    });
    return value;
  };
  const sessionRaw = {
    listDate: isoFromDmy(fieldValue(/^Fecha lista asunto para resoluci[oó]n$/i)),
    sessionDate: isoFromDmy(fieldValue(/^Fecha sesi[oó]n$/i)),
    result: fieldValue(/^Resultado sesi[oó]n$/i),
    judgmentSense: fieldValue(/^Sentido sentencia$/i),
  };
  const caseSession = Object.values(sessionRaw).some(Boolean) ? sessionRaw : undefined;
  const parties = {
    plaintiff: fieldValue(/^(Quejoso|Actor|Promovente|Recurrente|Parte actora)$/i),
    defendant: fieldValue(/^(Autoridad responsable|Tercero interesado|Demandado|Parte demandada)$/i),
  };
  if (!headers.length) return { matched: true, courtName: courtNameFromCaseTitle(title), records: [], caseSession, parties };
  if (!["No.", "Fecha del Auto", "Tipo Cuaderno", "Fecha de publicación", "Resumen"].every((label) => headers.includes(label))) {
    throw new ProviderError("SCHEMA_DRIFT", "La ficha federal de acuerdos cambió de columnas", false);
  }
  const records: FederalAgreementRecord[] = [];
  $("#grvAcuerdos tr").slice(1).each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 5) return;
    const agreementDate = isoFromDmy(clean($(cells[1]).text()));
    const publicationDate = isoFromDmy(clean($(cells[3]).text()));
    const summary = clean($(cells[4]).text());
    if (!agreementDate || !publicationDate || !summary) throw new ProviderError("SCHEMA_DRIFT", "Una fila federal de acuerdos contiene fecha o extracto inválido", false);
    const href = $(cells[5]).find("a").attr("href") ?? "";
    const detail = href.match(/DoVerAcuerdo\((\d+),(\d+),(\d+),(\d+),["']([^"']+)["'],["']([^"']+)["'],["']([^"']+)["']\)/);
    const args = detail?.slice(1) ?? [];
    records.push({
      order: clean($(cells[0]).text()) ?? String(records.length + 1),
      neun: args[2],
      notebook: clean($(cells[2]).text()) ?? params.caseType,
      caseNumber: params.caseNumber,
      agreementDate,
      publicationDate,
      summary,
      detailUrl: args.length === 7 ? agreementDetailUrl(args) : params.sourceUrl,
    });
  });
  return { matched: true, courtName: courtNameFromCaseTitle(title), records, caseSession, parties };
}

function parseCaseCell(text: string): { caseType: string; caseNumber: string } | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(/(\d{1,8}\s*[/-]\s*\d{4}(?:\s*[-/]\s*[A-Za-z0-9-]+)?)$/);
  if (!match) return null;
  return { caseType: normalized.slice(0, match.index).trim() || "No especificado", caseNumber: match[1].replace(/\s+/g, "") };
}

export function parseFederalSessionHtml(
  html: string,
  params: { requestedDate: string; filter: FederalSessionFilter; sessionType: FederalSessionType },
): FederalSessionRecord[] {
  if (hasChallenge(html)) throw new ProviderError("SOURCE_ACCESS_RESTRICTED", "La fuente federal respondió con CAPTCHA; esta estrategia se abortó", false);
  const $ = cheerio.load(html);
  const headers = $("table tr").first().find("td").map((_, cell) => $(cell).text().replace(/\s+/g, " ").trim()).get();
  const expected = ["No", "NEUN", "No. Expediente", "Fecha de Sesión", "Resultado"];
  if (!expected.every((label) => headers.includes(label))) {
    throw new ProviderError("SCHEMA_DRIFT", "La lista federal cambió de columnas", false);
  }
  const records: FederalSessionRecord[] = [];
  $("table tr[id^='row']").each((_, row) => {
    const cells = $(row).find("td").map((__, cell) => $(cell).text().replace(/\s+/g, " ").trim()).get();
    if (cells.length < 9) return;
    const parsed = parseCaseCell(cells[2]);
    if (!parsed) throw new ProviderError("SCHEMA_DRIFT", `No se pudo interpretar el expediente federal de la fila ${$(row).attr("id")}`, false);
    records.push({
      rowId: $(row).attr("id") ?? `${cells[1]}-${records.length}`,
      neun: clean(cells[1]),
      caseType: parsed.caseType,
      caseNumber: parsed.caseNumber,
      complainant: clean(cells[3]),
      authority: clean(cells[4]),
      rapporteur: clean(cells[5]),
      projectSecretary: clean(cells[6]),
      listDate: params.requestedDate,
      sessionDate: isoFromDmy(cells[7]),
      result: clean(cells[8]),
      judgment: clean(cells[9]),
      projectPublicity: clean(cells[10]),
      file: clean(cells[11]),
      filter: params.filter,
      sessionType: params.sessionType,
    });
  });
  if (!records.length && !/No se localizaron registros/i.test($.text())) {
    throw new ProviderError("SCHEMA_DRIFT", "La fuente federal no entregó filas ni confirmó ausencia de registros", false);
  }
  return records;
}

function federalExtract(record: FederalSessionRecord): string {
  const status = record.filter === "lista" ? "LISTADO PARA SESIÓN" : "SESIONADO";
  const parts = [
    `${status}${record.sessionDate ? ` DEL ${record.sessionDate}` : ""}.`,
    record.result ? `RESULTADO: ${record.result}.` : undefined,
    record.judgment ? `SENTIDO: ${record.judgment}.` : undefined,
    record.rapporteur ? `PONENTE: ${record.rapporteur}.` : undefined,
    record.authority ? `AUTORIDAD: ${record.authority}.` : undefined,
  ];
  return parts.filter(Boolean).join(" ");
}

export class FederalProvider implements JudicialSourceProvider {
  readonly id = "federal-pjf-session-lists";
  readonly name = "Poder Judicial de la Federación";
  readonly providerVersion = "3.0.0";
  readonly parserVersion = "federal-sise-agreements-session-3";
  private readonly base = process.env.FEDERAL_SESSION_BASE ?? baseDefault;
  private readonly officialPage = "https://www.oaj.gob.mx/micrositios/dggj/paginas/serviciosTramites.htm?pageName=servicios%2FlistaSesion.htm";

  async discover() {
    return {
      sourceUrl: this.officialPage,
      capabilities: ["32-circuit-catalog", "all-federal-courts", "case-agreement-history", "session-calendar", "session-list-by-court-and-date", "historical-backfill", "no-captcha-bypass"],
    };
  }

  private async postHtml(path: string, payload: Array<{ Item: string; Valor: string }>): Promise<string> {
    const response = await respectfulFetch(`${this.base}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Accept: "text/html" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new ProviderError("SOURCE_UNAVAILABLE", `Lista federal HTTP ${response.status}`, true);
    const html = await response.text();
    if (hasChallenge(html)) throw new ProviderError("SOURCE_ACCESS_RESTRICTED", "La ruta federal respondió con CAPTCHA", false);
    if (!/<html|<select|<table/i.test(html)) throw new ProviderError("INVALID_RESPONSE", "La ruta federal no entregó HTML reconocible", true);
    return html;
  }

  async getCircuits(): Promise<FederalCircuit[]> {
    if (circuitCache && circuitCache.expires > Date.now()) return circuitCache.value;
    const response = await respectfulFetch(`${this.base}/Reportes/ListaSesion/ObtenerTiposOrgano.ashx`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json" },
      body: new URLSearchParams({ TipoId: "1" }),
    });
    if (!response.ok) throw new ProviderError("SOURCE_UNAVAILABLE", `Catálogo de circuitos HTTP ${response.status}`, true);
    const parsed = z.array(catalogItemSchema).safeParse(await response.json());
    if (!parsed.success) throw new ProviderError("SCHEMA_DRIFT", "El catálogo federal de circuitos cambió", false);
    const value = parsed.data.filter((item) => item.IdItem > 0).map((item) => ({ externalId: String(item.IdItem), name: item.Valor.trim() }));
    if (value.length < 32) throw new ProviderError("SCHEMA_DRIFT", `Sólo se recibieron ${value.length} circuitos federales`, false);
    circuitCache = { value, expires: Date.now() + 24 * 60 * 60 * 1000 };
    return value;
  }

  async getCourts(circuitId: string): Promise<FederalCourt[]> {
    const cached = courtCache.get(circuitId);
    if (cached && cached.expires > Date.now()) return cached.value;
    const circuit = (await this.getCircuits()).find((item) => item.externalId === circuitId);
    if (!circuit) throw new ProviderError("INVALID_RESPONSE", `Circuito federal no reconocido: ${circuitId}`, false);
    const responses = await Promise.all((["1", "2"] as const).map(async (sourceType) => ({
      sourceType,
      html: await this.postHtml("Controles/ComboOrganismo.aspx", [
        { Item: "Circuito", Valor: circuitId },
        { Item: "Llamada", Valor: "0" },
        { Item: "TipoOrgano", Valor: sourceType },
      ]),
    })));
    const byId = new Map<string, FederalCourt>();
    for (const response of responses) {
      const $ = cheerio.load(response.html);
      $("#ddlOrganismo option").each((_, option) => {
        const externalId = $(option).attr("value");
        const name = $(option).text().replace(/\s+/g, " ").trim();
        if (!externalId || externalId === "0" || !name) return;
        const inferred = inferFederalCourtType(name);
        const existing = byId.get(externalId);
        byId.set(externalId, {
          externalId,
          name,
          jurisdiction: "FEDERAL",
          circuit: circuitId,
          matter: "Federal",
          courtType: inferred,
          sessionCapable: response.sourceType === "2" || existing?.sessionCapable === true || isFederalSessionCourt(inferred),
        });
      });
    }
    const value = [...byId.values()].sort((left, right) => left.courtType.localeCompare(right.courtType) || left.name.localeCompare(right.name, "es"));
    if (!value.length) throw new ProviderError("SCHEMA_DRIFT", `El circuito ${circuit.name} no entregó órganos jurisdiccionales`, false);
    courtCache.set(circuitId, { value, expires: Date.now() + 24 * 60 * 60 * 1000 });
    return value;
  }

  async fetchCatalogs(): Promise<FederalCourt[]> {
    const circuits = await this.getCircuits();
    const result: FederalCourt[] = [];
    for (let index = 0; index < circuits.length; index += 2) {
      const batch = circuits.slice(index, index + 2);
      const courts = await Promise.all(batch.map((circuit) => this.getCourts(circuit.externalId)));
      result.push(...courts.flat());
      if (index + 2 < circuits.length) await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return result;
  }

  async getAvailableDates(courtExternalId: string, filter: FederalSessionFilter, year: number, month: number): Promise<string[]> {
    if (month < 1 || month > 12 || year < 2000 || year > 2200) throw new ProviderError("INVALID_RESPONSE", "Mes federal fuera de rango", false);
    const html = await this.postHtml("Controles/ucCalendario.aspx", [
      { Item: "AnioAnterior", Valor: String(year) },
      { Item: "MesAnterior", Valor: String(month) },
      { Item: "OrganismoId", Valor: courtExternalId },
      { Item: "TipoFiltro", Valor: filter },
    ]);
    return [...html.matchAll(/ObtenerReporte\('(\d{2}\/\d{2}\/\d{4})'\)/g)]
      .map((match) => isoFromDmy(match[1]))
      .filter((date): date is string => Boolean(date));
  }

  async fetchSessionList(params: {
    court: FederalCourt;
    date: string;
    filter?: FederalSessionFilter;
    sessionType?: FederalSessionType;
  }): Promise<{ records: RawPublication[]; rawHtml: string }> {
    const filter = params.filter ?? "lista";
    const sessionType = params.sessionType ?? "ORDINARY";
    const html = await this.postHtml("Reportes/ListaSesion/ReporteSesion.aspx", [
      { Item: "Fecha", Valor: dmyFromIso(params.date) },
      { Item: "OrganismoId", Valor: params.court.externalId },
      { Item: "TipoFiltro", Valor: filter },
      { Item: "TipoSesion", Valor: sessionTypeId[sessionType] },
    ]);
    const parsed = parseFederalSessionHtml(html, { requestedDate: params.date, filter, sessionType });
    const snapshotHash = sha256(`${params.court.externalId}|${params.date}|${filter}|${sessionType}|${html}`);
    const records = parsed.map((record) => ({
      externalId: `${record.rowId}:${filter}:${sessionType}`,
      courtExternalId: params.court.externalId,
      courtName: params.court.name,
      caseNumberRaw: record.caseNumber,
      caseType: record.caseType,
      officialText: federalExtract(record),
      parties: { plaintiff: record.complainant, defendant: record.authority },
      publicationDate: record.listDate,
      agreementDate: record.sessionDate,
      sourceUrl: this.officialPage,
      rawPayload: { record, circuitId: params.court.circuit, courtType: params.court.courtType, snapshotHash, rawHtml: html },
    } satisfies RawPublication));
    return { records, rawHtml: html };
  }

  async fetchCase(caseNumber: string, courtExternalId: string, caseType?: string): Promise<RawPublication[]> {
    const typeIds = agreementTypeIds(caseType);
    if (!typeIds.length) throw new ProviderError("INVALID_RESPONSE", `Tipo de asunto federal no soportado para acuerdos: ${caseType ?? "sin tipo"}`, false);
    for (const typeId of typeIds) {
      const query = new URLSearchParams({ expediente: caseNumber, organismo: courtExternalId, tipoasunto: typeId, tipoprocedimiento: "0" });
      const sourceUrl = `${this.base}/Reportes/VerCaptura.aspx?${query.toString()}`;
      const response = await respectfulFetch(sourceUrl, { headers: { Accept: "text/html" } });
      if (!response.ok) throw new ProviderError("SOURCE_UNAVAILABLE", `Ficha federal HTTP ${response.status}`, true);
      const html = await response.text();
      const parsed = parseFederalAgreementHistoryHtml(html, { caseNumber, caseType: caseType ?? "Asunto federal", courtExternalId, sourceUrl });
      if (!parsed.matched) continue;
      const snapshotHash = sha256(`${courtExternalId}|${caseNumber}|${typeId}|${html}`);
      const records: RawPublication[] = parsed.records.map((record) => ({
        externalId: `agreement:${record.neun ?? caseNumber}:${record.order}`,
        courtExternalId,
        courtName: parsed.courtName ?? `Órgano federal ${courtExternalId}`,
        caseNumberRaw: caseNumber,
        caseType: caseType ?? "Asunto federal",
        officialText: record.summary,
        parties: parsed.parties,
        publicationDate: record.publicationDate,
        agreementDate: record.agreementDate,
        sourceUrl: record.detailUrl,
        rawPayload: { agreement: record, typeId, snapshotHash, rawHtml: html, requestMethod: "GET", historyUrl: sourceUrl },
      } satisfies RawPublication));
      const session = parsed.caseSession;
      if (session?.listDate) {
        const listed: FederalSessionRecord = {
          rowId: `case-${caseNumber}-listed`, caseType: caseType ?? "Asunto federal", caseNumber,
          listDate: session.listDate, sessionDate: session.sessionDate, filter: "lista", sessionType: "ORDINARY",
        };
        records.push({
          externalId: listed.rowId, courtExternalId, courtName: parsed.courtName, caseNumberRaw: caseNumber,
          caseType: listed.caseType, officialText: federalExtract(listed), publicationDate: listed.listDate,
          agreementDate: listed.sessionDate, sourceUrl, rawPayload: { record: listed, directCaseSession: true, snapshotHash, rawHtml: html, requestMethod: "GET" },
        });
      }
      if (session?.sessionDate && (session.result || session.judgmentSense)) {
        const resolved: FederalSessionRecord = {
          rowId: `case-${caseNumber}-resolved`, caseType: caseType ?? "Asunto federal", caseNumber,
          listDate: session.sessionDate, sessionDate: session.sessionDate, result: session.result, judgment: session.judgmentSense,
          filter: "sesion", sessionType: "ORDINARY",
        };
        records.push({
          externalId: resolved.rowId, courtExternalId, courtName: parsed.courtName, caseNumberRaw: caseNumber,
          caseType: resolved.caseType, officialText: federalExtract(resolved), publicationDate: resolved.listDate,
          agreementDate: resolved.sessionDate, sourceUrl, rawPayload: { record: resolved, directCaseSession: true, snapshotHash, rawHtml: html, requestMethod: "GET" },
        });
      }
      return records;
    }
    return [];
  }

  async fetchPublications(query: PublicationQuery): Promise<RawPublication[]> {
    if (!query.courtExternalId) throw new ProviderError("INVALID_RESPONSE", "Federal requiere identificador de tribunal", false);
    const courts = query.circuitId ? await this.getCourts(query.circuitId) : await this.fetchCatalogs();
    const court = courts.find((item) => item.externalId === query.courtExternalId);
    if (!court) throw new ProviderError("INVALID_RESPONSE", `Tribunal federal no reconocido: ${query.courtExternalId}`, false);
    if (!court.sessionCapable) return [];
    const filter = query.sourceMode === "SESSION" ? "sesion" : "lista";
    const lists = await Promise.all((["ORDINARY", "EXTRAORDINARY"] as const).map((sessionType) => this.fetchSessionList({ court, date: query.date, filter, sessionType })));
    const records = lists.flatMap((list) => list.records);
    if (!query.caseNumber) return records;
    const requested = normalizeCaseNumber(query.caseNumber).normalized;
    return records.filter((record) =>
      normalizeCaseNumber(record.caseNumberRaw).normalized === requested
      && federalCaseTypeMatches(query.caseType, record.caseType),
    );
  }

  async fetchByDate(query: PublicationQuery): Promise<RawPublication[]> {
    return this.fetchPublications(query);
  }

  validate(record: RawPublication): void {
    normalizeCaseNumber(record.caseNumberRaw);
    if (!record.courtExternalId || !record.courtName || !record.officialText || !/^\d{4}-\d{2}-\d{2}$/.test(record.publicationDate)) {
      throw new ProviderError("SCHEMA_DRIFT", "Publicación federal incompleta", false);
    }
  }

  async normalize(record: RawPublication): Promise<NormalizedPublication> {
    this.validate(record);
    const parsed = normalizeCaseNumber(record.caseNumberRaw);
    const retrievedAt = new Date().toISOString();
    const canonicalKey = canonicalCaseKey({
      jurisdiction: "FEDERAL",
      provider: this.id,
      courtExternalId: record.courtExternalId,
      caseType: record.caseType,
      number: parsed.number,
      year: parsed.year,
      suffix: parsed.suffix,
    });
    const payload = record.rawPayload as { snapshotHash?: string; record?: FederalSessionRecord };
    const sessionIdentity = payload.record?.filter
      ? [canonicalKey, payload.record.filter, record.publicationDate, record.agreementDate, payload.record.filter === "sesion" ? payload.record.result : undefined, payload.record.filter === "sesion" ? payload.record.judgment : undefined].join("|")
      : [canonicalKey, record.externalId, record.publicationDate, record.agreementDate, record.officialText].join("|");
    return {
      ...record,
      caseNumberNormalized: parsed.normalized,
      number: parsed.number,
      year: parsed.year,
      canonicalCaseKey: canonicalKey,
      contentHash: sha256(sessionIdentity),
      snapshotHash: payload.snapshotHash ?? sha256(stableJson(record.rawPayload)),
      retrievedAt,
      parserVersion: this.parserVersion,
      providerVersion: this.providerVersion,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const started = Date.now();
    try {
      const circuits = await this.getCircuits();
      const courts = await this.getCourts("3");
      return {
        provider: this.id,
        status: circuits.length >= 32 && courts.length > 0 ? "ONLINE" : "DEGRADED",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        recordsFetched: courts.length,
        message: "Catálogo, acuerdos por expediente y listas a sesión públicas disponibles",
        details: { circuits: circuits.length, sampleCircuitCourts: courts.length, automatedPublicationAccess: true, scope: "ACUERDOS_Y_LISTAS_A_SESION" },
      };
    } catch (error) {
      return {
        provider: this.id,
        status: error instanceof ProviderError && error.code === "SOURCE_ACCESS_RESTRICTED" ? "UNAVAILABLE" : "FAILED",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        recordsFetched: 0,
        message: error instanceof Error ? error.message : "Falla desconocida",
      };
    }
  }
}
