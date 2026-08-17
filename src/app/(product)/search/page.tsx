import Link from "next/link";
import { Buildings, FileText, GlobeHemisphereWest, MagnifyingGlass, Scales, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { SearchableSelect } from "@/components/searchable-select";
import { SearchResultAdd } from "@/components/search-result-add";
import { FederalCaseSelection, type FederalCourtType } from "@/components/federal-case-selection";
import { getSession } from "@/lib/security/session";
import { encodeSearchResult, type SearchResultPayload } from "@/lib/product/search-payload";
import { listFolders, searchJudicialCases, type JudicialSearchResult } from "@/lib/product/repository";
import { JaliscoProvider, type JaliscoCaseSearchResult, type JaliscoCourtCatalogItem } from "@/lib/providers/jalisco/provider";
import { FederalProvider, type FederalCourt } from "@/lib/providers/federal/provider";

export const dynamic = "force-dynamic";

type SearchParams = {
  scope?: "JALISCO" | "FEDERAL" | "GENERAL";
  mode?: "CASE" | "PARTY";
  side?: "plaintiff" | "defendant" | "both";
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
};

function humanDate(value?: string) {
  if (!value) return "Sin fecha publicada";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function firstParty(result: JaliscoCaseSearchResult, side: "plaintiff" | "defendant") {
  return result.records.find((record) => record.parties?.[side])?.parties?.[side];
}

function storedDisplay(result: JudicialSearchResult): DisplayResult {
  return {
    key: result.caseId,
    number: result.number,
    caseType: result.caseType,
    jurisdiction: result.jurisdiction,
    courtName: result.courtName,
    plaintiff: result.plaintiff,
    defendant: result.defendant,
    publicationCount: result.publicationCount,
    lastPublicationDate: result.lastPublicationDate,
    monitoredCaseId: result.monitoredCaseId,
    payload: {
      jurisdiction: result.jurisdiction,
      provider: result.provider as SearchResultPayload["provider"],
      courtExternalId: result.courtExternalId,
      courtName: result.courtName,
      courtType: result.courtType,
      circuitId: result.circuitId,
      circuitName: result.circuitName,
      caseNumber: result.number,
      caseType: result.caseType,
    },
  };
}

function SearchResultCard({ result, organizationId, folders }: { result: DisplayResult; organizationId: string; folders: Awaited<ReturnType<typeof listFolders>> }) {
  const signed = encodeSearchResult(result.payload, organizationId);
  return <article className="judicial-search-result">
    <header><div><span className="result-kicker">{result.jurisdiction === "JALISCO" ? "PODER JUDICIAL DEL ESTADO DE JALISCO" : "PODER JUDICIAL DE LA FEDERACIÓN"}</span><h2>{result.number}</h2><p>{result.caseType}</p></div><div className="search-result-count"><strong>{result.publicationCount}</strong><span>{result.publicationCount === 1 ? "resolución" : "resoluciones"}</span></div></header>
    <p className="search-result-court">{result.courtName}</p>
    <div className="party-grid search-party-grid"><div><span>Actor / quejoso / promovente</span><strong>{result.plaintiff ?? "No publicado por la fuente"}</strong></div><div><span>Demandado / tercero / autoridad</span><strong>{result.defendant ?? "No publicado por la fuente"}</strong></div></div>
    <footer><small>Última publicación: {humanDate(result.lastPublicationDate)}</small>{result.monitoredCaseId ? <Link className="button button-secondary button-small" href={`/cases/${result.monitoredCaseId}`}>Ya está en seguimiento</Link> : <SearchResultAdd {...signed} folders={folders} />}</footer>
  </article>;
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const session = await getSession();
  if (!session) return null;
  const scope = params.scope;
  if (!scope) return <div className="content search-hub">
    <div className="page-heading"><div><p className="eyebrow">BÚSQUEDA JUDICIAL</p><h1>¿Dónde deseas buscar?</h1><p>Elige la cobertura antes de definir el expediente o la persona.</p></div></div>
    <section className="search-scope-grid">
      <Link href="/search?scope=JALISCO&mode=CASE"><span className="scope-icon"><Buildings size={28} weight="duotone" /></span><small>PJE</small><h2>Poder Judicial del Estado de Jalisco</h2><p>Consulta directa por expediente y búsqueda por partes en publicaciones indexadas.</p><strong>Entrar a búsqueda</strong></Link>
      <Link href="/search?scope=FEDERAL&mode=CASE"><span className="scope-icon"><Scales size={28} weight="duotone" /></span><small>PJF</small><h2>Poder Judicial de la Federación</h2><p>Acuerdos federales, órganos por circuito y asuntos de tribunales colegiados.</p><strong>Entrar a búsqueda</strong></Link>
      <Link href="/search?scope=GENERAL&mode=PARTY"><span className="scope-icon"><GlobeHemisphereWest size={28} weight="duotone" /></span><small>INFORME</small><h2>Búsqueda generalizada</h2><p>Revisa conjuntamente los asuntos locales y federales que ya fueron indexados.</p><strong>Preparar informe</strong></Link>
    </section>
  </div>;

  const mode = params.mode === "PARTY" ? "PARTY" : "CASE";
  const side = params.side ?? "both";
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
    if (scope === "JALISCO" && mode === "CASE") jaliscoCourts = await jalisco.fetchCatalogs();
    if (scope === "FEDERAL" && mode === "CASE") {
      circuits = await federal.getCircuits();
      federalCourts = await federal.getCourts(params.circuit ?? "3");
    }
    if (query && mode === "PARTY") {
      results.push(...(await searchJudicialCases({ organizationId: session.organizationId, query, mode, scope, side, limit: 200 })).map(storedDisplay));
    } else if (query && scope === "GENERAL") {
      results.push(...(await searchJudicialCases({ organizationId: session.organizationId, query, mode: "CASE", scope, limit: 200 })).map(storedDisplay));
    } else if (query && scope === "JALISCO" && params.court) {
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
        lastPublicationDate: direct.records[0]?.publicationDate,
        payload: { jurisdiction: "JALISCO", provider: "jalisco-cjj", courtExternalId: direct.court.externalId, courtName: direct.court.name, caseNumber: direct.caseNumber, caseType: direct.records.find((record) => record.caseType)?.caseType ?? direct.court.matter ?? "Asunto local" },
      });
    } else if (query && scope === "FEDERAL" && params.court && params.caseType) {
      const court = federalCourts.find((item) => item.externalId === params.court);
      if (!court) throw new Error("Selecciona un órgano federal del circuito cargado.");
      const records = await federal.fetchCase(query, court.externalId, params.caseType);
      if (records.length) results.push({
        key: `federal-${court.externalId}-${query}`,
        number: query,
        caseType: params.caseType,
        jurisdiction: "FEDERAL",
        courtName: court.name,
        plaintiff: records.find((record) => record.parties?.plaintiff)?.parties?.plaintiff,
        defendant: records.find((record) => record.parties?.defendant)?.parties?.defendant,
        publicationCount: records.filter((record) => !String(record.externalId).includes("case-")).length,
        lastPublicationDate: records[0]?.publicationDate,
        payload: { jurisdiction: "FEDERAL", provider: "federal-pjf-session-lists", courtExternalId: court.externalId, courtName: court.name, courtType: court.courtType, circuitId: params.circuit ?? "3", circuitName: circuits.find((item) => item.externalId === (params.circuit ?? "3"))?.name, caseNumber: query, caseType: params.caseType },
      });
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "No fue posible completar la consulta.";
  }
  const folders = await foldersPromise;
  const reportParams = new URLSearchParams({ scope, mode, side, q: query });

  return <div className="content search-page">
    <div className="page-heading"><div><p className="eyebrow">{scope === "JALISCO" ? "PJE JALISCO" : scope === "FEDERAL" ? "PJF" : "COBERTURA GENERAL"}</p><h1>{mode === "PARTY" ? "Búsqueda por partes" : "Búsqueda por expediente"}</h1><p>{scope === "GENERAL" ? "Informe conjunto sobre publicaciones indexadas de ambas jurisdicciones." : "Consulta los datos disponibles de la jurisdicción seleccionada."}</p></div><Link className="button button-secondary" href="/search">Cambiar cobertura</Link></div>
    <nav className="search-mode-tabs" aria-label="Tipo de búsqueda"><Link data-active={mode === "CASE"} href={`/search?scope=${scope}&mode=CASE`}>Número de expediente</Link><Link data-active={mode === "PARTY"} href={`/search?scope=${scope}&mode=PARTY`}>Nombre de una parte</Link></nav>

    {scope === "FEDERAL" && mode === "CASE" && <form className="panel catalog-picker" action="/search"><input type="hidden" name="scope" value="FEDERAL" /><input type="hidden" name="mode" value="CASE" /><SearchableSelect name="circuit" label="Circuito" options={circuits.map((item) => ({ value: item.externalId, label: item.name, group: "Circuitos federales" }))} defaultValue={params.circuit ?? "3"} required /><button className="button button-secondary" type="submit">Cargar órganos</button></form>}

    <form className="case-search-form panel judicial-search-form" action="/search">
      <input type="hidden" name="scope" value={scope} /><input type="hidden" name="mode" value={mode} />
      {scope === "FEDERAL" && <input type="hidden" name="circuit" value={params.circuit ?? "3"} />}
      <div className="field"><label htmlFor="q">{mode === "PARTY" ? "Nombre de la persona o empresa" : "Número de expediente"}</label><div className="search-input-wrap"><MagnifyingGlass size={18} /><input id="q" name="q" defaultValue={query} placeholder={mode === "PARTY" ? "Nombre completo o razón social" : "Ej. 1155/2003"} required /></div></div>
      {mode === "PARTY" && <SearchableSelect name="side" label="Participación" options={[{ value: "both", label: "Actor o demandado", group: "Todas las posiciones" }, { value: "plaintiff", label: "Actor / quejoso", group: "Posición procesal" }, { value: "defendant", label: "Demandado / tercero / autoridad", group: "Posición procesal" }]} defaultValue={side} required />}
      {scope === "JALISCO" && mode === "CASE" && <SearchableSelect name="court" label="Órgano jurisdiccional" options={jaliscoCourts.map((court) => ({ value: court.externalId, label: court.name, group: court.matter, description: court.group }))} defaultValue={params.court} required searchPlaceholder="Buscar órgano…" />}
      {scope === "FEDERAL" && mode === "CASE" && <FederalCaseSelection courts={federalCourts.map((court) => ({ value: court.externalId, label: court.name, group: court.courtType, description: court.circuit, courtType: court.courtType as FederalCourtType }))} initialCourt={params.court} initialType={params.caseType} />}
      <button className="button button-primary" type="submit">Buscar</button>
    </form>

    {mode === "PARTY" && <div className="source-assurance search-coverage-note"><ShieldCheck size={16} weight="fill" /><span><strong>Búsqueda tolerante a mayúsculas, tildes y variantes ortográficas.</strong> El informe cubre publicaciones que Mi Boletín Judicial ya indexó. Los portales oficiales no ofrecen una consulta global exhaustiva por nombre; por eso no presentamos esta búsqueda como certificación de inexistencia.</span></div>}
    {params.error && <div className="form-error">No fue posible agregar el resultado. Revisa la selección e inténtalo nuevamente.</div>}
    {error && <section className="search-state danger-notice"><strong>No se pudo completar la consulta.</strong><p>{error}</p><p>Conservamos los datos previos y no los sustituimos con resultados simulados.</p></section>}
    {!error && query && !results.length && <section className="search-state panel"><span className="search-state-number">0</span><div><h2>Sin resultados en la cobertura consultada</h2><p>Revisa los datos o prueba una participación más amplia.</p></div></section>}
    {!error && results.length > 0 && <><section className="search-results-heading"><div><span>{results.length}</span><p>{results.length === 1 ? "asunto encontrado" : "asuntos encontrados"}</p></div>{mode === "PARTY" && <div className="report-actions"><a className="button button-secondary" href={`/api/reports/search?${reportParams.toString()}&detail=simple`}><FileText size={15} /> Descargar búsqueda simple</a><a className="button button-primary" href={`/api/reports/search?${reportParams.toString()}&detail=rigorous`}><FileText size={15} /> Descargar búsqueda rigurosa</a></div>}</section><div className="judicial-search-results">{results.map((result) => <SearchResultCard key={result.key} result={result} organizationId={session.organizationId} folders={folders} />)}</div></>}
  </div>;
}
