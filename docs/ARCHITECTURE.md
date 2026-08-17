# Arquitectura

## Límites del sistema

El producto se divide en cinco capas:

1. Providers oficiales: descubren, consultan, validan y normalizan una autoridad.
2. Pipeline: `DISCOVER -> FETCH -> SNAPSHOT -> PARSE -> VALIDATE -> NORMALIZE -> DEDUPLICATE -> STORE -> MATCH -> NOTIFY`.
3. Dominio: llave canónica, matching, eventos y estados de confiabilidad.
4. Persistencia PostgreSQL: datos normalizados, snapshots inmutables y auditoría multi-tenant.
5. Next.js: interfaz, sesiones, autorización server-side y endpoints operativos.

`JudicialSourceProvider` evita que la aplicación dependa de una URL concreta. Cada provider expone `discover`, `healthCheck`, `fetchCatalogs`, `fetchPublications`, `fetchCase`, `fetchByDate`, `normalize` y `validate` según sus capacidades.

## Workers

Los colectores viven fuera del ciclo de render de Next.js. Los scripts CLI pueden ejecutarse en un worker de Render, una máquina virtual o un contenedor persistente. Un cron externo llama al worker o al endpoint protegido. La ingestión crítica no depende de la duración máxima de Vercel.

## Escala

- Publicaciones por fecha y órgano con índice compuesto.
- Búsqueda oficial por FTS en español y partes/órganos por trigram.
- Deduplicación por hash y constraints naturales.
- Procesamiento por lotes por órgano y fecha.
- Cursor en las vistas históricas; nunca se envían millones de filas al navegador.

## Estados de confiabilidad

`ONLINE`, `DEGRADED`, `FAILED`, `STALE` y `UNAVAILABLE` se mantienen separados del resultado judicial. El sistema sólo afirma “sin movimientos” después de una ejecución exitosa y dentro del umbral esperado de la fuente.
