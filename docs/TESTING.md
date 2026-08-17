# Pruebas

## Suite

- Unidad: normalización, hashes, matching de expedientes y nombres.
- Fallos: fuente restringida, schema drift, timeout, JSON inválido, cero anómalo y duplicados.
- Contrato: Jalisco y listas a sesión federales en vivo bajo `LIVE_SOURCE_TESTS=1`.
- E2E: registro, carpetas, alta persistente Jalisco/Federal, matching y revisión responsive con Playwright. Requiere PostgreSQL migrado.

```bash
pnpm test
LIVE_SOURCE_TESTS=1 pnpm test -- tests/source-contract.live.test.ts
pnpm test:coverage
pnpm test:e2e
```

Playwright usa `E2E_DATABASE_URL` cuando está configurada; en caso contrario utiliza `DATABASE_URL`. Se recomienda una rama Neon exclusiva porque el E2E crea cuentas, carpetas y asuntos reales de auditoría. Los fixtures están anonimizados. Las pruebas rutinarias no consultan continuamente a las autoridades; el contrato en vivo se programa con baja frecuencia y concurrencia uno.
