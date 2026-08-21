# Mi Boletín Judicial

Plataforma de monitoreo judicial para litigantes y despachos. Permite registrar cuentas reales, organizar expedientes en carpetas, recuperar publicaciones oficiales, conservar evidencia inmutable, hacer matching por órgano y expediente y mostrar avisos dentro de la aplicación.

## Cobertura real

- Jalisco: búsqueda y vigilancia por órgano + expediente en 194 órganos de cinco familias del Consejo de la Judicatura.
- STJ Jalisco: acuerdos históricos por Sala + Toca en las once Salas, datos de origen y detección verificable de sentencia.
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
- Índice judicial propio por nombre, con menciones auditables, normalización y relaciones procesales.
- Vitest para contratos y Playwright para flujo E2E.

## Inicio local

```bash
cp .env.example .env.local
pnpm install
pnpm db:migrate
pnpm dev
```

Completa `.env.local` con `DATABASE_URL`, `AUTH_SECRET`, `EMAIL_OTP_SECRET`, `PASSWORD_RESET_SECRET` y `CRON_SECRET`. Para probar cobros y correos agrega también las variables `STRIPE_*`, `BREVO_*` y `AI_*` de `.env.example`. Los comandos CLI cargan ese archivo automáticamente; ya no es necesario ejecutar `export` en cada terminal. Después de migrar, abre `http://localhost:3000/register`; el alta crea la organización y una carpeta General, envía el OTP y conserva la sesión. Una vez verificado el correo, el usuario llega al dashboard y contrata desde el bloqueo de suscripción. En desarrollo, si Stripe no está configurado, se permite el acceso local para que puedas probar el producto; en producción Stripe es obligatorio para activar una cuenta.

Las sentencias validadas usan Vercel Blob privado en producción (`BLOB_READ_WRITE_TOKEN`). En localhost no necesitas esa variable: los documentos se guardan en `.data/judicial-documents`, directorio ignorado por Git.

La clave del gateway del Asistente es exclusivamente de servidor. Nunca uses una variable `NEXT_PUBLIC_AI_API_KEY` ni la incluyas en Git. Si se omite, la aplicación sigue funcionando y el panel explica que el Asistente está pendiente de configuración.

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

Consulta de un Toca en Sala del STJ Jalisco:

```bash
pnpm ingest:stj --court=5 --case=125/2026 --dry-run
```

Backfill federal de un órgano o de todos los órganos de un circuito:

```bash
pnpm federal:backfill --from=2026-08-01 --to=2026-08-14 --circuit=3 --court=119 --dry-run
pnpm federal:backfill --from=2026-08-01 --to=2026-08-14 --circuit=3
```

Backfill del índice de partes (en seco por defecto) y aplicación controlada:

```bash
pnpm parties:backfill -- --provider=jalisco-cjj
pnpm parties:backfill -- --provider=federal-pjf-session-lists
pnpm parties:backfill -- --apply
```

Índice global desacoplado de los expedientes vigilados (en seco por defecto):

```bash
pnpm index:global -- --provider=jalisco-cjj --from=2026-08-01 --to=2026-08-19 --max-units=25
pnpm index:global -- --provider=jalisco-cjj --from=2026-08-01 --to=2026-08-19 --apply --max-units=250
pnpm index:global -- --provider=jalisco-cjj --apply --resume=latest --max-units=250
pnpm index:global -- --provider=federal-pjf-session-lists --from=2026-08-01 --to=2026-08-19 --circuit=3 --apply --max-units=120
pnpm federal:diagnose -- --case-id=UUID
pnpm judicial:catalogs:sync
pnpm judicial:index:status
pnpm judicial:index:status -- --provider=jalisco-cjj --all-courts
pnpm judicial:deep-worker -- --jobs=4 --units=40
pnpm judicial:audit -- --provider=jalisco-cjj --court=M05 --from=2026-08-21 --to=2026-08-21 --name="Josefina Fuentes Corral"
```

`judicial_cases` conserva asuntos descubiertos aunque nadie los vigile; las carpetas y `monitored_cases` mantienen la relación privada con el cliente. El job global persiste checkpoints en `global_index_runs`, es idempotente y se ejecuta aparte del monitor de watchlists mediante `.github/workflows/global-index.yml`. Las fechas de cobertura que muestra administración son los extremos presentes en el índice, no una promesa de continuidad mientras el backfill siga incompleto.

La búsqueda por nombre vive en `/search/names`; consulta primero el índice persistente de PostgreSQL y, si el cero coincide con cobertura parcial, crea un trabajo ampliado resumible. `judicial_source_coverage` registra fuente, órgano, fecha y recurso; la interfaz nunca trata los extremos de fecha como continuidad ni presenta un cero provisional como ausencia absoluta.

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

