import { redirect } from "next/navigation";
import { StatusPill } from "@/components/status-pill";
import { providers } from "@/lib/providers";
import { getSession } from "@/lib/security/session";
import { listOperationalRuns } from "@/lib/product/repository";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) redirect("/dashboard");
  const [health, runs] = await Promise.all([Promise.all(Object.values(providers).map((provider) => provider.healthCheck())), listOperationalRuns()]);
  const totals = runs.reduce((sum, run) => ({ fetched: sum.fetched + run.records_fetched, inserted: sum.inserted + run.records_inserted, matches: sum.matches + run.matches, notifications: sum.notifications + run.notifications }), { fetched: 0, inserted: 0, matches: 0, notifications: 0 });
  const sourceNames: Record<string, string> = { "jalisco-cjj": "Poder Judicial del Estado de Jalisco", "federal-pjf-session-lists": "Poder Judicial de la Federación" };
  return <div className="content">
    <div className="page-heading"><div><h1>Administración operativa</h1><p>Métricas persistidas y comprobación semántica de fuentes.</p></div><form action="/api/refresh" method="post"><button className="button button-primary" type="submit">Actualizar asuntos ahora</button></form></div>
    <section className="metrics" style={{ marginBottom: 26 }}><div className="metric"><span className="metric-label">Registros obtenidos</span><span className="metric-value">{totals.fetched}</span></div><div className="metric"><span className="metric-label">Publicaciones insertadas</span><span className="metric-value">{totals.inserted}</span></div><div className="metric"><span className="metric-label">Publicaciones vinculadas</span><span className="metric-value">{totals.matches}</span></div><div className="metric"><span className="metric-label">Notificaciones</span><span className="metric-value">{totals.notifications}</span></div></section>
    <section className="panel" style={{ marginBottom: 24 }}><header className="panel-header"><h2>Fuentes</h2><span className="muted" style={{ fontSize: 10 }}>Comprobación en vivo</span></header>{health.map((source) => { const providerRuns = runs.filter((run) => run.provider === source.provider); const latest = providerRuns[0]; const lastSuccess = providerRuns.find((run) => run.status === "SUCCEEDED"); return <div className="source-row" key={source.provider}><div><strong>{sourceNames[source.provider] ?? source.provider}</strong><small>{source.message}<br />Cobertura consultable: {source.recordsFetched} elementos · {source.latencyMs} ms<br />Última actualización: {latest ? new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mexico_City" }).format(new Date(latest.started_at)) : "sin ejecuciones"} · último éxito: {lastSuccess ? new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mexico_City" }).format(new Date(lastSuccess.started_at)) : "pendiente"}</small></div><StatusPill status={source.status} /></div>; })}</section>
  </div>;
}
