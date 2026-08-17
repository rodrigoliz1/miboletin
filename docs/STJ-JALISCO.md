# Integración de Salas del STJ Jalisco

Verificación técnica: **17 de agosto de 2026**, hora de Guadalajara.

## Alcance implementado

- Catálogo de once Salas con IDs oficiales `1` a `11`.
- Búsqueda histórica por Sala + Toca, sin fecha inicial solicitada al usuario.
- Paginación limitada a 30 páginas por consulta y matching exacto del Toca normalizado.
- Persistencia idempotente de acuerdos, campos de origen, snapshot y hashes.
- Alta desde `/cases/new`, consulta previa desde `/search`, visualización en `/cases/[id]` y actualización por el worker diario.
- Detección determinista de indicios de sentencia y ciclo `NOT_EXPECTED`, `PENDING_PUBLICATION`, `AVAILABLE`, `PARTIAL`, `NOT_FOUND`, `UNAVAILABLE`, `ERROR`.
- Cola diferida con backoff; un fallo del portal de sentencias no invalida acuerdos ya verificados.
- Validación de documentos por HTTPS, código HTTP, tipo MIME, tamaño máximo de 25 MB, firma `%PDF-` y SHA-256.
- Todos los registros exactos que devuelva la combinación Sala + Toca se conservan como documentos independientes. Una aclaración sólo se etiqueta como tal cuando la fuente lo identifica; los archivos ambiguos se presentan como “Documento oficial N de M”.
- Una copia física por hash en Vercel Blob privado; `judicial_documents` conserva metadatos, secuencia y `storage_key`. El acceso ocurre únicamente por `/api/documents/[id]` después de validar sesión, suscripción y pertenencia del asunto a la organización.

## Contrato del portal de acuerdos

La forma oficial usa:

- `data[Acuerdos][sala_id]`
- `data[Acuerdos][metodo_busqueda]=0` para Toca
- `data[Acuerdos][busqueda]=N/AAAA`

Después de la primera consulta, el portal expone una ruta GET reproducible:

```text
/consultas/acuerdos/page:1/sala:{SALA}/search_value:{NUMERO.ANIO}/m:0
```

El parser exige la tabla `.resultados`, diez columnas y fechas `DD/MM/AAAA`. No considera válido un HTML genérico, challenge o tabla con menos columnas.

## Regla de sentencia

`DECISION` se reserva para expresiones fuertes: “se dicta sentencia”, “sentencia definitiva”, “resolución definitiva”, “se emite sentencia”, “fallo definitivo”, “engrose”, “ejecutoria” o “se resuelve el recurso”. Una simple cita “para sentencia” queda como `PENDING`; no afirma que el fallo ya exista.

El correo sí se genera cuando cualquier publicación contiene la palabra completa “sentencia”, conforme a la política comercial solicitada. La clasificación documental y la política de correo son deliberadamente distintas.

## Restricción del portal de sentencias

La SPA oficial consume `https://publica-sentencias-backend.stjjalisco.gob.mx`. Sus catálogos son públicos, pero la búsqueda `/tocas` exige un token reCAPTCHA v3 emitido durante la interacción en el dominio oficial. El archivo usa otro token para `toca/{id}/file`.

El producto no intenta generar, comprar, resolver o reutilizar tokens. Registra `UNAVAILABLE`, conserva la razón y enlaza al portal. `UNAVAILABLE` nunca significa que la sentencia no exista.

La búsqueda de acuerdos normaliza internamente el formato con diagonal (`93/2026`). La búsqueda oficial de sentencias separa número y año conforme al formato visual con guion (`93-2026`) y siempre exige coincidencia exacta de Sala, número y periodo.

## Operación

Consulta real de prueba, sin escritura:

```bash
pnpm ingest:stj --court=5 --case=125/2026 --dry-run
LIVE_SOURCE_TESTS=1 pnpm test -- tests/source-contract.live.test.ts
```

La vigilancia normal se ejecuta con:

```bash
pnpm monitor:daily
```

Las tablas relevantes son `stj_case_details`, `judicial_documents` y `document_retrieval_attempts`. En producción se requiere un Blob privado conectado al proyecto mediante `BLOB_READ_WRITE_TOKEN`; en localhost se usa `.data/judicial-documents` o `JUDICIAL_DOCUMENTS_DIR`. Nunca borrar un `judicial_document` para ocultarlo a un usuario: la autorización se deriva de `monitored_cases` y la pertenencia a la organización.
