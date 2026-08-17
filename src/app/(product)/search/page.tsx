import Link from "next/link";
import { ArrowSquareOut, Buildings, CheckCircle, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { SearchableSelect } from "@/components/searchable-select";
import { JaliscoProvider, type JaliscoCaseSearchResult, type JaliscoCourtCatalogItem } from "@/lib/providers/jalisco/provider";

export const dynamic = "force-dynamic";

type SearchParams = { court?: string; expediente?: string; q?: string };

function humanDate(value?: string) {
  if (!value) return "No publicada";
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function firstParty(result: JaliscoCaseSearchResult, side: "plaintiff" | "defendant") {
  return result.records.find((record) => record.parties?.[side])?.parties?.[side] ?? "No publicada por el órgano";
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const isExample = !params.court && !params.expediente && !params.q;
  const selectedCourt = params.court ?? "C01";
  const expediente = (params.expediente ?? params.q ?? (isExample ? "11/2026" : "")).trim();
  const provider = new JaliscoProvider();
  let courts: JaliscoCourtCatalogItem[] = [];
  let result: JaliscoCaseSearchResult | null = null;
  let error: string | null = null;

  try {
    courts = await provider.fetchCatalogs();
    if (expediente) result = await provider.searchCase(expediente, selectedCourt);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "No fue posible consultar el boletín oficial.";
  }

  const selected = courts.find((court) => court.externalId === selectedCourt);
  const caseType = result?.records.find((record) => record.caseType)?.caseType;

  return (
    <div className="content search-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Consulta directa al CJ Jalisco</p>
          <h1>Buscador de expedientes</h1>
          <p>Consulta el historial oficial por número de expediente y órgano jurisdiccional.</p>
        </div>
        <Link className="button button-secondary" href="/courts"><Buildings size={16} /> Ver todos los órganos</Link>
      </div>

      <form className="case-search-form panel" action="/search">
        <div className="field">
          <label htmlFor="expediente">Número de expediente</label>
          <div className="search-input-wrap"><MagnifyingGlass size={18} /><input id="expediente" name="expediente" defaultValue={expediente} placeholder="Ej. 11/2026 o 335/2005-D-S-A" required /></div>
        </div>
        <SearchableSelect
          name="court"
          label="Órgano jurisdiccional"
          options={courts.map((court) => ({
            value: court.externalId,
            label: court.name,
            group: court.matter ?? "Otra materia",
            description: `${court.group} · Clave ${court.externalId}`,
            keywords: court.address,
          }))}
          defaultValue={selectedCourt}
          required
          searchPlaceholder="Buscar por nombre, materia, municipio o clave…"
        />
        <button className="button button-primary" type="submit">Consultar expediente</button>
      </form>

      <div className="source-assurance">
        <CheckCircle size={16} weight="fill" />
        <span><strong>{courts.length || "—"} órganos consultables.</strong> Resultado obtenido del boletín oficial; no es una base de datos de demostración.</span>
        <a href="https://cjj.gob.mx/bulletin" target="_blank" rel="noreferrer">Abrir fuente <ArrowSquareOut size={13} /></a>
      </div>

      {error && <section className="search-state danger-notice"><strong>No se pudo completar la consulta.</strong><p>{error}</p><p>El portal oficial puede estar temporalmente indisponible. No mostramos datos simulados como reemplazo.</p></section>}

      {!error && result && result.records.length === 0 && <section className="search-state panel"><span className="search-state-number">0</span><div><h2>Sin coincidencias en el boletín</h2><p>El portal oficial respondió sin registros para <strong>{result.caseNumber}</strong> en <strong>{result.court.name}</strong>. Verifica el órgano y el número exacto.</p></div></section>}

      {!error && result && result.records.length > 0 && <>
        <section className="case-result-header">
          <div>
            {isExample && <span className="tag tag-new">Consulta real de ejemplo</span>}
            <p className="result-kicker">{caseType ?? selected?.matter ?? "Asunto judicial"}</p>
            <h2>{result.caseNumber}</h2>
            <p>{result.court.name}</p>
          </div>
          <dl>
            <div><dt>Movimientos</dt><dd>{result.records.length}</dd></div>
            <div><dt>Materia</dt><dd>{result.court.matter ?? "No clasificada"}</dd></div>
            <div><dt>Consultado</dt><dd>{new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(result.retrievedAt))}</dd></div>
          </dl>
        </section>

        <section className="party-grid">
          <div><span>Parte actora / interesada</span><strong>{firstParty(result, "plaintiff")}</strong></div>
          <div><span>Parte demandada</span><strong>{firstParty(result, "defendant")}</strong></div>
        </section>

        <section className="history-panel panel">
          <header className="panel-header"><div><h2>Historial de acuerdos</h2><p>{result.records.length} publicaciones ordenadas de la más reciente a la más antigua.</p></div></header>
          <div className="history-table-wrap">
            <table className="history-table">
              <thead><tr><th>Fecha de acuerdo</th><th>Fecha de promoción</th><th>Extracto de acuerdo</th></tr></thead>
              <tbody>{result.records.map((record) => <tr key={record.externalId}><td><time dateTime={record.agreementDate}>{humanDate(record.agreementDate)}</time></td><td><time dateTime={record.promotionDate}>{humanDate(record.promotionDate)}</time></td><td><p>{record.officialText}</p>{record.caseType && record.caseType !== caseType && <small>{record.caseType}</small>}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      </>}
    </div>
  );
}