En producción, `vercel.json` invoca cada diez minutos `/api/cron/refresh`. La ruta exige `CRON_SECRET`, adquiere un bloqueo persistente en PostgreSQL, sólo procesa organizaciones con suscripción vigente y reparte un lote acotado por antigüedad para no superponer ejecuciones ni saturar las fuentes. `CRON_REFRESH_BATCH_SIZE` permite ajustar el lote entre 1 y 30; el valor recomendado inicial es 12. El barrido completo de GitHub Actions se conserva como respaldo operativo.

Mientras el usuario mantiene abierto el dashboard, la lista o una ficha de expediente, la interfaz vuelve a leer los datos cada minuto y solicita una revisión incremental cada cinco minutos. Esto es actualización casi en tiempo real: las fuentes judiciales son de consulta y no ofrecen webhooks, por lo que no es técnicamente posible prometer entrega instantánea. El botón **Actualizar ahora** de cada expediente continúa disponible y fuerza una comprobación manual sin esperar al siguiente ciclo.

Cuando la fecha oficial del acuerdo coincide con la fecha de publicación, la resolución permanece en el boletín del día oficial y vuelve a mostrarse al día siguiente como **Revisión adicional**. Lo mismo ocurre cuando el sistema detecta por primera vez un auto a partir de las 15:00, hora de Ciudad de México, siempre que esa detección suceda en su propia fecha oficial de publicación. Ambas reglas son independientes y la fecha oficial nunca se altera. En expedientes federales cuya fuente no publique partes, el usuario puede capturarlas de forma privada desde la ficha; esos nombres quedan aislados dentro de su asunto vigilado.

En el boletín local de Jalisco la ficha presenta **Fecha de acuerdo** y **Fecha de publicación**. Cuando la API no entrega `FCH_BOLETIN`, la publicación se normaliza al siguiente día hábil posterior al acuerdo; sábado y domingo se trasladan al lunes. La fecha de promoción se conserva como dato de origen, pero no sustituye ni se muestra como fecha de publicación.

## Asistente

El botón inferior derecho abre conversaciones privadas del usuario. Las respuestas se generan con el contexto recuperado de Neon en ese momento: asuntos activos, acuerdos, sesiones y alertas del espacio autorizado. El modelo no recibe contraseñas, cookies, UUID internos ni la cadena de conexión. Los extractos se tratan como datos no confiables y la respuesta recuerda corroborar la fuente oficial.

Variables:

```bash
AI_API_KEY="..."
AI_BASE_URL="https://tokease.com/v1"
AI_MODEL_FAST="..."
AI_MODEL_PRO="..."
AI_MODEL_PREMIUM="..."
```

El servidor limita cada mensaje a 4,000 caracteres, conserva como máximo 12 turnos recientes para continuidad y aplica un límite persistente de 12 preguntas por minuto por usuario.

## Suscripción y correos

`STRIPE_PRICE_ID` debe apuntar a un precio recurrente mensual de **49900 centavos MXN**. Checkout recopila el método de pago; los webhooks son la fuente de verdad que activa, renueva, bloquea o cancela el acceso. El perfil abre el portal alojado de Stripe, por lo que la aplicación nunca recibe números de tarjeta.

En Brevo verifica `miboletin.lat` y el remitente definido en `BREVO_SENDER_EMAIL`. Se envían códigos OTP de registro y recuperación de contraseña, así como correos de bienvenida, pago confirmado, pago fallido y cancelación; el registro evita duplicados por evento.

Los avisos judiciales por correo se reservan para eventos importantes: listado a sesión, resultado de sesión, sentencia pública del STJ o resolución cuyo extracto contenga “sentencia”. Los demás acuerdos sólo aparecen como alertas dentro de la aplicación. `billing:retention` envía avisos diarios durante los últimos tres días sólo cuando la recurrencia ya no está activa, y una campaña semanal idempotente tras el vencimiento.

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
- [Integración de Salas del STJ Jalisco](docs/STJ-JALISCO.md)
- [Operación del Asistente](docs/ASSISTANT-AI.md)
- [Índice judicial por nombre](docs/PARTY-SEARCH.md)
- [Correos de continuidad de suscripción](docs/SUBSCRIPTION-RETENTION.md)
- [Informe de implementación](FEDERAL_IMPLEMENTATION_REPORT.md)
- [Fuentes oficiales](docs/SOURCES.md)
- [Arquitectura](docs/ARCHITECTURE.md)
- [Base de datos](docs/DATABASE.md)
- [Despliegue](docs/DEPLOYMENT.md)
- [Operaciones](docs/OPERATIONS.md)
- [Pruebas](docs/TESTING.md)

Mi Boletín Judicial es una herramienta de monitoreo. Los datos deben corroborarse en la fuente oficial cuando vayan a sustentar una actuación procesal.
# miboletin
