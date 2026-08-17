import type { Metadata } from "next";
import Link from "next/link";
import { EnvelopeSimple, Key } from "@phosphor-icons/react/dist/ssr";
import { Brand } from "@/components/brand";
import { PasswordField } from "@/components/password-field";
import { getPasswordResetFlow } from "@/lib/auth/password-recovery";

export const metadata: Metadata = { title: "Recuperar contraseña" };

function masked(email: string) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}${"•".repeat(Math.max(2, Math.min(6, name.length - 2)))}@${domain}`;
}

const errors: Record<string, string> = {
  email: "Escribe un correo electrónico válido.", rate: "Se alcanzó el límite de intentos. Espera antes de volver a probar.",
  expired: "La solicitud caducó. Inicia nuevamente la recuperación.", locked: "Se alcanzó el límite de intentos. Solicita un código nuevo.",
  code: "El código no es correcto.", password: "Las contraseñas deben coincidir y tener 12 caracteres, mayúscula, minúscula, número y símbolo.",
  cooldown: "Espera un minuto antes de solicitar otro código.", delivery: "No pudimos enviar otro código en este momento.",
};

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string; resent?: string; error?: string }> }) {
  const query = await searchParams;
  const email = query.sent ? await getPasswordResetFlow() : null;
  const devCode = process.env.NODE_ENV !== "production" && !process.env.BREVO_API_KEY?.trim();
  return <main className="verify-page"><header><Brand /></header><section className="verify-card password-recovery-card">
    <span className="verify-icon">{email ? <Key size={27} weight="duotone" /> : <EnvelopeSimple size={27} weight="duotone" />}</span>
    <p className="result-kicker">RECUPERA TU ACCESO</p>
    <h1>{email ? "Crea una nueva contraseña." : "¿Olvidaste tu contraseña?"}</h1>
    <p>{email ? <>Enviamos un código de seis dígitos a <strong>{masked(email)}</strong>.</> : "Escribe el correo de tu cuenta. Si está registrado, recibirás un código para continuar."}</p>
    {query.error && <div className="form-error" role="alert">{errors[query.error] ?? errors.code}</div>}
    {query.resent && <div className="notice success-notice">Enviamos un código nuevo.</div>}
    {email && devCode && <div className="notice"><strong>Entorno local:</strong> usa el código <code>654321</code>.</div>}
    {!email ? <form action="/api/auth/forgot-password" method="post" className="otp-form"><label htmlFor="recovery-email">Correo electrónico</label><div><EnvelopeSimple size={19} /><input id="recovery-email" name="email" type="email" autoComplete="email" required autoFocus /></div><button className="button button-primary" type="submit">Enviar código</button></form> : <form action="/api/auth/reset-password" method="post" className="otp-form password-reset-form"><label htmlFor="reset-code">Código de recuperación</label><div><Key size={19} /><input id="reset-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} placeholder="000000" required autoFocus /></div><PasswordField id="new-password" name="password" autoComplete="new-password" label="Nueva contraseña" hint="12 caracteres, mayúscula, minúscula, número y símbolo." /><PasswordField id="confirm-password" name="confirmation" autoComplete="new-password" label="Confirmar contraseña" /><button className="button button-primary" type="submit">Guardar nueva contraseña</button></form>}
    <div className="verify-actions">{email && <form action="/api/auth/resend-password-reset" method="post"><button type="submit">Enviar otro código</button></form>}<Link href="/login">Volver a iniciar sesión</Link></div>
  </section></main>;
}
