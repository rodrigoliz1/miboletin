# Operaciones

## Jalisco deja de actualizar

1. Abrir `/admin` y comparar `lastAttempt` con `lastSuccessfulFetch`.
2. Ejecutar `pnpm health:sources`.
3. Ejecutar un dry-run para un órgano conocido.
4. Si responde con cero anómalo, marcar `DEGRADED`, no “sin movimientos”.
5. Comparar respuesta con `tests/fixtures/jalisco` y revisar el bundle público del portal.

## Federal cambia HTML

El health check valida 32 circuitos, órganos y columnas `No`, `NEUN`, `No. Expediente`, `Fecha de Sesión` y `Resultado`. Si faltan, marca `SCHEMA_DRIFT`: conservar snapshot/error, pausar afirmaciones nuevas y actualizar sólo el parser federal. Si aparece CAPTCHA, abortar con `SOURCE_ACCESS_RESTRICTED`; no automatizarlo.

## STJ Jalisco cambia HTML o protege acceso

El parser exige la tabla de resultados y sus diez columnas. Ejecutar `pnpm ingest:stj --court=5 --case=125/2026 --dry-run` y comparar con `tests/fixtures/stj`. Si aparece challenge, marcar la fuente afectada; no afirmar cero movimientos. El portal de sentencias exige reCAPTCHA por diseño: `UNAVAILABLE` es un estado esperado y no autoriza eludirlo.

## Ejecución manual y backfill

```bash
pnpm ingest:jalisco --date=2026-08-13 --court=C01 --dry-run
pnpm ingest:jalisco --date=2026-08-13 --court=C01
pnpm ingest:stj --court=5 --case=125/2026 --dry-run
pnpm ingest:stj --court=5 --case=125/2026
pnpm federal:backfill --from=2026-08-07 --to=2026-08-14 --circuit=3 --court=119 --dry-run
pnpm federal:backfill --from=2026-08-07 --to=2026-08-14 --circuit=3 --court=119
pnpm monitor:daily --dry-run
pnpm monitor:daily
```

La actualización incremental de Vercel se ejecuta cada diez minutos y procesa primero los asuntos con revisión más antigua. Para probarla sin exponer el secreto:

```bash
curl http://localhost:3000/api/cron/refresh \
  -H "Authorization: Bearer $CRON_SECRET"
```

`acquired: false` significa que otro ciclo conserva el bloqueo; no es un error. Si un ciclo se interrumpe, el arrendamiento expira en nueve minutos. El trabajo es idempotente y los asuntos en estado `CHECKING` no se toman de nuevo durante la ventana de seguridad.

El backfill federal consulta primero el calendario y sólo descarga fechas publicadas. Sin `--court` procesa secuencialmente el circuito. Cada fecha/modo registra un `jobId`; un fallo se informa sin eliminar éxitos anteriores.

## Comprobar una publicación

Abrir su snapshot, verificar SHA-256, `retrievedAt`, órgano, fecha y enlace oficial. Comparar el texto visible con el payload raw. El análisis IA nunca sustituye esta comprobación.

## Reprocesar snapshot

Crear una nueva ejecución con nueva `parserVersion`, leer el raw inmutable y escribir una nueva representación normalizada. No editar el snapshot original.

## Notificaciones

Las alertas in-app se conservan para todas las resoluciones. Brevo sólo recibe listados a sesión, resultados de sesión, sentencias STJ disponibles o resoluciones cuyo extracto contenga la palabra completa “sentencia”. Filtrar `QUEUED` por antigüedad, revisar el evento, reintentar con idempotency key y confirmar `sent_at`. No incluir nombres completos en asuntos de email.
