# Operación del Asistente

## Configuración

El servidor usa un gateway compatible con Chat Completions y herramientas de función. Configure en Vercel y en el worker:

```text
AI_API_KEY=...
AI_BASE_URL=https://tokease.com/v1
AI_MODEL_FAST=...
AI_MODEL_PRO=...
AI_MODEL_PREMIUM=...
```

Los nombres de modelo nunca están fijados en el código. Se pueden cambiar sin desplegar. Las variables `OPENAI_*` sólo permanecen como transición para instalaciones existentes. Ninguna clave usa `NEXT_PUBLIC_`.

Para desactivar un tier, deje vacía su variable. El router saltará ese nivel y usará el siguiente configurado; debe existir al menos uno. Si desea garantizar siempre el modelo económico, configure `AI_MODEL_FAST`.

## Enrutamiento y fallback

- `fast`: altas de expedientes, consultas de asuntos, publicaciones y sesiones.
- `pro`: resúmenes o análisis con más contexto.
- `premium`: análisis jurídicos extensos y casos de alta complejidad.

La ruta se decide de manera determinista antes de la llamada. Ante timeout, límite de tasa, red, respuesta inválida, incompatibilidad explícita del modelo con herramientas o error 5xx se intenta el siguiente tier configurado, una sola vez. No hay fallback para claves inválidas, permisos ni solicitudes mal formadas. El máximo total es tres intentos.

La aplicación conserva las herramientas existentes del Asistente. Para reducir costo y exposición de datos, las altas no cargan el historial judicial; las demás solicitudes reciben únicamente el periodo, expediente, movimientos, sesiones o metadatos documentales necesarios. Nunca se envían bytes de PDFs.

## Telemetría y costos

`ai_usage_events` registra modelo, tier, tokens, latencia, fallback, tipo de solicitud y error por intento. Nunca registra la clave. El costo queda `NULL` hasta configurar precios verificables mediante `AI_MODEL_PRICING_JSON`, por ejemplo:

```json
{"modelo":{"inputUsdPerMillion":0,"outputUsdPerMillion":0,"cachedInputUsdPerMillion":0}}
```

No copie precios de ejemplo a producción. Deben verificarse en el proveedor antes de habilitarlos.

## Diagnóstico

- `AI_API_KEY no está configurada`: falta la clave exclusivamente server-side.
- `No hay modelos de IA configurados`: las tres variables de modelo están vacías.
- Error 401/403: revisar clave y permisos; el sistema no hace fallback porque otro modelo no corrige autenticación.
- Error 400/404/422: confirmar el identificador exacto del modelo y la compatibilidad de `tools`; se considera configuración/request y no se oculta con fallback.
- Timeout, 429 o 5xx: revisar `ai_usage_events`; ahí queda cada intento y el tier al que avanzó.

## Pruebas sin consumo

Las pruebas unitarias usan un transporte simulado; no llaman al gateway ni consumen créditos:

```bash
pnpm test -- tests/ai-routing.test.ts tests/ai-service.test.ts tests/assistant-context-plan.test.ts
```
