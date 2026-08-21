"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { ArrowRight, BellRinging, Buildings, DownloadSimple, MagnifyingGlass, ShieldCheck, UserFocus, Warning } from "@phosphor-icons/react";

type SearchResult = {
  caseId: string; monitoredCaseId?: string; number: string; caseType: string; jurisdiction: "JALISCO" | "FEDERAL";
  provider: string; courtName: string; matter?: string; matchName: string; matchRole: string;
  partyType: "PERSON" | "COMPANY" | "AUTHORITY" | "UNKNOWN"; score: number;
  matchKind: "EXACT" | "NORMALIZED" | "PARTIAL" | "APPROXIMATE" | "RELATED"; relationType?: string;
  publicationCount: number; lastPublicationDate?: string; plaintiff?: string; defendant?: string;
  evidence: { method: string; confidence: number; sourceUrl?: string; publicationDate?: string; direct: boolean };
};

type SearchCoverage = { provider: string; earliestIndexedDate?: string; latestIndexedDate?: string; casesIndexed: number; publicationsIndexed: number };
type SearchResponse = { query: string; page: number; pageSize: number; total: number; results: SearchResult[]; coverage?: SearchCoverage[] };

const roleLabels: Record<string, string> = {
  plaintiff: "Actor", defendant: "Demandado", quejoso: "Quejoso", tercero_interesado: "Tercero interesado",
  autoridad_responsable: "Autoridad responsable", recurrente: "Recurrente", promovente: "Promovente",
  apelante: "Apelante", apelado: "Apelado", unknown: "Participación no especificada",
};

function humanDate(value?: string) {
  return value ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)) : "Sin publicación fechada";
}

function matchLabel(result: SearchResult) {
  if (result.matchKind === "RELATED") return "Asunto relacionado";
  if (result.matchKind === "EXACT" || result.matchKind === "NORMALIZED") return "Parte identificada";
  return "Coincidencia por nombre";
}

