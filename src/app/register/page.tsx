import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { PasswordField } from "@/components/password-field";

export const metadata: Metadata = { title: "Crear cuenta" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Brand />
        <div className="auth-card">
          <h1>Crea tu espacio de vigilancia.</h1>
          <p>Configura el despacho y registra tu primer expediente en menos de un minuto.</p>
          {error && <p className="form-error" role="alert">{error === "rate" ? "Se alcanzó el límite de registros. Espera unos minutos antes de volver a intentar." : "No fue posible crear la cuenta. Revisa los campos o utiliza otro correo electrónico."}</p>}
          <form action="/api/auth/register" method="post">
            <div className="field"><label htmlFor="name">Nombre completo</label><input id="name" name="name" autoComplete="name" required minLength={2} /></div>
            <div className="field"><label htmlFor="organization">Despacho u organización</label><input id="organization" name="organization" required minLength={2} /></div>
            <div className="field"><label htmlFor="email">Correo electrónico</label><input id="email" name="email" type="email" autoComplete="email" required /></div>
            <PasswordField id="password" autoComplete="new-password" hint="12 caracteres, una mayúscula, una minúscula, un número y un símbolo." />
            <div className="auth-order"><span>Suscripción mensual</span><strong>$499 MXN</strong><small>Cobro seguro procesado por Stripe. Cancela cuando quieras.</small></div>
            <button className="button button-primary auth-submit" type="submit">Continuar al pago seguro</button>
          </form>
          <p className="auth-foot">¿Ya tienes cuenta? <Link href="/login">Iniciar sesión</Link></p>
        </div>
      </section>
      <aside className="auth-visual"><div className="auth-visual-copy"><span>Empieza con orden</span><blockquote>“Tus expedientes, carpetas, resoluciones y listados en un solo espacio profesional.”</blockquote><p>Información oficial con trazabilidad</p></div></aside>
    </main>
  );
}
