import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowSquareOut, ArrowsClockwise, Bell, DownloadSimple, Fingerprint, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { SourceAutoRefresh } from "@/components/source-auto-refresh";
import { getSession } from "@/lib/security/session";
import { getMonitoredCase, listFolders, type MovementRecord, type StjCaseRecord } from "@/lib/product/repository";
import { inferFederalCourtType, isFederalSessionCourt } from "@/lib/providers/federal/provider";
import { CaseDeleteButton } from "@/components/case-delete-button";
import { CaseFolderButton } from "@/components/case-folder-picker";
import { CasePartiesEditor } from "@/components/case-parties-editor";
import { formatGuadalajaraDateTime } from "@/lib/product/query";
import { selectCurrentSessionMovements, verifiedNotebookLabel } from "@/lib/product/judicial-display";

export const dynamic = "force-dynamic";

function date(value?: string) {
  if (!value) return "No publicada";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function sourceStatusLabel(status: string) {
  if (status === "VERIFIED") return "Fuente verificada";
  if (status === "CHECKING") return "Revisión en segundo plano";
  if (status === "PENDING") return "Verificando fuente";
  if (status === "DEGRADED") return "Revisión parcial";
  if (status === "FAILED") return "Fuente temporalmente no disponible";
  return "Estado de fuente pendiente";
}

function stjSentenceLabel(state: StjCaseRecord["sentenceState"]) {
  if (state === "AVAILABLE") return "Sentencia disponible";
  if (state === "PARTIAL") return "Documentos oficiales disponibles";
  if (state === "PENDING_PUBLICATION") return "Posible sentencia · publicación pendiente";
  if (state === "NOT_FOUND") return "Aún no publicada";
  if (state === "UNAVAILABLE") return "Consulta oficial protegida";
  if (state === "ERROR") return "Revisión pendiente";
  return "Sin indicio de sentencia definitiva";
}

function Trace({ movement }: { movement: MovementRecord }) {
  return <details className="trace-details"><summary>Ver trazabilidad técnica</summary><dl><div><dt>Recuperado</dt><dd>{formatGuadalajaraDateTime(movement.retrievedAt, { dateStyle: "medium", timeStyle: "short" })} · Guadalajara</dd></div><div><dt>Huella SHA-256</dt><dd><code>{movement.snapshotHash}</code></dd></div></dl></details>;
}

function AgreementTimeline({ movements, federal, localJalisco, checking }: { movements: MovementRecord[]; federal: boolean; localJalisco: boolean; checking: boolean }) {
  if (!movements.length) return <div className="empty-panel"><p>{checking ? "Estamos recuperando el historial oficial de este expediente." : "No encontramos autos o acuerdos para este expediente."}</p><small>{checking ? "La consulta directa ya está en curso; los resultados aparecerán sin esperar al rastreo de sesiones." : "La fuente oficial fue consultada sin una coincidencia almacenada para este órgano, tipo y número."}</small></div>;
  return <div className="timeline">{movements.map((movement) => {
    const notebook = verifiedNotebookLabel(movement.notebook, movement.officialText);
    return <article className="timeline-item" key={movement.id}>
    <time className="timeline-date">Publicado {date(movement.publicationDate)}</time>
    <div className="timeline-content">
      <h3>Resolución publicada</h3>
      {federal && notebook && <span className="notebook-label">{notebook}</span>}
      <div className="movement-dates"><span><small>{localJalisco ? "Fecha de acuerdo" : "Fecha del auto"}</small>{date(movement.agreementDate)}</span>{localJalisco && <span><small>Fecha de publicación</small>{date(movement.publicationDate)}</span>}</div>
      <div className="official-block"><span className="official-label">Extracto de la publicación oficial</span><p>{movement.officialText}</p>{federal && <a href={movement.sourceUrl} target="_blank" rel="noreferrer">Abrir síntesis oficial completa <ArrowSquareOut size={12} /></a>}</div>
      <Trace movement={movement} />
    </div>
  </article>})}</div>;
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
  const [detail, folders] = await Promise.all([getMonitoredCase(session.organizationId, id), listFolders(session.organizationId)]);
  if (!detail) notFound();
  const item = detail.case;
  const federal = item.jurisdiction === "FEDERAL";
  const stj = item.provider === "jalisco-stj-chambers";
  const silentStjDocumentStatus = stj && /recaptcha|sentencia|documento|\bpdf\b/i.test(item.sourceMessage ?? "");
  const displayedSourceStatus = silentStjDocumentStatus ? "VERIFIED" : item.sourceStatus;
  const checking = displayedSourceStatus === "CHECKING" || displayedSourceStatus === "PENDING";
  const agreements = detail.movements.filter((movement) => movement.publicationKind === "AGREEMENT");
  const sessions = selectCurrentSessionMovements(detail.movements.filter((movement) => movement.publicationKind !== "AGREEMENT"));
  const tracksSessions = federal && isFederalSessionCourt(item.courtType ?? inferFederalCourtType(item.courtName));
  const latestListed = sessions.find((movement) => movement.publicationKind === "SESSION_LISTED");
  const latestResult = sessions.find((movement) => movement.publicationKind === "SESSION_RESULT");

  return <div className="content">
    <div className="page-heading"><div><p><Link href="/cases">Expedientes</Link> / {item.number}</p></div><div className="heading-actions"><CaseFolderButton caseId={id} caseNumber={item.number} folders={folders} currentFolderIds={item.folderIds} /><Link className="button button-secondary" href={`/cases/${id}?refresh=1`}><ArrowsClockwise size={15} /> Actualizar ahora</Link><CaseDeleteButton caseId={id} caseNumber={item.number} /></div></div>
    {query.created && <div className="notice" style={{ marginBottom: 20 }}><strong>Asunto guardado y listo para usarse.</strong> Primero recuperamos sus acuerdos; la revisión de sesiones continúa aparte cuando corresponde.</div>}
    <SourceAutoRefresh caseId={id} force={query.refresh === "1"} />
    {displayedSourceStatus === "FAILED" && item.sourceMessage && <div className="notice danger-notice" style={{ marginBottom: 20 }}><strong>Fuente temporalmente no verificada.</strong> {item.sourceMessage}. Conservamos el histórico y no afirmamos que no existan movimientos.</div>}
    {displayedSourceStatus === "DEGRADED" && item.sourceMessage && <div className="notice" style={{ marginBottom: 20 }}><strong>Revisión parcial.</strong> {item.sourceMessage}. Conservamos los datos confirmados y volveremos a consultar la fuente.</div>}
    <section className="case-header"><div><span className="result-kicker">{federal ? "FEDERAL · ACUERDOS OFICIALES" : stj ? "STJ JALISCO · ACUERDOS DE SALA" : "JALISCO · BOLETÍN JUDICIAL"}</span><h1>{item.number} {item.newCount > 0 && <span className="tag tag-new">{item.newCount} nuevo hoy</span>}</h1><p>{item.courtName}</p><div className="case-meta"><span>Tipo: {item.caseType}</span>{item.circuitName && <span>{item.circuitName}</span>}<span>Carpetas: {item.folderNames.join(" · ") || "General"}</span><span>{tracksSessions ? "Acuerdos + vigilancia de sesión" : federal ? "Vigilancia de acuerdos" : stj ? "Acuerdos de Sala" : "Historial del boletín"}</span></div></div><div><span className={`status ${displayedSourceStatus === "VERIFIED" ? "status-online" : displayedSourceStatus === "FAILED" ? "status-failed" : "status-degraded"}`}>{sourceStatusLabel(displayedSourceStatus)}</span></div></section>
    {federal ? <CasePartiesEditor caseId={id} plaintiff={item.plaintiff} defendant={item.defendant} manualPlaintiff={item.manualPlaintiff} manualDefendant={item.manualDefendant} officialPartiesAvailable={item.officialPartiesAvailable} /> : (item.plaintiff || item.defendant) && <section className="party-grid case-party-grid"><div><span>Parte actora / quejosa</span><strong>{item.plaintiff ?? "No publicada por el órgano"}</strong></div><div><span>Parte demandada / tercero / autoridad</span><strong>{item.defendant ?? "No publicada por el órgano"}</strong></div></section>}
    {tracksSessions && <section className="session-summary"><header><span>Seguimiento de sesión</span><strong>{latestResult ? "Sesionado" : latestListed ? "Listado" : "Sin listado"}</strong></header><div><article><small>Fecha en que se listó</small><p>{latestListed ? date(latestListed.publicationDate) : "No se ha listado a sesión"}</p></article><article><small>Fecha programada de sesión</small><p>{date(latestResult?.sessionDate ?? latestListed?.sessionDate)}</p></article><article><small>Sentido y resultado</small><p>{latestResult ? [latestResult.result, latestResult.judgment].filter(Boolean).join(" · ") || "Resultado aún no publicado" : "Pendiente de sesión"}</p></article></div></section>}
    {stj && detail.stj && detail.stj.documents.length > 0 && <section className="stj-sentence-panel panel">
      <header><div><span className="result-kicker">DOCUMENTOS DE SENTENCIA</span><h2>{stjSentenceLabel(detail.stj.sentenceState)}</h2><small>{detail.stj.documents.length} {detail.stj.documents.length === 1 ? "archivo oficial" : "archivos oficiales"}</small></div><a className="button button-secondary button-small" href={detail.stj.officialSearchUrl} target="_blank" rel="noreferrer">Portal oficial <ArrowSquareOut size={13} /></a></header>
      <div className="stj-sentence-grid"><article><small>Toca de origen</small><strong>{detail.stj.originCaseNumber ?? "No publicado"}</strong></article><article><small>Juzgado de origen</small><strong>{detail.stj.originCourt ?? "No publicado"}</strong></article><article><small>Tipo de apelación</small><strong>{detail.stj.appealType ?? "No publicado"}</strong></article></div>
      <div className="stj-documents">{detail.stj.documents.map((document) => <a key={document.id} href={`/api/documents/${document.id}`} target="_blank" rel="noreferrer"><DownloadSimple size={16} /><span><strong>{document.label}</strong><small>{document.publishedAt ? `${formatGuadalajaraDateTime(document.publishedAt, { dateStyle: "medium", timeStyle: "short" })} · ` : ""}{Math.ceil(document.byteSize / 1024)} KB · integridad {document.sha256.slice(0, 12)}…</small></span></a>)}</div>
    </section>}
    <section className="evidence-strip" aria-label="Trazabilidad de la consulta"><div><ShieldCheck size={19} weight="duotone" /><span><strong>Origen oficial</strong>{federal ? "Ficha SISE y listas públicas del PJF" : stj ? "Consulta de acuerdos del STJ Jalisco" : "Boletín judicial del CJ Jalisco"}</span></div><div><Fingerprint size={19} weight="duotone" /><span><strong>Vinculación verificable</strong>Órgano, tipo y número de expediente</span></div><div><Fingerprint size={19} weight="duotone" /><span><strong>Integridad comprobable</strong>Cada captura conserva fecha y huella SHA-256</span></div></section>
    <div className="case-detail-grid">
      <div className="dashboard-main-stack">
        <section className="panel"><header className="panel-header"><h2>{federal ? "Autos y acuerdos federales" : "Autos y acuerdos publicados"}</h2><span className="muted" style={{ fontSize: 10 }}>{agreements.length} {agreements.length === 1 ? "publicación" : "publicaciones"}</span></header><AgreementTimeline movements={agreements} federal={federal} localJalisco={!federal && !stj} checking={checking} /></section>
        {tracksSessions && <section className="panel session-digest"><header className="panel-header"><div><span className="result-kicker">SEGUIMIENTO COLEGIADO</span><h2>Listados a sesión / sesiones</h2></div><span className="session-count">{sessions.length}</span></header><SessionTimeline movements={sessions} checking={checking} /></section>}
      </div>
      <aside className="side-stack"><section className="panel"><header className="panel-header"><h2>Datos del asunto</h2></header><dl className="info-list"><div className="info-row"><dt>Expediente</dt><dd>{item.number}</dd></div><div className="info-row"><dt>Tipo</dt><dd>{item.caseType}</dd></div><div className="info-row"><dt>Jurisdicción</dt><dd>{federal ? "Federal" : "Jalisco"}</dd></div>{item.circuitName && <div className="info-row"><dt>Circuito</dt><dd>{item.circuitName}</dd></div>}<div className="info-row"><dt>Órgano</dt><dd>{item.courtName}</dd></div><div className="info-row"><dt>Última revisión</dt><dd>{item.lastCheckedAt ? `${formatGuadalajaraDateTime(item.lastCheckedAt, { dateStyle: "medium", timeStyle: "short" })} · Guadalajara` : "Pendiente"}</dd></div></dl></section><section className="panel"><header className="panel-header"><h2>Vigilancia</h2></header><div className="alert-item"><strong><Bell size={15} style={{ display: "inline", marginRight: 6 }} />Avisos in-app</strong><p>Se crea una alerta in-app por cada resolución. El correo se reserva para listados, sesiones y publicaciones que mencionen sentencia.</p></div></section><div className="notice">{federal ? "La información reproduce publicaciones públicas oficiales del PJF y conserva su evidencia. No sustituye una certificación judicial ni el expediente electrónico." : stj ? "Los acuerdos se consultan por Sala y Toca, conservando su fecha, extracto y fuente oficial." : "Se muestran todos los extractos devueltos por la consulta oficial por expediente, con su fecha de recuperación y trazabilidad."}</div></aside>
    </div>
  </div>;
}
