# Ingestión

Cada ejecución tiene `jobId`, provider, tiempos, obtenidos, insertados, actualizados, duplicados, matches, notificaciones y errores.

## Etapas

1. `DISCOVER`: confirma URL y capacidades.
2. `FETCH`: GET/POST backend respetuoso con timeout de 15 segundos, tres intentos, backoff exponencial y jitter.
3. `SNAPSHOT`: guarda payload, URL, headers, content type, fecha, SHA-256 y versiones.
4. `PARSE` y `VALIDATE`: contratos Zod y campos esenciales.
5. `NORMALIZE`: expediente, nombres, fechas y llave canónica.
6. `DEDUPLICATE` y `STORE`: constraints y upsert.
7. `MATCH`: `EXACT`, `PROBABLE`, `AMBIGUOUS` o `NO_MATCH`.
8. `NOTIFY`: cola in-app/email sólo para matches permitidos.

## Cero anómalo y drift

El heartbeat compara el número de registros con ventanas anteriores y calendario. Si el parser deja de encontrar expediente, órgano o fecha, la ejecución queda `PARSER_DEGRADED`, conserva el raw y no genera una afirmación de ausencia.

## Backfill

```bash
pnpm ingest:jalisco --date=2026-08-14 --court=M01
pnpm federal:backfill --from=2026-08-01 --to=2026-08-14 --circuit=3 --court=119 --dry-run
pnpm federal:backfill --from=2026-08-01 --to=2026-08-14 --circuit=3
```

Federal recorre el calendario oficial y sólo consulta fechas habilitadas; sin `--court`, procesa secuencialmente el circuito. El modo `dry-run` normaliza y reporta sin persistir. La salida operativa omite nombres de partes.
