import Link from "next/link";
import { Brand } from "@/components/brand";
import { StatusPill } from "@/components/status-pill";
import { providers } from "@/lib/providers";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const health = await Promise.all(Object.values(providers).map((provider) => provider.healthCheck()));
  const overall = health.some((item) => item.status === "FAILED") ? "DEGRADED" : health.every((item) => item.status === "ONLINE") ? "ONLINE" : "DEGRADED";
  return <><header className="public-header"><nav className="public-nav"><Brand /><div className="public-links"><Link href="/">Inicio</Link><Link href="/coverage">Cobertura</Link><Link className="button button-secondary button-small" href="/login">Acceder</Link></div></nav></header><main className="content" style={{ maxWidth: 980, paddingTop: 70 }}><div className="page-heading"><div><p className="eyebrow">Estado operativo</p><h1>Adquisición y fuentes</h1><p>Comprobación semántica ejecutada al cargar esta página.</p></div><StatusPill status={overall} /></div><section className="panel">{health.map((source) => <div className="source-row" key={source.provider}><div><strong>{source.provider}</strong><small>{source.message}<br />Verificado {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(source.checkedAt))} · {source.latencyMs} ms</small></div><StatusPill status={source.status} /></div>)}</section><section style={{ marginTop: 40 }}><h2 style={{ fontFamily: "Georgia,serif", fontSize: 26, fontWeight: 500 }}>Alcance federal exacto</h2><div className="notice">La fuente federal operativa monitorea <strong>listas a sesión</strong>: detecta cuándo un asunto se lista, la fecha programada y resultados publicados. La consulta individual de acuerdos SISE continúa protegida por reCAPTCHA y no se evade.</div></section></main></>;
}
