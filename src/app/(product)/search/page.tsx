import Link from "next/link";
import { Buildings, CaretDown, MagnifyingGlass, Scales } from "@phosphor-icons/react/dist/ssr";
import { SearchableSelect } from "@/components/searchable-select";
import { SearchResultAdd } from "@/components/search-result-add";
import { FederalCaseSelection, federalCourtTypeNames, type FederalCourtType } from "@/components/federal-case-selection";
import { getSession } from "@/lib/security/session";
import { encodeSearchResult, type SearchResultPayload } from "@/lib/product/search-payload";
import { listFolders } from "@/lib/product/repository";
import { JaliscoProvider, type JaliscoCaseSearchResult, type JaliscoCourtCatalogItem } from "@/lib/providers/jalisco/provider";
import { FederalProvider, type FederalCourt } from "@/lib/providers/federal/provider";

export const dynamic = "force-dynamic";

type SearchParams = {
  scope?: "JALISCO" | "FEDERAL" | "GENERAL";
  q?: string;
  court?: string;
  circuit?: string;
  caseType?: string;
  error?: string;
};

type DisplayResult = {
  key: string;
  number: string;
  caseType: string;
  jurisdiction: "JALISCO" | "FEDERAL";
  courtName: string;
  plaintiff?: string;
  defendant?: string;
  publicationCount: number;
  lastPublicationDate?: string;
  monitoredCaseId?: string;
  payload: SearchResultPayload;
  movements: Array<{ key: string; publicationDate: string; agreementDate?: string; officialText: string }>;
};

