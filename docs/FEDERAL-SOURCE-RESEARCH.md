# Investigación de fuentes federales

Verificación técnica: **15 de agosto de 2026**, zona `America/Mexico_City`.

## Sistemas revisados

Se inspeccionaron el micrositio de la Dirección General de Gestión Judicial del OAJ, SISE Internet (búsqueda de acuerdos, ficha pública, síntesis y lista de sesión), el expediente electrónico autenticado y directorios institucionales. No se usaron agregadores privados.

## Endpoints oficiales seleccionados

| Ruta | Método / parámetros relevantes | Auth | CAPTCHA observado | Uso |
|---|---|---:|---:|---|
| `/SiseInternet/Reportes/VerCaptura.aspx` | GET `expediente`, `organismo`, `tipoasunto`, `tipoprocedimiento=0` | No | No | Historial de extractos y datos del asunto/sesión |
| `/SiseInternet/Actuaria/VerAcuerdo.aspx` | GET identificadores publicados por `DoVerAcuerdo` | No | No | Síntesis oficial individual |
| `/SiseInternet/Reportes/ListaSesion/ObtenerTiposOrgano.ashx` | POST form `TipoId=1` | No | No | Circuitos |
| `/SiseInternet/Controles/ComboOrganismo.aspx` | POST JSON `Circuito`, `Llamada=0`, `TipoOrgano=1|2` | No | No | Todos los órganos y órganos de sesión |
| `/SiseInternet/Controles/ucCalendario.aspx` | POST JSON año, mes, órgano, `lista|sesion` | No | No | Fechas publicadas |
| `/SiseInternet/Reportes/ListaSesion/ReporteSesion.aspx` | POST JSON fecha, órgano, filtro y sesión ordinaria/extraordinaria | No | No | Listados y resultados completos |
| `/SiseInternet/consulta/busquedaacuerdos.aspx` | POST WebForms | No | **Sí** | Descartado para automatización |

Base SISE: `https://www.dgej.cjf.gob.mx`. Página institucional de sesiones: `https://www.oaj.gob.mx/micrositios/dggj/paginas/serviciosTramites.htm?pageName=servicios%2FlistaSesion.htm`.

## Razón de legitimidad

No se resolvió ni eludió reCAPTCHA. La ficha `VerCaptura.aspx` y `VerAcuerdo.aspx` son documentos públicos oficiales enlazados desde los resultados de SISE y accesibles con los identificadores exactos suministrados por el usuario/catálogo. La app no hace búsqueda masiva de personas ni fuerza rangos de identificadores: consulta únicamente el expediente vigilado y un tipo de asunto previamente seleccionado.

## Contratos observados

`VerCaptura` confirma órgano y tipo en `#lblNombreOrgano`. `#grvAcuerdos` contiene número, fecha del auto, cuaderno, fecha de publicación, resumen y una llamada `DoVerAcuerdo` con NEUN y parámetros para la síntesis. Si la combinación no existe, la página declara expresamente que el número de expediente no existe para ese órgano y tipo.

Los bloques de datos generales pueden contener `Fecha lista asunto para resolución`, `Fecha sesión`, `Resultado sesión` y `Sentido sentencia`. Se procesan como publicaciones de sesión separadas de los acuerdos.

IDs de tipos confirmados en la fuente: Amparo Indirecto `1`, Procesos Civiles o Administrativos `4`, Amparo Directo `10`, Amparo en revisión `11`, Conflictos Competenciales `12`, Queja `15`, Reclamaciones `20` e Inconformidades `25`.

## Pruebas controladas

- Órgano `119`, Amparo Directo `461/2024`: cinco acuerdos; listado `2026-08-07`; sesión `2026-08-14`; resultado `Aprobado`; sentido `No ampara`.
- Órgano `16`, Amparo en revisión `138/2026`: diez acuerdos; listado `2026-07-01`; sesión `2026-07-07`; resultado `Aprobado`.
- Lista de sesión del órgano `119` en `2026-08-07`: al menos 40 filas en el contrato vivo.

## Riesgos y fallback

Los endpoints son oficiales pero no una API pública versionada; HTML, IDs o nomenclatura pueden cambiar. Una tabla rota no se trata como cero resultados. Ante challenge, drift o indisponibilidad se conserva el histórico, se marca el estado operativo y se ofrece el vínculo oficial. Las revisiones de contenido generan evidencia por hash; no se introducen mocks como sustituto.
