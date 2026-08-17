import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { PasswordField } from "@/components/password-field";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; reset?: string }> }) {
  const { error, reset } = await searchParams;
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Brand />
        <div className="auth-card">
          <h1>Bienvenido de nuevo.</h1>
          <p>Accede a tus asuntos, movimientos y alertas del despacho.</p>
          {reset && <div className="notice success-notice" role="status">Contraseña actualizada. Ya puedes iniciar sesión.</div>}
          {error && <p className="form-error" role="alert">{error === "database" ? "No fue posible conectar con la base de datos. Intenta nuevamente en unos minutos." : error === "rate" ? "Demasiados intentos. Espera unos minutos antes de volver a probar." : "Correo o contraseña incorrectos. Verifica tus datos e intenta nuevamente."}</p>}
          <form action="/api/auth/login" method="post">
            <div className="field"><label htmlFor="email">Correo electrónico</label><input id="email" name="email" type="email" autoComplete="email" required /></div>
            <PasswordField id="password" autoComplete="current-password" />
            <div className="auth-form-link"><Link href="/forgot-password">Olvidé mi contraseña</Link></div>
            <button className="button button-primary auth-submit" type="submit">Iniciar sesión</button>
          </form>
          <p className="auth-foot">¿Aún no tienes cuenta? <Link href="/register">Crear cuenta</Link></p>
        </div>
      </section>
      <aside className="auth-visual"><div className="auth-visual-copy"><span>Tu práctica, bajo control</span><blockquote>“Cada publicación relevante reunida en una agenda clara para todo el despacho.”</blockquote><p>Monitoreo judicial con trazabilidad</p></div></aside>
    </main>
  );
}
