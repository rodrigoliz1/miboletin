# Mi Boletín Judicial

Plataforma de monitoreo judicial para litigantes y despachos. Permite registrar cuentas reales, organizar expedientes en carpetas, recuperar publicaciones oficiales, conservar evidencia inmutable, hacer matching por órgano y expediente y mostrar avisos dentro de la aplicación.

## Cobertura real

- Jalisco: búsqueda y vigilancia por órgano + expediente en 194 órganos de cinco familias del Consejo de la Judicatura.
- Federal: acuerdos por expediente desde la ficha pública SISE y, para órganos colegiados, listas a sesión, fecha programada, resultado y sentido. El catálogo vivo combina todos los órganos de los 32 circuitos.
- No cubierto: el expediente electrónico autenticado. La búsqueda general SISE con reCAPTCHA no se automatiza; se usa la ficha pública directa del asunto, sin eludir controles.

No hay expedientes, cuentas ni publicaciones simuladas. Si una fuente falla, se informa el error y nunca se sustituye por datos ficticios.

## Stack

- Next.js 16, React 19 y TypeScript estricto.
- PostgreSQL 15+ (compatible con Neon) y migraciones SQL versionadas.
- Sesión JWT en cookie `httpOnly`, autorización por organización y roles.
- Stripe Checkout, webhooks firmados y portal de facturación para la suscripción mensual.
- Correos transaccionales con Brevo y plantillas de marca.
- Asistente con conversaciones persistidas y contexto aislado por organización/usuario.
- Workers idempotentes para ingestión, backfill y health checks.
- Vitest para contratos y Playwright para flujo E2E.

## Inicio local

```bash
cp .env.example .env.local
pnpm install
pnpm db:migrate
pnpm dev
```

Completa `.env.local` con `DATABASE_URL`, `AUTH_SECRET` y `CRON_SECRET`. Para probar cobros y correos agrega también las variables `STRIPE_*`, `BREVO_*` y `OPENAI_*` de `.env.example`. Los comandos CLI cargan ese archivo automáticamente; ya no es necesario ejecutar `export` en cada terminal. Después de migrar, abre `http://localhost:3000/register`; el alta crea la organización y una carpeta General. En desarrollo, si Stripe no está configurado, se permite el acceso local para que puedas probar el producto; en producción Stripe es obligatorio para activar una cuenta.

La clave de OpenAI es exclusivamente de servidor. Nunca uses una variable `NEXT_PUBLIC_OPENAI_API_KEY` ni la incluyas en Git. Si se omite, la aplicación sigue funcionando y el panel explica que el asistente está pendiente de configuración.

Para recibir eventos de Stripe durante el desarrollo instala su CLI y reenvía el webhook:

```bash
stripe login
stripe listen --forward-to localhost:3000/api/billing/webhook
```

Copia el secreto `whsec_...` mostrado por la CLI a `STRIPE_WEBHOOK_SECRET` y usa una tarjeta de prueba de Stripe desde `/register` o `/subscribe`.

Para probar la aplicación manualmente:

```bash
pnpm dev
```

En otra terminal, cuando quieras forzar la revisión de todos los asuntos activos:

```bash
pnpm monitor:daily
```

El seed es opcional y sólo funciona si proporcionas credenciales expresas:

```bash
SEED_ADMIN_EMAIL=admin@example.com \
SEED_ADMIN_PASSWORD='una-clave-segura' \
SEED_ADMIN_NAME='Administración' \
SEED_ORGANIZATION_NAME='Mi despacho' \
pnpm db:seed
```

## Operación

Consulta Jalisco:

```bash
pnpm ingest:jalisco --date=2026-08-13 --court=C01 --dry-run
```

Consulta federal directa de acuerdos por expediente:

```bash
pnpm ingest:federal --mode=agreement --court=119 --circuit=3 --case=461/2024 --type="Amparo Directo" --dry-run
```

Backfill federal de un órgano o de todos los órganos de un circuito:

```bash
pnpm federal:backfill --from=2026-08-01 --to=2026-08-14 --circuit=3 --court=119 --dry-run
pnpm federal:backfill --from=2026-08-01 --to=2026-08-14 --circuit=3
```

Revisión diaria de todos los órganos que tengan asuntos activos:

```bash
pnpm monitor:daily --dry-run
pnpm monitor:daily
```

Endpoint protegido para cron/worker:

```bash
curl -X POST https://tu-dominio.example/api/ingest/federal \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-08-07","circuitId":"3","courtExternalId":"119","sourceMode":"LISTED"}'
```

Al entrar al dashboard o a la ficha de un expediente el navegador solicita una actualización POST y refresca la vista, con una ventana de enfriamiento de 60 segundos. En producción se programa además `monitor:daily`; no se depende sólo de visitas de usuarios.

## Asistente

El botón inferior derecho abre conversaciones privadas del usuario. Las respuestas se generan con el contexto recuperado de Neon en ese momento: asuntos activos, acuerdos, sesiones y alertas del espacio autorizado. El modelo no recibe contraseñas, cookies, UUID internos ni la cadena de conexión. Los extractos se tratan como datos no confiables y la respuesta recuerda corroborar la fuente oficial.

Variables:

```bash
OPENAI_API_KEY="sk-..."
OPENAI_MODEL="gpt-5.6-terra"
```

El servidor limita cada mensaje a 4,000 caracteres, conserva como máximo 12 turnos recientes para continuidad y aplica un límite persistente de 12 preguntas por minuto por usuario.

## Suscripción y correos

`STRIPE_PRICE_ID` debe apuntar a un precio recurrente mensual de **49900 centavos MXN**. Checkout recopila el método de pago; los webhooks son la fuente de verdad que activa, renueva, bloquea o cancela el acceso. El perfil abre el portal alojado de Stripe, por lo que la aplicación nunca recibe números de tarjeta.

En Brevo verifica el dominio y el remitente definido en `BREVO_SENDER_EMAIL`. Se envían correos de bienvenida, pago confirmado, pago fallido y cancelación; el registro evita duplicados por evento.

## Verificación

```bash
pnpm lint
pnpm typecheck
pnpm test
LIVE_SOURCE_TESTS=1 pnpm test -- tests/source-contract.live.test.ts
pnpm test:e2e
pnpm build
```

El E2E completo requiere una base PostgreSQL migrada. Las pruebas vivas consultan fuentes oficiales y deben ejecutarse con baja frecuencia.

Para evitar cuentas de auditoría en la base principal, crea una rama de Neon para pruebas y configura su URL como `E2E_DATABASE_URL` en `.env.local`. Si se omite, Playwright usará `DATABASE_URL` y escribirá datos de prueba identificados con correos `@example.test`.

Antes de la primera ejecución de navegador:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

## Documentación

- [Investigación de la fuente federal](docs/FEDERAL-SOURCE-RESEARCH.md)
- [Operación federal](docs/FEDERAL.md)
- [Informe de implementación](FEDERAL_IMPLEMENTATION_REPORT.md)
- [Fuentes oficiales](docs/SOURCES.md)
- [Arquitectura](docs/ARCHITECTURE.md)
- [Base de datos](docs/DATABASE.md)
- [Despliegue](docs/DEPLOYMENT.md)
- [Operaciones](docs/OPERATIONS.md)
- [Pruebas](docs/TESTING.md)

Mi Boletín Judicial es una herramienta de monitoreo. Los datos deben corroborarse en la fuente oficial cuando vayan a sustentar una actuación procesal.
# miboletin
