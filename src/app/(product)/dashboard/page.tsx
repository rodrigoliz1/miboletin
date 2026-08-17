import Link from "next/link";
import { ArrowRight, CaretRight } from "@phosphor-icons/react/dist/ssr";
import { SearchableSelect } from "@/components/searchable-select";
import { SourceAutoRefresh } from "@/components/source-auto-refresh";
import { ExpandablePanel } from "@/components/expandable-panel";
import { getSession } from "@/lib/security/session";
import { dashboardData, listFolders, listOrganizationMovements, type OrganizationMovementRecord } from "@/lib/product/repository";
import { dateInMexicoCity, monthStartInMexicoCity, normalizeDateRange, optionalUuid } from "@/lib/product/query";

export const dynamic = "force-dynamic";

function Movement({ movement, session = false }: { movement: OrganizationMovementRecord; session?: boolean }) {
  return <article className={`movement${session ? " session-movement" : ""}`}>
    <time className="movement-date"><strong>{movement.publication_date.slice(8, 10)}</strong>{movement.publication_date.slice(5, 7)}/{movement.publication_date.slice(0, 4)}</time>
    <div className="movement-main">
      <h3><Link href={`/cases/${movement.monitored_case_id}`}>{movement.case_number}</Link>{movement.publication_kind === "SESSION_LISTED" && <span className="tag tag-new">Listado</span>}{movement.publication_kind === "SESSION_RESULT" && <span className="tag tag-new">Sesionado</span>}</h3>
      {session && movement.session_date && <small className="session-highlight">Sesión: {movement.session_date}</small>}
      {session && movement.result && <p><strong>Sentido:</strong> {movement.result}</p>}
      {session && movement.judgment && <p><strong>Sentencia:</strong> {movement.judgment}</p>}
      <p>{movement.official_text}</p>
      <small>{movement.court_name} · {movement.folder_name ?? "General"}</small>
    </div>
    <CaretRight size={16} className="muted" />
  </article>;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; folder?: string; subscription?: string }> }) {
  const params = await searchParams;
  const session = await getSession();
  if (!session) return null;
  const { from, to, corrected } = normalizeDateRange(params);
  const folderId = optionalUuid(params.folder);
  const [data, folders, movements] = await Promise.all([
    dashboardData(session.organizationId, session.userId, from, to),
    listFolders(session.organizationId),
    listOrganizationMovements(session.organizationId, from, to, folderId ?? undefined),
  ]);
  const agreements = movements.filter((movement) => movement.publication_kind === "AGREEMENT");
  const sessionKeys = new Set<string>();
  const sessions = movements.filter((movement) => {
    if (movement.publication_kind === "AGREEMENT") return false;
    const key = [movement.monitored_case_id, movement.publication_kind, movement.publication_date, movement.session_date].join("|");
    if (sessionKeys.has(key)) return false;
    sessionKeys.add(key);
    return true;
  });
  const now = new Date();

  return <div className="content">
    <div className="page-heading"><div><h1>Hola, {session.name.split(" ")[0]}.</h1><p>Información actualizada al abrir esta vista: {new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeStyle: "short" }).format(now)}.</p></div><div className="heading-actions"><Link className="button button-secondary" href="/search">Consulta puntual</Link><Link className="button button-primary" href="/cases/new">Agregar asunto</Link></div></div>
    <SourceAutoRefresh />
    {params.subscription === "active" && <div className="notice success-notice" role="status"><strong>Suscripción activada.</strong> Tu pago quedó vinculado a esta cuenta y el espacio ya está disponible.</div>}
    {corrected && <div className="notice" role="status"><strong>Periodo ajustado.</strong> Se corrigieron fechas vacías, inválidas o invertidas antes de consultar.</div>}
    <section className="metrics"><div className="metric"><span className="metric-label">Expedientes vigilados</span><span className="metric-value">{data.counts.cases}</span></div><div className="metric"><span className="metric-label">Movimientos en el periodo</span><span className="metric-value">{movements.length}</span></div><div className="metric"><span className="metric-label">Alertas sin leer</span><span className="metric-value">{data.counts.unread}</span></div><div className="metric"><span className="metric-label">Fuentes</span><span className="metric-value">2</span><span className="metric-note">Jalisco + Federal</span></div></section>
    <form className="period-filter panel" action="/dashboard"><div className="field"><label htmlFor="from">Desde</label><input id="from" type="date" name="from" defaultValue={from} /></div><div className="field"><label htmlFor="to">Hasta</label><input id="to" type="date" name="to" defaultValue={to} /></div><SearchableSelect name="folder" label="Carpeta" options={[{ value: "", label: "Todas las carpetas", group: "Vista general", description: `${data.counts.cases} asuntos vigilados` }, ...folders.map((folder) => ({ value: folder.id, label: folder.name, group: "Carpetas del despacho", description: `${folder.caseCount} ${folder.caseCount === 1 ? "asunto" : "asuntos"}` }))]} defaultValue={folderId ?? ""} searchPlaceholder="Buscar carpeta…" /><button className="button button-primary" type="submit">Aplicar periodo</button><Link className="button button-ghost" href={`/dashboard?from=${monthStartInMexicoCity()}&to=${dateInMexicoCity()}`}>Este mes</Link></form>
    <div className="dashboard-grid">
      <div className="dashboard-main-stack">
        <ExpandablePanel label="Autos y acuerdos" header={<><h2>Autos y acuerdos</h2><span className="muted panel-range">{from} — {to}</span></>}>{!agreements.length ? <div className="empty-panel"><p>No hay autos o acuerdos verificados en este periodo.</p><small>Esto sólo significa “sin publicaciones vinculadas” cuando la fuente del expediente aparece verificada.</small></div> : agreements.map((movement) => <Movement key={movement.id} movement={movement} />)}</ExpandablePanel>
        <ExpandablePanel label="Listados a sesión y sesiones" className="session-digest" header={<><div><span className="result-kicker">AGENDA FEDERAL</span><h2>Listados a sesión / sesiones</h2></div><span className="session-count">{sessions.length}</span></>}>{!sessions.length ? <div className="empty-panel compact-empty"><p>Sin listados o resultados de sesión en este periodo.</p><small>Este recuadro se actualiza para los asuntos de órganos colegiados.</small></div> : sessions.map((movement) => <Movement key={movement.id} movement={movement} session />)}</ExpandablePanel>
      </div>
      <aside className="side-stack"><section className="panel"><header className="panel-header"><h2>Carpetas</h2><Link href="/cases">Gestionar</Link></header>{folders.map((folder) => <Link className="source-row" key={folder.id} href={`/dashboard?from=${from}&to=${to}&folder=${folder.id}`}><div><strong>{folder.name}</strong><small>{folder.caseCount} asuntos · {folder.newCount} alertas</small></div><CaretRight size={14} /></Link>)}</section><Link className="button button-dark" href="/cases/new">Vigilar otro asunto <ArrowRight size={14} /></Link></aside>
    </div>
  </div>;
}
