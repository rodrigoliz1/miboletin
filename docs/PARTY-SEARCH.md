# Índice judicial por nombre

## Arquitectura

La búsqueda no consulta por nombre a CJJ, SISE ni STJ durante la petición del usuario. Se construye progresivamente sobre PostgreSQL:

```text
fuente oficial → source_snapshot → extractor determinista → case_parties
                                                       ↘ case_party_mentions
expediente de Sala → datos de origen → case_relations
índice PostgreSQL → ranking → /api/search/parties → /search/names
```

`case_parties` representa la identidad procesal consolidada dentro de un expediente y rol. `case_party_mentions` conserva cada evidencia original: publicación, snapshot, método, fecha, URL, versión y confianza. `token_signature` permite comparar el mismo conjunto de palabras en distinto orden sin alterar `name_raw`. El texto oficial nunca se reemplaza por la forma normalizada.

## Extracción

- `jalisco-cjj`: usa `act_names` y `dem_names` de `raw_payload`. El parser reconoce sufijos societarios y no usa un `split(',')` ingenuo. Las cadenas ambiguas se conservan juntas con menor confianza.
- `federal-pjf-session-lists`: prefiere campos estructurados (`complainant`, `authority` y equivalentes), después filas HTML etiquetadas y finalmente reglas explícitas sobre el extracto. Los valores anonimizados y menciones a juzgadores, secretarios o abogados no se indexan como partes.
- `jalisco-stj-chambers`: los Tocas se enlazan con `APPEAL_OF` sólo cuando número de origen, órgano y materia producen un único expediente local. Si hay varios candidatos no se crea relación.

El extractor no usa modelos externos ni requiere nuevas variables de entorno. La versión actual del parser queda registrada en cada mención para permitir reproceso.

## Normalización y ranking

La forma de búsqueda elimina diferencias de Unicode, acentos, puntuación y mayúsculas. Las personas morales generan además una forma simplificada sin sufijos como `S.A. DE C.V.`; el nombre oficial se conserva intacto.

El ranking combina, en este orden, igualdad normalizada, firma exacta de tokens, forma societaria, prefijo, trigramas y similitud por palabra. El conjunto candidato sale de `case_parties` y sus índices B-tree/GIN; la evidencia se obtiene después mediante un `LATERAL`, evitando unir y escanear todas las menciones para cada consulta. Un asunto relacionado recibe una penalización y se identifica expresamente como tal. La búsqueda está paginada y admite jurisdicción, proveedor, órgano, materia, tipo de parte, rol, fechas y resultado directo/relacionado.

## Cobertura comprobable

`judicial_source_catalog` conserva el inventario de órganos observado en los catálogos oficiales. `judicial_source_coverage` registra cada unidad `fuente + órgano + fecha + recurso`, incluso cuando la respuesta oficial contiene cero publicaciones. Conserva las cuatro etapas (discovery, fetch, parse e indexación), conteos, intentos, error y siguiente reintento.

Una fecha mínima y máxima no representa continuidad. La API y la interfaz devuelven por separado órganos con información, unidades completas, unidades pendientes/fallidas y limitaciones técnicas. El estado general permanece `PARTIAL` mientras exista backfill pendiente; STJ se presenta como no enumerable porque su portal de acuerdos requiere una toca y Sala concretas.

`judicial_index_anomalies` registra regresiones evidentes, por ejemplo diez o más publicaciones locales con cero nombres. Administración permite filtrar órganos y programar un periodo; estas acciones están limitadas a `OWNER`/`ADMIN`.

## Búsqueda ampliada

Un cero con cobertura parcial crea un `judicial_deep_search_job`. La petición inicial no queda abierta durante minutos: devuelve el trabajo, la interfaz avanza un lote pequeño y el cron continúa los pendientes. El cursor es persistente, las unidades ya completas se reutilizan y los resultados pasan por el mismo pipeline global, por lo que quedan disponibles para todos los usuarios sin mezclar sus carpetas.

La ampliación automática sólo enumera fuentes que técnicamente lo permiten. CJJ ofrece boletín por órgano/fecha. STJ no ofrece enumeración global de tocas y las listas federales no publican uniformemente nombres de partes; esas limitaciones se muestran expresamente en vez de convertirlas en un falso “sin resultados”.

## Índice global y vigilancia

`judicial_cases` contiene el universo descubierto por las fuentes; no implica que un cliente vigile el asunto. `monitored_cases` y las relaciones de carpeta son la única capa de seguimiento. Si un usuario agrega un asunto que ya existe, la llave canónica de autoridad, órgano, tipo y número reutiliza el mismo `judicial_case`.

La consulta del usuario siempre resuelve primero en PostgreSQL. No lanza un barrido remoto por cada nombre. El índice se amplía mediante un job independiente y los resultados válidos se conservan:

```bash
# Sólo lectura por defecto
pnpm index:global -- --provider=jalisco-cjj --from=2026-08-01 --to=2026-08-19 --max-units=25
pnpm index:global -- --provider=federal-pjf-session-lists --from=2026-08-01 --to=2026-08-19 --circuit=3 --max-units=25

# Persistir y continuar el checkpoint más reciente incompleto
pnpm index:global -- --provider=jalisco-cjj --from=2026-08-01 --to=2026-08-19 --apply --max-units=250
pnpm index:global -- --provider=jalisco-cjj --apply --resume=latest --max-units=250
```

