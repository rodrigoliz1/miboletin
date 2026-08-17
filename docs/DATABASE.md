# Base de datos

La migración `001_initial.sql` crea el modelo canónico en PostgreSQL y habilita `pg_trgm` y `unaccent`. `002_product_monitoring.sql` agrega carpetas, estado de revisión, campos de snapshot por órgano/fecha y detalle de listas a sesión federales.

## Llaves y cardinalidad

- Un authority tiene muchos circuitos, distritos y órganos.
- Un expediente pertenece a un órgano y usa `jurisdicción:provider:órgano:tipo:número:año` como llave global.
- Una publicación referencia exactamente un snapshot inmutable.
- `monitored_cases` pertenece a un usuario o a una organización, nunca a ambos.
- Un movimiento enlaza una publicación con un asunto vigilado y conserva el resultado del matching.

## Idempotencia

- Snapshot: SHA-256 único del payload estable.
- Expediente: `canonical_key` único.
- Publicación: `(court_id, content_hash)` único.
- Movimiento: `(monitored_case_id, publication_id)` único.
- Notificación: `(movement_id, user_id, channel)` único.

## Búsqueda

El texto oficial usa `to_tsvector('spanish', official_text)` con GIN. Partes y órganos usan trigram para variantes controladas. Número, órgano y fecha usan índices B-tree compuestos.

## Retención

Los snapshots oficiales son inmutables durante el plazo operativo configurado. La cuenta puede eliminarse sin borrar automáticamente la evidencia oficial compartida; se eliminan memberships, reglas privadas y relaciones de vigilancia según política y obligación aplicable.
