# Verificación viva de fuentes

Ejecución reproducible efectuada el **14 de agosto de 2026** desde `America/Mexico_City`. El repositorio no conserva nombres ni textos obtenidos en la prueba.

## Jalisco

- Provider: `jalisco-cjj`.
- Portal oficial: `https://cjj.gob.mx/bulletin`.
- Catálogo: 51 órganos estructurados, estado `ONLINE`, 304 ms en la corrida registrada.
- Contrato vivo: aprobado contra `C01`, fecha visible `2026-08-13`.
- Ingestión `dry-run`: 56 registros obtenidos y normalizados en 455 ms, cero errores.
- Muestra técnica anonimizada: expediente normalizado `1/2022`, fecha de publicación `2026-08-13`, fecha de acuerdo `2026-08-12`.
- `contentHash`: `3ae7e65c2ba72a13cacbc61a5a797af7479131583794d375618405d081fa295b`.
- `snapshotHash`: `0b099cce0218f26f9f927d9d5601f295acaea378c23253c0f377daf473b6dfba`.
- Parser: `jalisco-json-1`.

## Federal

- Provider: `federal-pjf-session-lists`.
- Portal oficial: `https://www.oaj.gob.mx/micrositios/dggj/paginas/serviciosTramites.htm?pageName=servicios%2FlistaSesion.htm`.
- Aplicación enlazada: `https://www.dgej.cjf.gob.mx/SiseInternet/Reportes/ListaSesion/default.aspx`.
- Catálogo: 32 circuitos; el Tercer Circuito entregó 25 órganos publicadores en la corrida.
- Contrato vivo: órgano `119`, lista ordinaria de `2026-08-07`, aprobado con 48 filas reales y sesión programada `2026-08-14` en la muestra técnica.
- CAPTCHA: no aparece en listas a sesión. La búsqueda distinta de acuerdos SISE sí lo exige y queda fuera de cobertura.

## Repetición

```bash
LIVE_SOURCE_TESTS=1 pnpm test -- tests/source-contract.live.test.ts
pnpm health:sources
pnpm ingest:jalisco --date=2026-08-13 --court=C01 --dry-run
pnpm federal:backfill --from=2026-08-07 --to=2026-08-07 --circuit=3 --court=119 --dry-run
```

Use `--verbose` únicamente en un entorno controlado: muestra el contenido público completo y puede incluir datos personales.
