# Monitoreo federal

## Fuentes oficiales

La integración usa exclusivamente páginas públicas del Poder Judicial de la Federación:

- ficha SISE del expediente: `https://www.dgej.cjf.gob.mx/SiseInternet/Reportes/VerCaptura.aspx`;
- síntesis individual: `https://www.dgej.cjf.gob.mx/SiseInternet/Actuaria/VerAcuerdo.aspx`;
- listas a sesión enlazadas por la Dirección General de Gestión Judicial del OAJ: `https://www.oaj.gob.mx/micrositios/dggj/paginas/serviciosTramites.htm?pageName=servicios%2FlistaSesion.htm`.

La búsqueda general de acuerdos presenta reCAPTCHA y no se automatiza. La ficha pública directa, a la que enlazan los resultados oficiales cuando se conoce órgano, tipo y expediente, respondió sin autenticación ni challenge. El provider detecta CAPTCHA y aborta si la autoridad cambia ese comportamiento.

## Información recuperada

La ficha del expediente entrega todos los extractos publicados, fecha del auto, fecha de publicación, tipo de cuaderno, NEUN y vínculo a la síntesis oficial completa. Cuando el asunto ya pasó por sesión también expone fecha de listado, fecha de sesión, resultado y sentido de sentencia.

Para órganos colegiados, de apelación y plenos regionales se conserva además la verificación histórica de los calendarios y tablas de `lista` y `sesion`, incluidas sesiones ordinarias y extraordinarias. Los juzgados de distrito y demás órganos sin calendario de sesión sólo ejecutan la consulta de acuerdos.

No se obtiene el expediente electrónico, promociones privadas, documentos autenticados ni notificaciones procesales.

## Catálogo

Por cada uno de los 32 circuitos se combinan los catálogos oficiales `TipoOrgano=1` y `TipoOrgano=2`. Así, el selector incluye juzgados de distrito, tribunales laborales y centros federales, tribunales colegiados, tribunales colegiados de apelación y plenos regionales. Se conserva el ID oficial del órgano; no se sustituye por su nombre.

## Alta y actualización

El alta se confirma después de guardar el asunto, sin esperar a la fuente. En segundo plano se consulta primero la ficha directa: los acuerdos y los datos de sesión disponibles se persisten juntos y aparecen durante el mismo refresco. El calendario histórico colegiado continúa como comprobación complementaria y procesa primero las fechas recientes.

Al abrir o refrescar la ficha se aplica un enfriamiento de 60 segundos. En producción, `pnpm monitor:daily` debe programarse varias veces al día en `America/Mexico_City`.

## Matching, evidencia y alertas

La coincidencia automática exige `provider + courtExternalId + caseNumberNormalized + caseType`. Cada respuesta conserva HTML, URL, método, hora de recuperación, versiones del parser/provider y SHA-256. Hay avisos in-app distintos para nuevo acuerdo federal, listado para sesión y resultado de sesión.

Ante timeout, 429 o 5xx se reintenta con backoff. CAPTCHA, cambio de columnas y respuestas ambiguas degradan la fuente explícitamente y nunca se convierten en “sin movimientos”.

## Prueba manual controlada

```bash
pnpm db:migrate
LIVE_SOURCE_TESTS=1 pnpm test -- tests/source-contract.live.test.ts
pnpm dev
```

En la UI: Federal, Tercer Circuito, órgano `119`, `Amparo Directo`, expediente `461/2024`. La ficha pública oficial devuelve cinco acuerdos, listado del 7 de agosto de 2026, sesión del 14 de agosto de 2026, resultado aprobado y sentido “No ampara”.

Para una comprobación de calendario:

```bash
pnpm federal:backfill --from=2026-08-07 --to=2026-08-14 --circuit=3 --court=119 --dry-run
```