export function PartySearchWorkspace({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [jurisdiction, setJurisdiction] = useState("");
  const [partyType, setPartyType] = useState("");
  const [role, setRole] = useState("");
  const [matter, setMatter] = useState("");
  const [provider, setProvider] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [resultType, setResultType] = useState("");
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [watchState, setWatchState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const runSearch = useCallback(async (page = 1) => {
    if (query.trim().length < 2) { setError("Escribe al menos dos caracteres del nombre."); return; }
    setLoading(true); setError("");
    const params = new URLSearchParams({ q: query.trim(), page: String(page), pageSize: "20" });
    if (jurisdiction) params.set("jurisdiction", jurisdiction);
    if (partyType) params.set("partyType", partyType);
    if (role) params.set("role", role);
    if (matter.trim()) params.set("matter", matter.trim());
    if (provider) params.set("provider", provider);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (resultType) params.set("resultType", resultType);
    try {
      const request = await fetch(`/api/search/parties?${params}`, { credentials: "same-origin", cache: "no-store" });
      const payload = await request.json() as SearchResponse & { error?: string };
      if (!request.ok) throw new Error(payload.error ?? "No fue posible completar la búsqueda");
      setResponse(payload);
      window.history.replaceState(null, "", `/search/names?q=${encodeURIComponent(query.trim())}`);
    } catch (cause) {
      setResponse(null); setError(cause instanceof Error ? cause.message : "No fue posible completar la búsqueda");
    } finally { setLoading(false); }
  }, [from, jurisdiction, matter, partyType, provider, query, resultType, role, to]);

  async function createWatch() {
    if (query.trim().length < 3) return;
    setWatchState("saving");
    const request = await fetch("/api/watch-rules", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: partyType === "COMPANY" || (!partyType && response?.results[0]?.partyType === "COMPANY") ? "COMPANY" : "PERSON", value: query.trim(), matchMode: "FLEXIBLE" }),
    });
    setWatchState(request.ok ? "saved" : "error");
  }

  const reportParams = new URLSearchParams({ scope: jurisdiction || "GENERAL", mode: "PARTY", side: role === "plaintiff" ? "plaintiff" : role === "defendant" ? "defendant" : "both", q: response?.query ?? query });
  if (role) reportParams.set("role", role);
  if (partyType) reportParams.set("partyType", partyType);
  if (matter.trim()) reportParams.set("matter", matter.trim());
  if (provider) reportParams.set("provider", provider);
  if (from) reportParams.set("from", from);
  if (to) reportParams.set("to", to);
  if (resultType) reportParams.set("resultType", resultType);
  const hasFilters = Boolean(jurisdiction || partyType || role || matter.trim() || provider || from || to || resultType);

  function clearFilters() {
    setJurisdiction(""); setPartyType(""); setRole(""); setMatter("");
    setProvider(""); setFrom(""); setTo(""); setResultType("");
  }

  return <div className="party-search-workspace">
    <form className="panel party-search-form" onSubmit={(event) => { event.preventDefault(); void runSearch(1); }}>
      <div className="party-search-primary">
        <label htmlFor="party-name">Nombre de persona o empresa</label>
        <div className="search-input-wrap"><MagnifyingGlass size={19} aria-hidden="true" /><input id="party-name" value={query} onChange={(event) => { setQuery(event.target.value); setWatchState("idle"); }} placeholder="Ej. José Pérez o Desarrolladora Yemanya" autoComplete="off" required minLength={2} maxLength={180} /></div>
        <p>La consulta ignora acentos, mayúsculas y puntuación societaria sin alterar el nombre publicado.</p>
      </div>
      <div className="party-search-filters" aria-label="Filtros de búsqueda">
        <label>Jurisdicción<select value={jurisdiction} onChange={(event) => setJurisdiction(event.target.value)}><option value="">Todas</option><option value="JALISCO">Jalisco</option><option value="FEDERAL">Federal</option></select></label>
        <label>Tipo de parte<select value={partyType} onChange={(event) => setPartyType(event.target.value)}><option value="">Cualquiera</option><option value="PERSON">Persona física</option><option value="COMPANY">Persona moral</option><option value="AUTHORITY">Autoridad</option></select></label>
        <label>Participación<select value={role} onChange={(event) => setRole(event.target.value)}><option value="">Cualquier posición</option><option value="plaintiff">Actor</option><option value="defendant">Demandado</option><option value="quejoso">Quejoso</option><option value="tercero_interesado">Tercero interesado</option><option value="autoridad_responsable">Autoridad responsable</option><option value="recurrente">Recurrente</option><option value="promovente">Promovente</option></select></label>
        <label>Materia<input value={matter} onChange={(event) => setMatter(event.target.value)} placeholder="Civil, mercantil…" /></label>
      </div>
      <details className="party-advanced-filters"><summary>Más filtros</summary><div>
        <label>Fuente<select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="">Todas las fuentes</option><option value="jalisco-cjj">Poder Judicial del Estado de Jalisco</option><option value="jalisco-stj-chambers">Supremo Tribunal de Justicia de Jalisco</option><option value="federal-pjf-session-lists">Poder Judicial de la Federación</option></select></label>
        <label>Publicado desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>Publicado hasta<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label>Tipo de resultado<select value={resultType} onChange={(event) => setResultType(event.target.value)}><option value="">Directos y relacionados</option><option value="DIRECT">Participación publicada</option><option value="RELATED">Asuntos relacionados</option></select></label>
      </div></details>
      <div className="party-search-actions">{hasFilters && <button className="button button-ghost" type="button" onClick={clearFilters}>Limpiar filtros</button>}<button className="button button-primary" type="submit" disabled={loading}>{loading ? "Consultando índice…" : "Buscar por nombre"}</button>{query.trim().length >= 3 && <button className="button button-secondary" type="button" onClick={() => void createWatch()} disabled={watchState === "saving" || watchState === "saved"}><BellRinging size={15} /> {watchState === "saved" ? "Vigilancia activada" : watchState === "saving" ? "Guardando…" : "Vigilar este nombre"}</button>}</div>
      {watchState === "error" && <p className="form-error" role="alert">No se pudo activar la vigilancia.</p>}
    </form>

    {loading && <section className="party-search-loading" aria-live="polite"><span /><span /><span /><p>Revisando identidades, menciones y asuntos relacionados…</p></section>}
    {error && <section className="search-state danger-notice" role="alert"><Warning size={22} /><div><strong>No se pudo completar la consulta.</strong><p>{error}</p></div></section>}
    {!loading && response && <>
      <section className="party-search-summary" aria-live="polite"><div><strong>{response.total}</strong><span>{response.total === 1 ? "asunto localizado" : "asuntos localizados"}</span></div>{response.total > 0 && <div className="party-report-actions"><a className="button button-secondary button-small" href={`/api/reports/search?${reportParams}&detail=simple`}><DownloadSimple size={14} /> Informe simple</a><a className="button button-secondary button-small" href={`/api/reports/search?${reportParams}&detail=rigorous`}><DownloadSimple size={14} /> Informe riguroso</a></div>}</section>
      {!response.results.length ? <section className="panel party-search-empty"><UserFocus size={28} /><h2>No encontramos coincidencias en el índice disponible.</h2><p>Prueba con ambos apellidos, una parte distintiva de la razón social o filtros menos restrictivos. La ausencia de resultados no acredita que no existan otros asuntos.</p>{Boolean(response.coverage?.length) && <div className="party-empty-coverage"><strong>Fechas presentes en el índice</strong><small>La cobertura es incremental y puede contener periodos intermedios aún no incorporados.</small>{response.coverage?.map((item) => <span key={item.provider}>{item.provider === "jalisco-cjj" ? "Poder Judicial de Jalisco" : item.provider === "jalisco-stj-chambers" ? "Supremo Tribunal de Justicia de Jalisco" : "Poder Judicial de la Federación"}: {item.earliestIndexedDate && item.latestIndexedDate ? `${humanDate(item.earliestIndexedDate)} a ${humanDate(item.latestIndexedDate)}` : "sin publicaciones fechadas"} · {item.casesIndexed} asuntos</span>)}</div>}</section> : <div className="party-search-results">{response.results.map((result) => <article className="party-result-card" key={result.caseId}>
        <header><div><span className={`party-match-kind ${result.matchKind === "RELATED" ? "is-related" : ""}`}>{matchLabel(result)}</span><h2>{result.matchName}</h2><p>{roleLabels[result.matchRole] ?? result.matchRole} · {result.partyType === "COMPANY" ? "Persona moral" : result.partyType === "PERSON" ? "Persona física" : result.partyType === "AUTHORITY" ? "Autoridad" : "Tipo no determinado"}</p></div></header>
        <div className="party-result-case"><div><small>EXPEDIENTE</small><strong>{result.number}</strong><span>{result.caseType}</span></div><div><small>ÓRGANO JURISDICCIONAL</small><strong>{result.courtName}</strong><span>{result.jurisdiction === "JALISCO" ? "Poder Judicial de Jalisco" : "Poder Judicial de la Federación"}</span></div><div><small>PUBLICACIONES</small><strong>{result.publicationCount}</strong><span>Última: {humanDate(result.lastPublicationDate)}</span></div></div>
        {result.matchKind === "RELATED" && <p className="party-related-note"><ShieldCheck size={16} /> El nombre fue publicado en el expediente de origen y este asunto se muestra por una relación procesal verificada. No se afirma que la Sala haya publicado directamente el nombre.</p>}
        <footer><div><Buildings size={15} /><span>{result.matter ?? "Materia no especificada"}</span></div><Link className="button button-primary button-small" href={`/search/names/${result.caseId}`}>Ver expediente y evidencia <ArrowRight size={14} /></Link></footer>
      </article>)}</div>}
      {response.total > response.pageSize && <nav className="party-pagination" aria-label="Paginación de resultados"><button className="button button-secondary button-small" disabled={response.page === 1 || loading} onClick={() => void runSearch(response.page - 1)}>Anterior</button><span>Página {response.page} de {Math.ceil(response.total / response.pageSize)}</span><button className="button button-secondary button-small" disabled={response.page * response.pageSize >= response.total || loading} onClick={() => void runSearch(response.page + 1)}>Siguiente</button></nav>}
    </>}
  </div>;
}