`--resume=latest` sólo reanuda una corrida incompleta que coincida exactamente con proveedor, rango, órgano, circuito y segmento solicitados. Así, una corrida histórica pendiente nunca secuestra la indexación del día actual. `--shard=1/4` divide de forma determinista el catálogo para ejecutar segmentos independientes; `--max-minutes` deja un margen seguro antes del límite del runner y `--max-consecutive-failures` abre el cortacircuitos cuando la fuente está caída. Las unidades con cobertura `COMPLETE` se omiten automáticamente; `--force-covered` permite reprocesarlas de manera explícita.

El proceso CJJ recorre fecha y órgano del catálogo oficial, conserva `EXP`, resolución y `act_names`/`dem_names`. El federal recorre calendarios y listas públicas por circuito, órgano, fecha y modalidad, conservando `complainant`/`authority`. Ambos son idempotentes, escriben un cursor en `global_index_runs` y pueden limitarse por `--court`, `--circuit`, `--shard`, `--max-units` y `--max-minutes`. El workflow `.github/workflows/global-index.yml` ejecuta el índice cotidiano separado de la vigilancia de clientes; el backfill histórico se opera manualmente por lotes.

## Backfill de extracción

El comando es de sólo lectura por defecto:

```bash
pnpm parties:backfill
pnpm parties:backfill -- --provider=jalisco-cjj --from=2026-01-01 --to=2026-12-31
pnpm parties:backfill -- --provider=federal-pjf-session-lists --case-id=UUID
```

Para persistir:

```bash
pnpm parties:backfill -- --apply
```

Opciones:

- `--provider`: `jalisco-cjj`, `federal-pjf-session-lists` o `jalisco-stj-chambers`.
- `--batch`: 1–1000; predeterminado 100.
- `--from` / `--to`: rango de fechas de publicación.
- `--case-id`: un expediente interno.
- `--resume=JOB_ID`: continúa desde el último UUID procesado.
- `--reprocess`: vuelve a ejecutar el parser; los índices únicos impiden duplicar identidades, menciones y relaciones.
- `--apply`: escribe. Sin esta opción siempre es `dry-run`.

Las métricas y el cursor se guardan en `party_extraction_runs`; `party_extraction_records` registra también las publicaciones válidamente procesadas sin candidatos, para no reprocesarlas indefinidamente. Si el formato de CJJ devuelve diez o más publicaciones sin ninguna parte, la ingesta registra `PARTY_EXTRACTION_DEGRADED` en `domain_events`.

## Vigilancia por nombre

Desde `/search/names` una persona puede crear una regla `PERSON` o `COMPANY`. Cada mención nueva se compara una vez; `watch_rule_matches` y sus índices únicos evitan alertas duplicadas. Las reglas son privadas del usuario y los endpoints verifican sesión, suscripción y origen.

## Confianza y depuración

- `0.95–1.00`: campo estructurado o HTML etiquetado.
- `0.70–0.94`: regla conservadora o cadena con ambigüedad limitada.
- Menor a `0.70`: evidencia conservada para auditoría; no debe presentarse como identidad inequívoca.

La ficha `/search/names/[caseId]` muestra identidades, menciones, resoluciones y relaciones. Para ampliar un proveedor, agrega reglas al extractor correspondiente y aumenta su versión antes de reprocesar.

## Diagnóstico federal

La ficha `VerCaptura.aspx` se valida contra tipo de asunto, órgano y número solicitados antes de aceptarse. El parser inspecciona los campos estructurados de listas, etiquetas de la ficha y bloques de detalle del historial; no convierte prosa genérica ni valores anonimizados en identidades.

```bash
pnpm federal:diagnose -- --case-id=UUID
pnpm federal:diagnose -- --case=123/2026 --court=119 --type="Amparo Directo" --live
```

El diagnóstico sólo imprime métricas y estado (`PARTIES_FOUND`, `NO_PUBLIC_PARTIES`, `PARSER_FAILED`, `SOURCE_FAILED`, `DETAIL_NOT_FETCHED`, `DETAIL_UNAVAILABLE` o `DETAIL_INVALID`), nunca nombres. La administración muestra fechas extremas, casos, publicaciones, capturas, partes y tasa de extracción por fuente. Esas fechas no prometen continuidad: el backfill puede estar todavía cubriendo periodos intermedios.

## Operación

```bash
# Sincronizar catálogos oficiales y revisar cobertura
pnpm judicial:catalogs:sync
pnpm judicial:index:status
pnpm judicial:index:status -- --provider=jalisco-cjj --all-courts

# Backfill en seco y aplicación acotada/resumible
pnpm judicial:backfill -- --provider=jalisco-cjj --from=2026-01-01 --to=2026-01-31 --max-units=25
pnpm judicial:backfill -- --provider=jalisco-cjj --from=2026-01-01 --to=2026-01-31 --apply --max-units=250
pnpm judicial:backfill -- --provider=jalisco-cjj --from=2026-01-01 --to=2026-01-31 --apply --resume=latest --max-units=250

# Continuar trabajos solicitados desde búsqueda/Administración
pnpm judicial:deep-worker -- --jobs=4 --units=40

# Reprocesar documentos ya almacenados con la versión actual del parser
pnpm judicial:reindex -- --provider=jalisco-cjj --from=2026-01-01 --to=2026-01-31
pnpm judicial:reindex -- --provider=jalisco-cjj --from=2026-01-01 --to=2026-01-31 --apply --reprocess

# Auditoría forense A→F y consulta diagnóstica del índice
pnpm judicial:audit -- --provider=jalisco-cjj --court=M05 --from=2026-08-21 --to=2026-08-21 --name="Josefina Fuentes Corral"
pnpm judicial:search -- --name="CONTRERAS VILLEGAS, MARIA ELENA"
```
