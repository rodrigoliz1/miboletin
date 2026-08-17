import Link from "next/link";
import { ArrowUpRight, FolderPlus } from "@phosphor-icons/react/dist/ssr";
import { SearchableSelect } from "@/components/searchable-select";
import { getSession } from "@/lib/security/session";
import { listFolders, listMonitoredCases } from "@/lib/product/repository";
import { optionalUuid } from "@/lib/product/query";

export const dynamic = "force-dynamic";

function formatDate(value?: string) {
  if (!value) return "Aún sin publicaciones";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ folder?: string; q?: string; jurisdiction?: string; error?: string; removed?: string }> }) {
  const params = await searchParams;
  const session = await getSession();
  if (!session) return null;
  const folderId = optionalUuid(params.folder);
  const [folders, records] = await Promise.all([listFolders(session.organizationId), listMonitoredCases(session.organizationId, folderId ?? undefined)]);
  const q = (params.q ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const cases = records.filter((item) => (!params.jurisdiction || item.jurisdiction === params.jurisdiction) && (!q || `${item.number} ${item.courtName} ${item.label ?? ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(q)));
  const selectedFolder = folders.find((folder) => folder.id === folderId);

  return <div className="content">
    <div className="page-heading"><div><h1>{selectedFolder?.name ?? "Expedientes vigilados"}</h1><p>{cases.length} {cases.length === 1 ? "asunto activo" : "asuntos activos"} con datos persistidos.</p></div><div className="heading-actions"><Link className="button button-primary" href="/cases/new">Agregar asunto</Link></div></div>
    {params.removed === "1" && <div className="notice success-notice" role="status"><strong>Asunto eliminado.</strong> Ya no se vigila ni aparece en tus carpetas.</div>}
    {params.error && <p className="form-error">No fue posible crear la carpeta. Revisa el nombre o la conexión.</p>}
    <div className="folder-layout">
      <aside className="folder-sidebar panel"><header><h2>Carpetas</h2><span>{folders.length}</span></header><Link data-active={!folderId} href="/cases">Todos los asuntos</Link>{folders.map((folder) => <Link key={folder.id} data-active={folderId === folder.id} href={`/cases?folder=${folder.id}`}><span>{folder.name}</span><small>{folder.caseCount}</small></Link>)}<form action="/api/folders" method="post"><label htmlFor="folderName">Nueva carpeta</label><div><input id="folderName" name="name" placeholder="Nombre de carpeta" required maxLength={80} /><button type="submit" aria-label="Crear carpeta"><FolderPlus size={17} /></button></div></form></aside>
      <section>
        <form className="filters" action="/cases"><input className="filter-control search-wide" name="q" defaultValue={params.q} aria-label="Buscar expedientes" placeholder="Buscar por número, referencia u órgano" />{folderId && <input type="hidden" name="folder" value={folderId} />}<SearchableSelect name="jurisdiction" label="Jurisdicción" options={[{ value: "", label: "Toda jurisdicción", group: "Cobertura" }, { value: "JALISCO", label: "Jalisco", group: "Cobertura", description: "Boletín judicial estatal" }, { value: "FEDERAL", label: "Federal", group: "Cobertura", description: "Listas y sesiones federales" }]} defaultValue={params.jurisdiction ?? ""} compact searchPlaceholder="Buscar jurisdicción…" /><button className="button button-secondary" type="submit">Filtrar</button></form>
        {!cases.length ? <div className="empty-product panel"><h2>Aún no hay asuntos en esta vista.</h2><p>Agrega un expediente real o cambia los filtros. No mostramos expedientes simulados.</p><Link className="button button-primary" href="/cases/new">Agregar primer asunto</Link></div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Expediente</th><th>Órgano jurisdiccional</th><th>Carpetas</th><th>Jurisdicción</th><th>Última publicación</th><th>Fuente</th><th><span className="sr-only">Abrir</span></th></tr></thead><tbody>{cases.map((item) => <tr key={item.id}><td><Link href={`/cases/${item.id}`}><span className="case-number">{item.number}</span>{item.newCount > 0 && <span className="tag tag-new">{item.newCount} nuevo</span>}<small>{item.caseType}</small></Link></td><td className="court-cell">{item.courtName}{item.circuitName && <small>{item.circuitName}</small>}</td><td>{item.folderNames.join(" · ") || "General"}</td><td>{item.jurisdiction === "FEDERAL" ? "Federal" : "Jalisco"}</td><td className="muted">{formatDate(item.lastPublicationDate)}</td><td><span className={`status ${item.sourceStatus === "VERIFIED" ? "status-online" : item.sourceStatus === "FAILED" ? "status-failed" : "status-degraded"}`}>{item.sourceStatus === "VERIFIED" ? "Verificada" : item.sourceStatus === "FAILED" ? "Falló" : item.sourceStatus === "CHECKING" ? "Revisando" : item.sourceStatus === "DEGRADED" ? "Con incidencias" : "Pendiente"}</span></td><td><Link href={`/cases/${item.id}`} aria-label={`Abrir expediente ${item.number}`}><ArrowUpRight size={16} /></Link></td></tr>)}</tbody></table></div>}
      </section>
    </div>
  </div>;
}
