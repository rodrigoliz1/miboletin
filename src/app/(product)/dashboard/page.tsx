import Link from "next/link";
import { ArrowRight, CaretRight } from "@phosphor-icons/react/dist/ssr";
import { SearchableSelect } from "@/components/searchable-select";
import { SourceAutoRefresh } from "@/components/source-auto-refresh";
import { ExpandablePanel } from "@/components/expandable-panel";
import { getSession } from "@/lib/security/session";
import { dashboardData, listFolders, listOrganizationMovements, type OrganizationMovementRecord } from "@/lib/product/repository";
import { dateInMexicoCity, monthStartInMexicoCity, normalizeDateRange, optionalUuid } from "@/lib/product/query";
import { formatGuadalajaraDateTime } from "@/lib/product/query";
import { selectCurrentSessionMovements } from "@/lib/product/judicial-display";

export const dynamic = "force-dynamic";

function Movement({ movement, session = false }: { movement: OrganizationMovementRecord; session?: boolean }) {
  const displayDate = movement.display_date || movement.publication_date;
  return <article className={`movement${session ? " session-movement" : ""}`}>
    <time className="movement-date"><strong>{displayDate.slice(8, 10)}</strong>{displayDate.slice(5, 7)}/{displayDate.slice(0, 4)}</time>
    <div className="movement-main">
      <h3><Link href={`/cases/${movement.monitored_case_id}`}>{movement.case_number}</Link>{movement.publication_kind === "SESSION_LISTED" && <span className="tag tag-new">Listado</span>}{movement.publication_kind === "SESSION_RESULT" && <span className="tag tag-new">Sesionado</span>}{movement.carried_forward && <span className="tag tag-new">Revisión adicional</span>}</h3>
      {session && movement.session_date && <small className="session-highlight">Sesión: {movement.session_date}</small>}
      {session && movement.result && <p><strong>Sentido:</strong> {movement.result}</p>}
      {session && movement.judgment && <p><strong>Sentencia:</strong> {movement.judgment}</p>}
      <p>{movement.official_text}</p>
      {(movement.plaintiff || movement.defendant) && <p className="movement-parties"><strong>Partes:</strong> {[movement.plaintiff, movement.defendant].filter(Boolean).join(" / ")}</p>}
      {movement.carried_forward && <small className="carried-forward-note">Publicación oficial del {movement.publication_date}; se conserva visible hoy porque la fecha del acuerdo coincide con la de publicación.</small>}
      <small>{movement.court_name} · {movement.folder_name ?? "General"}</small>
    </div>
    <CaretRight size={16} className="muted" />
  </article>;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; folder?: string; subscription?: string; verified?: string }> }) {
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
  const localAgreements = agreements.filter((movement) => movement.jurisdiction === "JALISCO");
  const federalAgreements = agreements.filter((movement) => movement.jurisdiction === "FEDERAL");
  const sessionGroups = new Map<string, OrganizationMovementRecord[]>();
  for (const movement of movements) {
    if (movement.publication_kind === "AGREEMENT") continue;
    const group = sessionGroups.get(movement.monitored_case_id) ?? [];
    group.push(movement);
    sessionGroups.set(movement.monitored_case_id, group);
  }
  const sessions = [...sessionGroups.values()].flatMap((group) => selectCurrentSessionMovements(group.map((movement) => ({
    id: movement.id,
    publicationKind: movement.publication_kind,
    publicationDate: movement.publication_date,
    sessionDate: movement.session_date ?? undefined,
    movement,
  }))).map((selected) => selected.movement));
  const now = new Date();
  const today = dateInMexicoCity(now);
  const todayAgreementCount = Number(data.counts.agreements_today ?? 0);
  const reportQuery = new URLSearchParams({ date: today, ...(folderId ? { folder: folderId } : {}) }).toString();

  return <div className="content">
    <div className="page-heading"><div><h1>Hola, {session.name.split(" ")[0]}.</h1><p>Información actualizada al abrir esta vista: {formatGuadalajaraDateTime(now)} · hora de Guadalajara.</p></div><div className="heading-actions"><Link className="button button-secondary" href="/search">Consulta puntual</Link><Link className="button button-primary" href="/cases/new">Agregar asunto</Link></div></div>
    <SourceAutoRefresh />
    {params.verified === "1" && <div className="notice success-notice" role="status"><strong>Correo verificado.</strong> Tu cuenta está lista. Activa la suscripción para comenzar a utilizar el espacio.</div>}
    {params.subscription === "active" && <div className="notice success-notice" role="status"><strong>Suscripción activada.</strong> Tu pago quedó vinculado a esta cuenta y el espacio ya está disponible.</div>}
    {corrected && <div className="notice" role="status"><strong>Periodo ajustado.</strong> Se corrigieron fechas vacías, inválidas o invertidas antes de consultar.</div>}
    <section className="metrics"><div className="metric"><span className="metric-label">Expedientes vigilados</span><span className="metric-value">{data.counts.cases}</span></div><div className="metric metric-emphasis"><span className="metric-label">Resoluciones publicadas el día de hoy</span><span className="metric-value">{todayAgreementCount}</span></div><div className="metric"><span className="metric-label">Movimientos en el periodo</span><span className="metric-value">{movements.length}</span></div><div className="metric"><span className="metric-label">Alertas de hoy</span><span className="metric-value">{data.counts.unread}</span></div></section>
    <form className="period-filter panel" action="/dashboard"><div className="field"><label htmlFor="from">Desde</label><input id="from" type="date" name="from" defaultValue={from} /></div><div className="field"><label htmlFor="to">Hasta</label><input id="to" type="date" name="to" defaultValue={to} /></div><SearchableSelect name="folder" label="Carpeta" options={[{ value: "", label: "Todas las carpetas", group: "Vista general", description: `${data.counts.cases} asuntos vigilados` }, ...folders.map((folder) => ({ value: folder.id, label: folder.name, group: "Carpetas del despacho", description: `${folder.caseCount} ${folder.caseCount === 1 ? "asunto" : "asuntos"}` }))]} defaultValue={folderId ?? ""} searchPlaceholder="Buscar carpeta…" /><button className="button button-primary" type="submit">Aplicar periodo</button><Link className="button button-ghost" href={`/dashboard?from=${monthStartInMexicoCity()}&to=${dateInMexicoCity()}`}>Este mes</Link></form>
    <div className="dashboard-grid">
      <div className="dashboard-main-stack">
        <ExpandablePanel label="Boletín de Resoluciones" header={<><div><h2>Boletín de Resoluciones</h2><span className="muted panel-range">{from} — {to}</span></div><a className="button button-secondary button-small" href={`/api/reports/daily?${reportQuery}`}>Descargar PDF del día</a></>}>{!agreements.length ? <div className="empty-panel"><p>No hay resoluciones verificadas en este periodo.</p><small>Esto sólo significa “sin publicaciones vinculadas” cuando la fuente del expediente aparece verificada.</small></div> : <div className="jurisdiction-publications">{localAgreements.length > 0 && <section><header className="publication-divider"><span>Poder Judicial del Estado de Jalisco</span><strong>{localAgreements.length}</strong></header>{localAgreements.map((movement) => <Movement key={movement.id} movement={movement} />)}</section>}{federalAgreements.length > 0 && <section><header className="publication-divider"><span>Poder Judicial de la Federación</span><strong>{federalAgreements.length}</strong></header>{federalAgreements.map((movement) => <Movement key={movement.id} movement={movement} />)}</section>}</div>}</ExpandablePanel>
        <ExpandablePanel label="Listados a sesión y sesiones" className="session-digest" header={<><div><span className="result-kicker">AGENDA FEDERAL</span><h2>Listados a sesión / sesiones</h2></div><span className="session-count">{sessions.length}</span></>}>{!sessions.length ? <div className="empty-panel compact-empty"><p>Sin listados o resultados de sesión en este periodo.</p><small>Este recuadro se actualiza para los asuntos de órganos colegiados.</small></div> : sessions.map((movement) => <Movement key={movement.id} movement={movement} session />)}</ExpandablePanel>
      </div>
      <aside className="side-stack"><section className="panel"><header className="panel-header"><h2>Carpetas</h2><Link href="/cases">Gestionar</Link></header>{folders.map((folder) => <Link className="source-row" key={folder.id} href={`/dashboard?from=${from}&to=${to}&folder=${folder.id}`}><div><strong>{folder.name}</strong><small>{folder.caseCount} asuntos · {folder.newCount} alertas</small></div><CaretRight size={14} /></Link>)}</section><Link className="button button-dark" href="/cases/new">Vigilar otro asunto <ArrowRight size={14} /></Link></aside>
    </div>
  </div>;
}
