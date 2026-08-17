import { redirect } from "next/navigation";
import { EnvelopeSimple, Key } from "@phosphor-icons/react/dist/ssr";
import { Brand } from "@/components/brand";
import { getSession } from "@/lib/security/session";
import { isEmailVerified } from "@/lib/auth/email-verification";

function maskedEmail(email: string) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}${"•".repeat(Math.max(2, Math.min(6, name.length - 2)))}@${domain}`;
}

const messages: Record<string, string> = {
  invalid: "El código no es correcto. Revisa el correo e inténtalo nuevamente.",
  expired: "El código caducó. Solicita uno nuevo.",
  locked: "Se alcanzó el límite de intentos. Solicita un código nuevo.",
  cooldown: "Espera un minuto antes de solicitar otro código.",
  rate: "Se alcanzó el límite de envíos. Inténtalo más tarde.",
  delivery: "No pudimos entregar el correo. Vuelve a intentarlo en unos minutos.",
};

export const metadata = { title: "Verificar correo" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (await isEmailVerified(session.userId)) redirect("/dashboard");
  const query = await searchParams;
  const devCode = process.env.NODE_ENV !== "production" && !process.env.BREVO_API_KEY?.trim();
  return <main className="verify-page"><header><Brand /></header><section className="verify-card"><span className="verify-icon"><EnvelopeSimple size={27} weight="duotone" /></span><p className="result-kicker">CONFIRMA TU IDENTIDAD</p><h1>Revisa tu correo.</h1><p>Enviamos un código de seis dígitos a <strong>{maskedEmail(session.email)}</strong>. Escríbelo para verificar tu cuenta.</p>{query.sent && <div className="notice success-notice">Código enviado. Estará vigente durante 10 minutos.</div>}{query.error && <div className="form-error" role="alert">{messages[query.error] ?? messages.invalid}</div>}{devCode && <div className="notice"><strong>Entorno local:</strong> usa el código <code>123456</code>.</div>}<form action="/api/auth/verify-email" method="post" className="otp-form"><label htmlFor="verification-code">Código de verificación</label><div><Key size={19} /><input id="verification-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} placeholder="000000" required autoFocus /></div><button className="button button-primary" type="submit">Verificar y continuar</button></form><div className="verify-actions"><form action="/api/auth/resend-verification" method="post"><button type="submit">Enviar otro código</button></form><form action="/api/auth/logout" method="post"><button type="submit">Usar otra cuenta</button></form></div><small>Nunca te pediremos este código por teléfono o mensaje.</small></section></main>;
}
