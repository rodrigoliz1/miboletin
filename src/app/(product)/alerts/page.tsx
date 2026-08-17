import Link from "next/link";
import { BellRinging } from "@phosphor-icons/react/dist/ssr";
import { getSession } from "@/lib/security/session";
import { listNotifications } from "@/lib/product/repository";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const session = await getSession();
  if (!session) return null;
  const notifications = await listNotifications(session.organizationId, session.userId);
  return <div className="content"><div className="page-heading"><div><h1>Alertas verificadas</h1><p>Publicaciones vinculadas mediante órgano oficial y número normalizado.</p></div></div><section className="panel"><header className="panel-header"><h2>Notificaciones</h2><span className="muted" style={{ fontSize: 10 }}>{notifications.length}</span></header>{!notifications.length ? <div className="empty-panel"><BellRinging size={23} /><p>Aún no hay alertas. Se crearán cuando una publicación oficial se vincule con un asunto vigilado.</p></div> : notifications.map((item) => <article className="alert-record" key={item.id}><div><span className={`tag ${item.status === "QUEUED" ? "tag-new" : ""}`}>{item.status === "QUEUED" ? "Nueva" : item.status}</span><h3>{item.subject}</h3><p>{item.case_number} · {item.court_name}</p><time>{new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.created_at))}</time></div><Link className="button button-secondary button-small" href={`/cases/${item.monitored_case_id}`}>Abrir asunto</Link></article>)}</section></div>;
}
