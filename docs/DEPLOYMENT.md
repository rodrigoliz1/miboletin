# Despliegue

## Topología recomendada

- GitHub como origen.
- Vercel para Next.js.
- Neon PostgreSQL en la misma región.
- Vercel Blob privado para versiones públicas de sentencias.
- GitHub Actions (`.github/workflows/monitor.yml`) como worker inicial para `monitor:daily`.
- Un worker persistente (Render, Fly.io o equivalente) cuando el volumen ya no quepa cómodamente en una ejecución programada.

## Pasos

1. Crear PostgreSQL y habilitar conexión TLS.
2. Configurar las variables de `.env.example` en Vercel y los secretos de vigilancia en GitHub.
3. Ejecutar `pnpm db:migrate` desde una tarea de release con acceso exclusivo.
4. Desplegar Next.js y confirmar `/status`.
5. Activar el workflow **Vigilancia judicial**; ya está programado a las 08:00, 09:00, 11:00, 14:00, 17:00 y 20:00, hora de Guadalajara.
6. Ejecutarlo manualmente una vez desde Actions y revisar que termine sin errores.
7. Ejecutar un backfill federal acotado con `--dry-run`, revisar el snapshot y después persistirlo.
8. Registrar una cuenta de staging, un expediente federal controlado y comprobar DB -> matching -> alerta -> UI antes de habilitar notificaciones de producción.

Variables obligatorias de producción: `DATABASE_URL`, `AUTH_SECRET`, `EMAIL_OTP_SECRET`, `PASSWORD_RESET_SECRET`, `CRON_SECRET`, `APP_URL`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` y `BLOB_READ_WRITE_TOKEN`. Para el Asistente: `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL_FAST`, `AI_MODEL_PRO` y `AI_MODEL_PREMIUM`. Recomendadas: `DB_POOL_SIZE=2`, `SOURCE_USER_AGENT`, `FEDERAL_SESSION_BASE`, `LOG_LEVEL`.

No ejecutar ingestión masiva desde funciones serverless con timeout. Los jobs deben ser reentrantes e idempotentes.

## Publicación inicial con GitHub y Vercel

Antes de publicar, rota cualquier contraseña o secreto que haya sido pegado en una conversación, captura o terminal compartida. En particular: contraseña/rol de Neon, `AUTH_SECRET`, `CRON_SECRET` y cualquier clave de OpenAI expuesta. Sustituir `AUTH_SECRET` cerrará las sesiones actuales, que es el comportamiento seguro esperado.

Antes de Git, confirma que `.env.local` está ignorado:

```bash
git check-ignore .env.local
```

Si el proyecto aún no es repositorio:

```bash
git init -b main
git add .
git status --short
git commit -m "Prepare Mi Boletín Judicial for production"
gh auth login
gh repo create mi-boletin-judicial --private --source=. --remote=origin --push
```

No continúes si `git status` muestra `.env.local`, claves `sk-...`, contraseñas o cadenas `postgresql://`. En GitHub, crea estos secretos en **Settings → Secrets and variables → Actions**:

- `DATABASE_URL`: conexión directa o de pool de Neon con TLS.
- `SOURCE_USER_AGENT`: nombre y contacto operativo de la aplicación.
- `APP_URL`: dominio HTTPS definitivo.
- `BREVO_API_KEY` y `BREVO_SENDER_EMAIL`: necesarios para que el worker entregue avisos judiciales por correo.
- `BLOB_READ_WRITE_TOKEN`: acceso de escritura al Blob privado para que el worker archive una sentencia oficial sin exponer su URL.

Después, en Vercel:

1. **Add New → Project**, importa el repositorio privado y conserva el preset Next.js.
2. Configura `DATABASE_URL` con la cadena **pooled** de Neon (`-pooler` en el host) para Preview y Production.
3. En **Storage**, crea un Vercel Blob con acceso **Private** y conéctalo al proyecto. Vercel agregará `BLOB_READ_WRITE_TOKEN`.
4. Agrega las demás variables obligatorias indicadas arriba, incluidos los cinco valores `AI_*` del Asistente, además de `DB_POOL_SIZE=2`, `SOURCE_USER_AGENT` y `FEDERAL_SESSION_BASE`. Los nombres concretos de modelo se administran únicamente en Vercel.
5. Ejecuta `pnpm db:migrate` una vez contra la base de producción antes de aceptar usuarios.
6. Despliega; actualiza `APP_URL` al dominio definitivo y vuelve a desplegar.
7. En Stripe crea un producto con un precio recurrente mensual de **$499 MXN** y copia su identificador `price_...` a `STRIPE_PRICE_ID`.
8. En Stripe Workbench registra `https://TU-DOMINIO/api/billing/webhook`; escucha `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` e `invoice.payment_failed`. Copia el secreto de firma a `STRIPE_WEBHOOK_SECRET`.
9. Activa en Stripe Customer Portal la actualización del método de pago y la cancelación al final del periodo.
10. En Brevo autentica el dominio, verifica el remitente y crea una clave transaccional con el menor alcance necesario.
11. Activa también el workflow **Continuidad de suscripción** y comprueba que una ejecución manual no envíe correo a una suscripción recurrente activa.
12. Comprueba registro → OTP → dashboard bloqueado → Checkout → retorno automático al dashboard habilitado, correo de confirmación, portal de facturación, renovación, bloqueo por vencimiento, alta/borrado de expediente, carpetas múltiples, filtros, conversaciones y una pregunta de prueba.

Para desplegar también desde la terminal:

```bash
pnpm dlx vercel@latest login
pnpm dlx vercel@latest link
pnpm dlx vercel@latest
pnpm dlx vercel@latest --prod
```

Las variables se administran en Vercel; no se copian al repositorio. Los despliegues de Preview deben usar una rama de Neon separada para no mezclar pruebas con producción.

## Lista de salida

- `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` terminan correctamente.
- Migraciones al día y respaldo/restore de Neon probado.
- Dominio con HTTPS, `APP_URL` exacta y cookies seguras.
- Webhook de Stripe firmado probado en modo test y después en modo live.
- Dominio/remitente de Brevo verificado; SPF, DKIM y DMARC revisados.
- Cuenta de staging separada y `E2E_DATABASE_URL` apuntando a una rama no productiva.
- Presupuesto y límites de uso configurados en OpenAI; la clave sólo existe en Vercel.
- Workflow de vigilancia ejecutado manualmente y alertas revisadas.
- Política de privacidad, términos y aviso de que el sistema no sustituye la consulta de la fuente oficial ni asesoría jurídica.
