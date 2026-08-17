# Operaciones

## Jalisco deja de actualizar

1. Abrir `/admin` y comparar `lastAttempt` con `lastSuccessfulFetch`.
2. Ejecutar `pnpm health:sources`.
3. Ejecutar un dry-run para un órgano conocido.
4. Si responde con cero anómalo, marcar `DEGRADED`, no “sin movimientos”.
5. Comparar respuesta con `tests/fixtures/jalisco` y revisar el bundle público del portal.

## Federal cambia HTML

El health check valida 32 circuitos, órganos y columnas `No`, `NEUN`, `No. Expediente`, `Fecha de Sesión` y `Resultado`. Si faltan, marca `SCHEMA_DRIFT`: conservar snapshot/error, pausar afirmaciones nuevas y actualizar sólo el parser federal. Si aparece CAPTCHA, abortar con `SOURCE_ACCESS_RESTRICTED`; no automatizarlo.

## Ejecución manual y backfill

```bash
pnpm ingest:jalisco --date=2026-08-13 --court=C01 --dry-run
pnpm ingest:jalisco --date=2026-08-13 --court=C01
pnpm federal:backfill --from=2026-08-07 --to=2026-08-14 --circuit=3 --court=119 --dry-run
pnpm federal:backfill --from=2026-08-07 --to=2026-08-14 --circuit=3 --court=119
pnpm monitor:daily --dry-run
pnpm monitor:daily
```

El backfill federal consulta primero el calendario y sólo descarga fechas publicadas. Sin `--court` procesa secuencialmente el circuito. Cada fecha/modo registra un `jobId`; un fallo se informa sin eliminar éxitos anteriores.

## Comprobar una publicación

Abrir su snapshot, verificar SHA-256, `retrievedAt`, órgano, fecha y enlace oficial. Comparar el texto visible con el payload raw. El análisis IA nunca sustituye esta comprobación.

## Reprocesar snapshot

Crear una nueva ejecución con nueva `parserVersion`, leer el raw inmutable y escribir una nueva representación normalizada. No editar el snapshot original.

## Notificaciones

Filtrar `QUEUED` por antigüedad, revisar el evento `NOTIFICATION_QUEUED`, reintentar con idempotency key y confirmar `sent_at`. No incluir nombres completos en asuntos de email.