function humanDate(value?: string) {
  if (!value) return "Sin fecha publicada";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function firstParty(result: JaliscoCaseSearchResult, side: "plaintiff" | "defendant") {
  return result.records.find((record) => record.parties?.[side])?.parties?.[side];
}

function newestDate(records: Array<{ publicationDate: string }>): string | undefined {
  return records.map((record) => record.publicationDate).sort((left, right) => right.localeCompare(left))[0];
}

function searchMovements(records: Array<{ externalId?: string | number; publicationDate: string; agreementDate?: string; officialText: string }>) {
  return records
    .map((record, index) => ({ key: String(record.externalId ?? index), publicationDate: record.publicationDate, agreementDate: record.agreementDate, officialText: record.officialText }))
    .sort((left, right) => right.publicationDate.localeCompare(left.publicationDate) || (right.agreementDate ?? "").localeCompare(left.agreementDate ?? ""));
}

function SearchResultCard({ result, organizationId, folders }: { result: DisplayResult; organizationId: string; folders: Awaited<ReturnType<typeof listFolders>> }) {
  const signed = encodeSearchResult(result.payload, organizationId);
  return <article className="judicial-search-result">
    <header><div><span className="result-kicker">{result.jurisdiction === "JALISCO" ? "PODER JUDICIAL DEL ESTADO DE JALISCO" : "PODER JUDICIAL DE LA FEDERACIÓN"}</span><h2>{result.number}</h2><p>{result.caseType}</p></div><div className="search-result-count"><strong>{result.publicationCount}</strong><span>{result.publicationCount === 1 ? "resolución" : "resoluciones"}</span></div></header>
    <p className="search-result-court">{result.courtName}</p>
    <div className="party-grid search-party-grid"><div><span>Actor / quejoso / promovente</span><strong>{result.plaintiff ?? "No publicado por la fuente"}</strong></div><div><span>Demandado / tercero / autoridad</span><strong>{result.defendant ?? "No publicado por la fuente"}</strong></div></div>
    <details className="search-result-detail"><summary>Ver resoluciones <CaretDown size={14} /></summary><div className="search-result-movements">{result.movements.length ? result.movements.map((movement) => <article key={movement.key}><div><time>Publicada {humanDate(movement.publicationDate)}</time>{movement.agreementDate && <small>Fecha del auto: {humanDate(movement.agreementDate)}</small>}</div><p>{movement.officialText}</p></article>) : <p className="muted">La ficha oficial no publicó resoluciones para este asunto.</p>}</div></details>
    <footer><small>Última publicación: {humanDate(result.lastPublicationDate)}</small>{result.monitoredCaseId ? <Link className="button button-secondary button-small" href={`/cases/${result.monitoredCaseId}`}>Ya está en seguimiento</Link> : <SearchResultAdd {...signed} folders={folders} />}</footer>
  </article>;
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const session = await getSession();
  if (!session) return null;
  const scope = params.scope === "JALISCO" || params.scope === "FEDERAL" ? params.scope : undefined;
  if (!scope) return <div className="content search-hub">
    <div className="page-heading"><div><p className="eyebrow">BÚSQUEDA JUDICIAL</p><h1>¿Dónde deseas buscar?</h1><p>Consulta un expediente directamente en la fuente oficial correspondiente.</p></div></div>
    <section className="search-scope-grid">
      <Link href="/search?scope=JALISCO"><span className="scope-icon"><Buildings size={28} weight="duotone" /></span><small>PJE</small><h2>Poder Judicial del Estado de Jalisco</h2><p>Selecciona el órgano y consulta el historial oficial por número de expediente.</p><strong>Entrar a búsqueda</strong></Link>
      <Link href="/search?scope=FEDERAL"><span className="scope-icon"><Scales size={28} weight="duotone" /></span><small>PJF</small><h2>Poder Judicial de la Federación</h2><p>Selecciona circuito, órgano y tipo de asunto antes de consultar el expediente.</p><strong>Entrar a búsqueda</strong></Link>
    </section>
  </div>;

  const query = (params.q ?? "").trim();
  const foldersPromise = listFolders(session.organizationId);
  const jalisco = new JaliscoProvider();
  const federal = new FederalProvider();
  let jaliscoCourts: JaliscoCourtCatalogItem[] = [];
  let circuits: Awaited<ReturnType<FederalProvider["getCircuits"]>> = [];
  let federalCourts: FederalCourt[] = [];
  let error: string | null = null;
  const results: DisplayResult[] = [];

  try {
    if (scope === "JALISCO") jaliscoCourts = await jalisco.fetchCatalogs();
    if (scope === "FEDERAL") {
      circuits = await federal.getCircuits();
      federalCourts = await federal.getCourts(params.circuit ?? "3");
    }
    if (query && scope === "JALISCO" && params.court) {
      const direct = await jalisco.searchCase(query, params.court);
      if (direct.records.length) results.push({
        key: `jalisco-${direct.court.externalId}-${direct.caseNumber}`,
        number: direct.caseNumber,
        caseType: direct.records.find((record) => record.caseType)?.caseType ?? direct.court.matter ?? "Asunto local",
        jurisdiction: "JALISCO",
        courtName: direct.court.name,
        plaintiff: firstParty(direct, "plaintiff"),
        defendant: firstParty(direct, "defendant"),
        publicationCount: direct.records.length,
        lastPublicationDate: newestDate(direct.records),
        movements: searchMovements(direct.records),
        payload: { jurisdiction: "JALISCO", provider: "jalisco-cjj", courtExternalId: direct.court.externalId, courtName: direct.court.name, caseNumber: direct.caseNumber, caseType: direct.records.find((record) => record.caseType)?.caseType ?? direct.court.matter ?? "Asunto local" },
      });
    } else if (query && scope === "FEDERAL" && params.court && params.caseType) {
      const court = federalCourts.find((item) => item.externalId === params.court);
      if (!court) throw new Error("Selecciona un órgano federal del circuito cargado.");
      const records = await federal.fetchCase(query, court.externalId, params.caseType);
      const agreements = records.filter((record) => !String(record.externalId).includes("case-"));
      if (records.length) results.push({
        key: `federal-${court.externalId}-${query}`,
        number: query,
        caseType: params.caseType,
        jurisdiction: "FEDERAL",
        courtName: court.name,
        plaintiff: records.find((record) => record.parties?.plaintiff)?.parties?.plaintiff,
        defendant: records.find((record) => record.parties?.defendant)?.parties?.defendant,
        publicationCount: agreements.length,
        lastPublicationDate: newestDate(agreements),
        movements: searchMovements(agreements),
        payload: { jurisdiction: "FEDERAL", provider: "federal-pjf-session-lists", courtExternalId: court.externalId, courtName: court.name, courtType: court.courtType, circuitId: params.circuit ?? "3", circuitName: circuits.find((item) => item.externalId === (params.circuit ?? "3"))?.name, caseNumber: query, caseType: params.caseType },
      });
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "No fue posible completar la consulta.";
  }
  const folders = await foldersPromise;
  return <div className="content search-page">
    <div className="page-heading"><div><p className="eyebrow">{scope === "JALISCO" ? "PJE JALISCO" : "PJF"}</p><h1>Búsqueda por expediente</h1><p>La consulta exige órgano, número y, en asuntos federales, el tipo exacto para evitar homónimos procesales.</p></div><Link className="button button-secondary" href="/search">Cambiar cobertura</Link></div>

    {scope === "FEDERAL" && <form className="panel catalog-picker" action="/search"><input type="hidden" name="scope" value="FEDERAL" /><SearchableSelect name="circuit" label="Circuito" options={circuits.map((item) => ({ value: item.externalId, label: item.name, group: "Circuitos federales" }))} defaultValue={params.circuit ?? "3"} required /><button className="button button-secondary" type="submit">Cargar órganos</button></form>}

    <form className="case-search-form panel judicial-search-form" action="/search">
      <input type="hidden" name="scope" value={scope} />
      {scope === "FEDERAL" && <input type="hidden" name="circuit" value={params.circuit ?? "3"} />}
      <div className="field"><label htmlFor="q">Número de expediente</label><div className="search-input-wrap"><MagnifyingGlass size={18} /><input id="q" name="q" defaultValue={query} placeholder="Ej. 1155/2003" required /></div></div>
      {scope === "JALISCO" && <SearchableSelect name="court" label="Órgano jurisdiccional" options={jaliscoCourts.map((court) => ({ value: court.externalId, label: court.name, group: court.matter, description: court.group }))} defaultValue={params.court} required searchPlaceholder="Buscar órgano…" />}
      {scope === "FEDERAL" && <FederalCaseSelection courts={federalCourts.map((court) => ({ value: court.externalId, label: court.name, group: federalCourtTypeNames[court.courtType], description: court.circuit, courtType: court.courtType as FederalCourtType }))} initialCourt={params.court} initialType={params.caseType} />}
      <button className="button button-primary" type="submit">Buscar</button>
    </form>

    <div className="source-assurance search-coverage-note"><span><strong>Consulta verificable.</strong> Las fuentes oficiales disponibles no ofrecen un índice global y exhaustivo por nombre de parte. Para evitar falsos negativos, Mi Boletín Judicial no presenta como investigación general una búsqueda limitada a datos previamente indexados.</span></div>
    {params.error && <div className="form-error">No fue posible agregar el resultado. Revisa la selección e inténtalo nuevamente.</div>}
    {error && <section className="search-state danger-notice"><strong>No se pudo completar la consulta.</strong><p>{error}</p><p>Conservamos los datos previos y no los sustituimos con resultados simulados.</p></section>}
    {!error && query && !results.length && <section className="search-state panel"><span className="search-state-number">0</span><div><h2>Sin resultados en la cobertura consultada</h2><p>Revisa los datos o prueba una participación más amplia.</p></div></section>}
    {!error && results.length > 0 && <><section className="search-results-heading"><div><span>{results.length}</span><p>{results.length === 1 ? "asunto encontrado" : "asuntos encontrados"}</p></div></section><div className="judicial-search-results">{results.map((result) => <SearchResultCard key={result.key} result={result} organizationId={session.organizationId} folders={folders} />)}</div></>}
  </div>;
}
