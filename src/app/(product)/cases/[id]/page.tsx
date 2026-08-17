import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowSquareOut, ArrowsClockwise, Bell, Fingerprint, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { SourceAutoRefresh } from "@/components/source-auto-refresh";
import { getSession } from "@/lib/security/session";
import { getMonitoredCase, type MovementRecord } from "@/lib/product/repository";
import { inferFederalCourtType, isFederalSessionCourt } from "@/lib/providers/federal/provider";
import { CaseDeleteButton } from "@/components/case-delete-button";
import { formatGuadalajaraDateTime } from "@/lib/product/query";

export const dynamic = "force-dynamic";

function date(value?: string) {
  if (!value) return "No publicada";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function Trace({ movement }: { movement: MovementRecord }) {
  return <details className="trace-details"><summary>Ver trazabilidad técnica</summary><dl><div><dt>Recuperado</dt><dd>{formatGuadalajaraDateTime(movement.retrievedAt, { dateStyle: "medium", timeStyle: "short" })} · Guadalajara</dd></div><div><dt>Huella SHA-256</dt><dd><code>{movement.snapshotHash}</code></dd></div></dl></details>;
}

function AgreementTimeline({ movements, federal, checking }: { movements: MovementRecord[]; federal: boolean; checking: boolean }) {
  if (!movements.length) return <div className="empty-panel"><p>{checking ? "Estamos recuperando el historial oficial de este expediente." : "No encontramos autos o acuerdos para este expediente."}</p><small>{checking ? "La consulta directa ya está en curso; los resultados aparecerán sin esperar al rastreo de sesiones." : "La fuente oficial fue consultada sin una coincidencia almacenada para este órgano, tipo y número."}</small></div>;
  return <div className="timeline">{movements.map((movement) => <article className="timeline-item" key={movement.id}>
    <time className="timeline-date">Publicado {date(movement.publicationDate)}</time>
    <div className="timeline-content">
      <h3>Resolución publicada</h3>
      {federal && movement.notebook && <span className="notebook-label">{movement.notebook}</span>}
      <div className="movement-dates"><span><small>Fecha del auto</small>{date(movement.agreementDate)}</span>{!federal && <span><small>Fecha de promoción</small>{date(movement.promotionDate)}</span>}</div>
      <div className="official-block"><span className="official-label">Extracto de la publicación oficial</span><p>{movement.officialText}</p>{federal && <a href={movement.sourceUrl} target="_blank" rel="noreferrer">Abrir síntesis oficial completa <ArrowSquareOut size={12} /></a>}</div>
      <Trace movement={movement} />
    </div>
  </article>)}</div>;
}

function SessionTimeline({ movements, checking }: { movements: MovementRecord[]; checking: boolean }) {
  if (!movements.length) return <div className="session-empty-state"><span>No se ha listado a sesión.</span><small>{checking ? "Estamos revisando los calendarios y listas oficiales." : "Cuando ocurra, aquí aparecerán la fecha del listado, la sesión programada y el resultado publicado."}</small></div>;
  return <div className="timeline compact-timeline">{movements.map((movement) => <article className="timeline-item" key={movement.id}>
    <time className="timeline-date">{date(movement.publicationDate)}</time>
    <div className="timeline-content">
      <h3>{movement.publicationKind === "SESSION_RESULT" ? "Sesión celebrada / resultado" : "Listado para sesión"} <span className="tag tag-new">{movement.publicationKind === "SESSION_RESULT" ? "Sesionado" : "Listado"}</span></h3>
      {movement.sessionDate && <p><strong>Fecha de sesión:</strong> {date(movement.sessionDate)}</p>}
      {movement.result && <p><strong>Sentido o resultado:</strong> {movement.result}</p>}
      {movement.judgment && <p><strong>Sentido de la sentencia:</strong> {movement.judgment}</p>}
      {movement.rapporteur && <p><strong>Ponencia:</strong> {movement.rapporteur}</p>}
      <p className="movement-classification">{movement.filterKind === "sesion" ? "Resultado publicado" : "Lista previa"} · {movement.sessionType === "EXTRAORDINARY" ? "Sesión extraordinaria" : "Sesión ordinaria"}</p>
      <div className="official-block"><span className="official-label">Registro oficial</span><p>{movement.officialText}</p><a href={movement.sourceUrl} target="_blank" rel="noreferrer">Contrastar en la fuente oficial <ArrowSquareOut size={12} /></a></div>
      <Trace movement={movement} />
    </div>
  </article>)}</div>;
}

export default async function CaseDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; refresh?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  const session = await getSession();
  if (!session) return null;
  const detail = await getMonitoredCase(session.organizationId, id);
  if (!detail) notFound();
  const item = detail.case;
  const federal = item.jurisdiction === "FEDERAL";
  const checking = item.sourceStatus === "CHECKING" || item.sourceStatus === "PENDING";
  const agreements = detail.movements.filter((movement) => movement.publicationKind === "AGREEMENT");
  const sessionKeys = new Set<string>();
  const sessions = detail.movements.filter((movement) => {
    if (movement.publicationKind === "AGREEMENT") return false;
    const key = [movement.publicationKind, movement.publicationDate, movement.sessionDate].join("|");
    if (sessionKeys.has(key)) return false;
    sessionKeys.add(key);
    return true;
  });
  const tracksSessions = federal && isFederalSessionCourt(item.courtType ?? inferFederalCourtType(item.courtName));
  const latestListed = sessions.find((movement) => movement.publicationKind === "SESSION_LISTED");
  const latestResult = sessions.find((movement) => movement.publicationKind === "SESSION_RESULT");

  return <div className="content">
    <div className="page-heading"><div><p><Link href="/cases">Expedientes</Link> / {item.number}</p></div><div className="heading-actions"><Link className="button button-secondary" href={`/cases/${id}?refresh=1`}><ArrowsClockwise size={15} /> Actualizar ahora</Link><CaseDeleteButton caseId={id} caseNumber={item.number} /></div></div>
    {query.created && <div className="notice" style={{ marginBottom: 20 }}><strong>Asunto guardado y listo para usarse.</strong> Primero recuperamos sus acuerdos; la revisión de sesiones continúa aparte cuando corresponde.</div>}
    <SourceAutoRefresh caseId={id} force={query.refresh === "1"} />
    {item.sourceStatus === "FAILED" && item.sourceMessage && <div className="notice danger-notice" style={{ marginBottom: 20 }}><strong>Fuente temporalmente no verificada.</strong> {item.sourceMessage}. Conservamos el histórico y no afirmamos que no existan movimientos.</div>}
    <section className="case-header"><div><span className="result-kicker">{federal ? "FEDERAL · ACUERDOS OFICIALES" : "JALISCO · BOLETÍN JUDICIAL"}</span><h1>{item.number} {item.newCount > 0 && <span className="tag tag-new">{item.newCount} nuevo hoy</span>}</h1><p>{item.courtName}</p><div className="case-meta"><span>Tipo: {item.caseType}</span>{item.circuitName && <span>{item.circuitName}</span>}<span>Carpetas: {item.folderNames.join(" · ") || "General"}</span><span>{tracksSessions ? "Acuerdos + vigilancia de sesión" : federal ? "Vigilancia de acuerdos" : "Historial del boletín"}</span></div></div><div><span className={`status ${item.sourceStatus === "VERIFIED" ? "status-online" : item.sourceStatus === "FAILED" ? "status-failed" : "status-degraded"}`}>{item.sourceStatus === "VERIFIED" ? "Fuente verificada" : item.sourceStatus === "CHECKING" ? "Revisión en segundo plano" : item.sourceStatus === "PENDING" ? "Verificando fuente" : item.sourceStatus}</span></div></section>
    {(item.plaintiff || item.defendant) && <section className="party-grid case-party-grid"><div><span>Parte actora / quejosa</span><strong>{item.plaintiff ?? "No publicada por el órgano"}</strong></div><div><span>Parte demandada / tercero / autoridad</span><strong>{item.defendant ?? "No publicada por el órgano"}</strong></div></section>}
    {tracksSessions && <section className="session-summary"><header><span>Seguimiento de sesión</span><strong>{latestResult ? "Sesionado" : latestListed ? "Listado" : "Sin listado"}</strong></header><div><article><small>Fecha en que se listó</small><p>{latestListed ? date(latestListed.publicationDate) : "No se ha listado a sesión"}</p></article><article><small>Fecha programada de sesión</small><p>{date(latestResult?.sessionDate ?? latestListed?.sessionDate)}</p></article><article><small>Sentido y resultado</small><p>{latestResult ? [latestResult.result, latestResult.judgment].filter(Boolean).join(" · ") || "Resultado aún no publicado" : "Pendiente de sesión"}</p></article></div></section>}
    <section className="evidence-strip" aria-label="Trazabilidad de la consulta"><div><ShieldCheck size={19} weight="duotone" /><span><strong>Origen oficial</strong>{federal ? "Ficha SISE y listas públicas del PJF" : "Boletín judicial del CJ Jalisco"}</span></div><div><Fingerprint size={19} weight="duotone" /><span><strong>Vinculación verificable</strong>Órgano, tipo y número de expediente</span></div><div><Fingerprint size={19} weight="duotone" /><span><strong>Integridad comprobable</strong>Cada captura conserva fecha y huella SHA-256</span></div></section>
    <div className="case-detail-grid">
      <div className="dashboard-main-stack">
        <section className="panel"><header className="panel-header"><h2>{federal ? "Autos y acuerdos federales" : "Autos y acuerdos publicados"}</h2><span className="muted" style={{ fontSize: 10 }}>{agreements.length} {agreements.length === 1 ? "publicación" : "publicaciones"}</span></header><AgreementTimeline movements={agreements} federal={federal} checking={checking} /></section>
        {tracksSessions && <section className="panel session-digest"><header className="panel-header"><div><span className="result-kicker">SEGUIMIENTO COLEGIADO</span><h2>Listados a sesión / sesiones</h2></div><span className="session-count">{sessions.length}</span></header><SessionTimeline movements={sessions} checking={checking} /></section>}
      </div>
      <aside className="side-stack"><section className="panel"><header className="panel-header"><h2>Datos del asunto</h2></header><dl className="info-list"><div className="info-row"><dt>Expediente</dt><dd>{item.number}</dd></div><div className="info-row"><dt>Tipo</dt><dd>{item.caseType}</dd></div><div className="info-row"><dt>Jurisdicción</dt><dd>{federal ? "Federal" : "Jalisco"}</dd></div>{item.circuitName && <div className="info-row"><dt>Circuito</dt><dd>{item.circuitName}</dd></div>}<div className="info-row"><dt>Órgano</dt><dd>{item.courtName}</dd></div><div className="info-row"><dt>Última revisión</dt><dd>{item.lastCheckedAt ? `${formatGuadalajaraDateTime(item.lastCheckedAt, { dateStyle: "medium", timeStyle: "short" })} · Guadalajara` : "Pendiente"}</dd></div></dl></section><section className="panel"><header className="panel-header"><h2>Vigilancia</h2></header><div className="alert-item"><strong><Bell size={15} style={{ display: "inline", marginRight: 6 }} />Avisos in-app</strong><p>Se crea una alerta por cada nuevo acuerdo y, en órganos colegiados, al listarse y al publicarse el resultado de sesión.</p></div></section><div className="notice">{federal ? "La información reproduce publicaciones públicas oficiales del PJF y conserva su evidencia. No sustituye una certificación judicial ni el expediente electrónico." : "Se muestran todos los extractos devueltos por la consulta oficial por expediente, con su fecha de recuperación y trazabilidad."}</div></aside>
    </div>
  </div>;
}
