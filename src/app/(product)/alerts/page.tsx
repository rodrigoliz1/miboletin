import Link from "next/link";
import { BellRinging } from "@phosphor-icons/react/dist/ssr";
import { getSession } from "@/lib/security/session";
import { listNotifications } from "@/lib/product/repository";
import { formatGuadalajaraDateTime } from "@/lib/product/query";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const session = await getSession();
  if (!session) return null;
  const notifications = await listNotifications(session.organizationId, session.userId);
  return <div className="content"><div className="page-heading"><div><h1>Alertas de hoy</h1><p>Publicaciones del día vinculadas mediante órgano oficial y número normalizado. Esta vista se renueva a las 00:00, hora de Guadalajara.</p></div></div><section className="panel"><header className="panel-header"><h2>Notificaciones</h2><span className="muted" style={{ fontSize: 10 }}>{notifications.length}</span></header>{!notifications.length ? <div className="empty-panel"><BellRinging size={23} /><p>Aún no hay alertas de hoy. Se crearán cuando una publicación oficial se vincule con un asunto vigilado.</p></div> : notifications.map((item) => <article className="alert-record" key={item.id}><div><span className={`tag ${item.status === "QUEUED" ? "tag-new" : ""}`}>{item.status === "QUEUED" ? "Nueva hoy" : item.status}</span><h3>{item.subject}</h3><p>{item.case_number} · {item.court_name}</p><time>{formatGuadalajaraDateTime(item.created_at)}</time></div><Link className="button button-secondary button-small" href={`/cases/${item.monitored_case_id}`}>Abrir asunto</Link></article>)}</section></div>;
}
