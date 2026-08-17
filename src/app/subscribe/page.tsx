import Link from "next/link";
import { Check, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { Brand } from "@/components/brand";
import { getSession } from "@/lib/security/session";
import { getBillingSummary } from "@/lib/billing/repository";

export const metadata = { title: "Suscripción" };

export default async function SubscribePage({ searchParams }: { searchParams: Promise<{ error?: string; checkout?: string }> }) {
  const query = await searchParams;
  const session = await getSession();
  const billing = session ? await getBillingSummary(session.organizationId) : null;
  const canManage = !session || session.role === "OWNER" || session.role === "ADMIN";
  return <main className="subscribe-page"><header className="public-header"><nav className="public-nav"><Brand /><div className="public-links"><Link href="/">Producto</Link>{session ? <Link className="button button-secondary button-small" href="/dashboard">Ir al panel</Link> : <Link className="button button-secondary button-small" href="/login">Iniciar sesión</Link>}</div></nav></header><section className="pricing-hero"><div className="pricing-copy"><p className="eyebrow">UNA SUSCRIPCIÓN. TODO TU SEGUIMIENTO.</p><h1>La agenda judicial de tu despacho, siempre al día.</h1><p>Registra expedientes locales y federales, organiza asuntos en carpetas y recibe avisos con su contexto y origen.</p></div><article className="pricing-card"><div className="pricing-card-head"><span>Plan profesional</span><div><strong>$499</strong><small>MXN / mes</small></div><p>Incluye actualizaciones del producto y cancelación en cualquier momento.</p></div><ul>{["Expedientes y carpetas sin fricción", "Resoluciones del boletín de Jalisco", "Acuerdos federales y seguimiento de sesión", "Avisos y vista diaria por periodos", "Asistente para consultar la información de tu cuenta"].map((item) => <li key={item}><Check size={16} weight="bold" />{item}</li>)}</ul>{query.error && <p className="form-error">No fue posible iniciar el pago. Verifica la configuración o vuelve a intentarlo.</p>}{query.checkout === "canceled" && <p className="notice">El pago fue cancelado; tu cuenta y datos permanecen seguros.</p>}{billing?.accessAllowed && billing.configured ? <Link className="button button-primary pricing-action" href="/dashboard">Tu suscripción está activa</Link> : session && canManage ? <form action="/api/billing/checkout" method="post"><button className="button button-primary pricing-action" type="submit">Suscribirme con Stripe</button></form> : session ? <p className="gate-admin-note">Un administrador de tu organización debe realizar la contratación.</p> : <Link className="button button-primary pricing-action" href="/register">Crear cuenta y suscribirme</Link>}<p className="secure-checkout"><ShieldCheck size={15} /> Pago cifrado y procesado por Stripe. Mi Boletín Judicial no recibe ni almacena los datos de tu tarjeta.</p></article></section></main>;
}
