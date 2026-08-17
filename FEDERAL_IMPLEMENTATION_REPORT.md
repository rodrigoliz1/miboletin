# Informe de implementación federal

## 1. Resultado

Se implementó el recorrido real `PJF -> ingestión -> PostgreSQL/Neon -> matching -> alerta -> UI` para dos clases de publicación distintas:

1. autos y acuerdos por expediente federal;
2. listado a sesión y resultado/sentido para órganos que sesionan.

La ficha y el dashboard separan visualmente ambos flujos. El alta ya no espera al rastreo histórico y los acuerdos disponibles pueden aparecer mientras continúa la comprobación de calendarios.

## 2. Fuentes

Se usan la ficha pública `Reportes/VerCaptura.aspx`, la síntesis `Actuaria/VerAcuerdo.aspx` y la aplicación pública de listas a sesión enlazada por el OAJ. La búsqueda general de acuerdos con reCAPTCHA no se automatiza ni se evade.

Los endpoints, parámetros, tipos oficiales y pruebas están documentados en `docs/FEDERAL-SOURCE-RESEARCH.md`.

## 3. Cobertura de órganos

El catálogo combina `TipoOrgano=1` y `TipoOrgano=2` en los 32 circuitos. Incluye juzgados de distrito y demás órganos federales para acuerdos, además de tribunales colegiados, tribunales colegiados de apelación y plenos regionales para acuerdos y sesiones.

Cada alta conserva circuito, ID oficial, nombre y tipo de órgano. Una migración retroactiva clasificó los órganos federales existentes y liberó revisiones que habían quedado en `CHECKING`.

## 4. Acuerdos por expediente

El provider traduce el tipo seleccionado a su ID SISE confirmado, solicita la ficha exacta y valida órgano/tipo. Extrae todas las filas de `#grvAcuerdos`, fecha del auto, fecha de publicación, cuaderno, resumen, NEUN y URL individual de síntesis. Una respuesta explícita de “no existe” se distingue de una página rota o un cambio de contrato.

## 5. Sesiones

Si la ficha ya contiene `Fecha lista asunto para resolución`, `Fecha sesión`, `Resultado sesión` o `Sentido sentencia`, esos datos se persisten inmediatamente. Para órganos de sesión continúa la comprobación histórica de calendarios `lista` y `sesion`, ordinarios y extraordinarios. Se procesan primero las fechas recientes y se registran las fechas ya comprobadas.

## 6. Persistencia y rendimiento

Las publicaciones se clasifican como `AGREEMENT`, `SESSION_LISTED` o `SESSION_RESULT`. Se conservaron snapshots HTML, método GET/POST correcto, hashes, versiones y URL. El store reutiliza órgano, asunto, snapshot y candidatos dentro de una corrida y agrupa el alta de movimientos/alertas, evitando una consulta por usuario y publicación.

El alta HTTP sólo guarda el asunto y encola la revisión. Durante el sondeo, un aumento de movimientos refresca la ficha antes de que termine el backfill. En una corrida real nueva de tres publicaciones federales, la ingestión y notificación tardó 9.3 s; las publicaciones ya conocidas se deduplican.

## 7. Matching y notificaciones

El matching exige jurisdicción, provider, ID oficial de órgano, número normalizado y tipo. Se generan asuntos de notificación específicos:

- `Nuevo acuerdo federal`;
- `Asunto federal listado para sesión`;
- `Resultado de sesión federal`.

La UI muestra la fecha de listado, la fecha programada, resultado, sentido de sentencia y enlace oficial. Duplicados históricos equivalentes se agrupan visualmente.

## 8. Comprobaciones reales

- `119 / Amparo Directo 461/2024`: cinco acuerdos, listado `2026-08-07`, sesión `2026-08-14`, resultado `Aprobado`, sentido `No ampara`.
- `16 / Amparo en revisión 138/2026`: diez acuerdos, listado `2026-07-01`, sesión `2026-07-07`, resultado `Aprobado`; se persistieron 12 publicaciones, 12 coincidencias y 12 alertas.
- `128 / Amparo en revisión 138/2026`: tres publicaciones nuevas persistidas, vinculadas y notificadas en 9.3 s.

## 9. Validación

- `pnpm typecheck`: aprobado.
- `pnpm lint`: aprobado con cero warnings.
- `pnpm test`: 26 pruebas aprobadas; contratos live omitidos por defecto.
- `LIVE_SOURCE_TESTS=1 pnpm test -- tests/source-contract.live.test.ts`: 34 pruebas aprobadas contra fuentes reales.
- `pnpm build`: compilación de producción aprobada.
- Playwright: 4/4 flujos aprobados en Chromium desktop y móvil, incluidos acuerdos, listado, resultado y sentido federal.
- Inspección visual: ficha federal revisada en 1440 px y 412 px; autos y sesiones mantienen jerarquía, legibilidad y navegación oficial.

## 10. Operación

```bash
pnpm db:migrate
pnpm dev
pnpm ingest:federal --mode=agreement --court=119 --circuit=3 --case=461/2024 --type="Amparo Directo" --dry-run
pnpm federal:backfill --from=2026-08-07 --to=2026-08-14 --circuit=3 --court=119 --dry-run
pnpm monitor:daily
```

`monitor:daily` ahora consulta cada expediente federal activo para acuerdos y, si el tipo de órgano corresponde, verifica también sus listas/sesiones.

## 11. Límites honestos

No se accede al expediente electrónico autenticado ni a documentos privados. Los extractos pueden estar abreviados en la tabla oficial; el usuario dispone del vínculo a la síntesis oficial completa. Los endpoints HTML no son una API pública versionada, por lo que existen detección de CAPTCHA/schema drift, estados degradados y pruebas de contrato.

## 12. Estado

**OPERATIVO PARA PRUEBAS REALES Y DESPLIEGUE, sujeto a configurar el worker/cron de producción y supervisar cambios de la fuente oficial.**
