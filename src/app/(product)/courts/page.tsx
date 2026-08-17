import { ArrowSquareOut, CheckCircle, ListMagnifyingGlass, Scales } from "@phosphor-icons/react/dist/ssr";
import { CourtDirectoryExplorer } from "@/components/court-directory-explorer";
import { jaliscoDirectory, jaliscoDirectoryAddendum } from "@/lib/providers/jalisco/directory";
import { JaliscoProvider, type JaliscoCourtCatalogItem } from "@/lib/providers/jalisco/provider";

export const dynamic = "force-dynamic";

export default async function CourtsPage() {
  let courts: JaliscoCourtCatalogItem[] = [];
  let liveError = false;
  try { courts = await new JaliscoProvider().fetchCatalogs(); } catch { liveError = true; }
  const matters = new Set(courts.map((court) => court.matter)).size;
  const families = new Set(courts.map((court) => court.family)).size;

  return <div className="content courts-page">
    <div className="page-heading courts-heading"><div><p className="eyebrow">Mapa judicial de Jalisco</p><h1>Encuentra el órgano correcto.</h1><p>Busca por nombre, materia o ubicación. El catálogo se obtiene directamente de los cinco directorios activos del boletín judicial.</p></div><a className="button button-secondary" href={jaliscoDirectory.sourceUrl} target="_blank" rel="noreferrer">Directorio oficial <ArrowSquareOut size={15} /></a></div>
    <section className="court-facts" aria-label="Cobertura del directorio">
      <article><CheckCircle size={20} weight="duotone" /><div><strong>{courts.length || "—"}</strong><span>órganos consultables</span></div></article>
      <article><Scales size={20} weight="duotone" /><div><strong>{matters || "—"}</strong><span>materias ordenadas</span></div></article>
      <article><ListMagnifyingGlass size={20} weight="duotone" /><div><strong>{families || "—"}</strong><span>familias de consulta</span></div></article>
    </section>
    {liveError ? <div className="notice danger-notice">El catálogo de consulta está temporalmente indisponible. Puedes revisar el <a href={jaliscoDirectory.sourceUrl} target="_blank" rel="noreferrer">directorio oficial</a>.</div> : <CourtDirectoryExplorer courts={courts} />}
    <footer className="directory-provenance"><p>Catálogo conciliado con el directorio del Consejo de la Judicatura y su actualización institucional. Estatus verificado: {jaliscoDirectory.verifiedAt}.</p><div><a href={jaliscoDirectory.sourceUrl} target="_blank" rel="noreferrer">Directorio web <ArrowSquareOut size={12} /></a><a href={jaliscoDirectoryAddendum.sourceUrl} target="_blank" rel="noreferrer">Directorio institucional 2026 <ArrowSquareOut size={12} /></a></div></footer>
  </div>;
}
