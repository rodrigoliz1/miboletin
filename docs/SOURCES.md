# Fuentes oficiales verificadas

Fecha de verificación: **14 de agosto de 2026**, zona `America/Mexico_City`.

## Consejo de la Judicatura del Estado de Jalisco

| Campo | Detalle |
|---|---|
| Institución | Consejo de la Judicatura del Estado de Jalisco |
| Portal | `https://cjj.gob.mx/bulletin` |
| Finalidad | Boletín Judicial, extractos de Ciudad Judicial y accesos a foráneos, penales y laborales |
| Método | SPA Angular que consume JSON público por XHR |
| Protocolo | HTTPS, GET |
| API base comprobada | `https://api.cjj.gob.mx` |
| Catálogos | `zm_judges` (51), `foraneos_judges` (47), `labor_judges` (30), `puente_grande_judges` (16), `penal_oral_judges` (50) |
| Publicaciones ZM | `/bulletin/zmg_date?judged={courtId}&date={YYYY-MM-DD}&url=bulletin/zmg_date` |
| Expediente ZM | `/bulletin/zmg_expedient?judged={courtId}&expedient={N/Y}&url=bulletin/zmg_expedient` |
| Erratas ZM | `/bulletin/zmg_fe?judged={courtId}&date={YYYY-MM-DD}&url=bulletin/zmg_fe` |
| Foráneos implementados | `forean_date`, `forean_expedient`, `forean_fe`, `foraneos_judges` bajo `/bulletin/` |
| Penal implementado | `penal_date`, `penal_expedient`, `penal_oral_date`, `penal_oral_expedient`, `penal_oral_judges`, `puente_grande_judges` |
| Laboral implementado | catálogo `labor_judges`; consultas mediante la familia `forean_*`, según el cliente oficial |
| Respuesta | `{ success: number, data: array }` |
| Campos ZM | `EXP`, `CVE_JUZ`, `FCH_ACU`, `BOLETIN`, `TIPO`, `DESCRIP`, `act_names`, `dem_names` |
| Frecuencia | Publicación en días hábiles; el job recomendado corre 08:30, 10:30 y 16:30 |
| Restricciones | Datos personales públicos sensibles; baja concurrencia, retención controlada y User-Agent identificable |
| Estrategia | JSON -> snapshot SHA-256 -> Zod -> normalización -> upsert |
| Alternativa | HTML público del portal sólo para diagnóstico; no OCR |
| Fiabilidad | Alta para las cinco familias mientras el contrato JSON valide |

Prueba real efectuada: 194 identificadores únicos y consultas por expediente en las cinco familias: `C01 / 11/2026`, `AH1 / 76/2025`, `L03 / 23/2023`, `09P / 335/2005-D-S-A` y `D14 / 10214/2024`. El raw real no se incorpora al repositorio.

El directorio interactivo `https://cjj.gob.mx/directory` expone 270 entradas distribuidas en 24 grupos. Como conserva denominaciones anteriores en algunos apartados, la aplicación lo concilia con el directorio institucional publicado en febrero de 2026 y con los catálogos vivos. En la interfaz se distingue expresamente entre “aparece en directorio” y “tiene búsqueda de expediente”.

Nota de fecha: el portal público consulta el endpoint con el día previo a la fecha visible de publicación. El provider reproduce esa semántica y conserva por separado `publicationDate`, `agreementDate` y `retrievedAt`.

## Poder Judicial de la Federación

| Campo | Detalle |
|---|---|
| Institución | Poder Judicial de la Federación / Órgano de Administración Judicial |
| Micrositio | `https://www.oaj.gob.mx/micrositios/dggj/paginas/serviciosTramites.htm?pageName=servicios%2FlistaSesion.htm` |
| Aplicación enlazada | `https://www.dgej.cjf.gob.mx/SiseInternet/Reportes/ListaSesion/default.aspx` |
| Finalidad | Listas a sesión y resultados de sesión de órganos federales colegiados |
| Método | XHR/POST público usado por el frontend oficial |
| Parámetros | circuito; órgano; año/mes; fecha; `TipoFiltro=lista|sesion`; sesión ordinaria/extraordinaria |
| Formato | JSON para circuitos y HTML estructurado para órganos, calendario y reporte |
| Cobertura comprobada | 32 circuitos; órganos presentes en el catálogo vivo de esta aplicación |
| Restricciones | Sin autenticación ni CAPTCHA en la verificación; baja concurrencia y detección preventiva de challenge |
| Estrategia | Calendario por órgano -> lista completa -> snapshot HTML -> validación -> normalización -> matching local |
| Fiabilidad | Alta en la prueba viva; endpoints oficiales no documentados como API estable, protegidos por contract tests |

Prueba real: Tercer Circuito, órgano `119`, lista ordinaria de `2026-08-07`: 48 registros. No se conservaron nombres de partes en fixtures.

La **búsqueda de acuerdos SISE** (`/SiseInternet/consulta/busquedaacuerdos.aspx`) es otra fuente y exige reCAPTCHA; no se automatiza. El provider nunca resuelve, externaliza ni evade el CAPTCHA. Los servicios de expediente electrónico requieren autenticación legítima y también quedan fuera del producto base.

## Segunda instancia de Jalisco

El portal del Supremo Tribunal de Justicia (`https://stjjalisco.gob.mx/`) fue identificado como fuente institucional separada. En esta ejecución no se comprobó un endpoint estructurado de segunda instancia con contrato estable, por lo que no se declara cobertura y no se inventa un colector.
