# Seguridad

## Controles implementados

- Validación Zod en fronteras de entrada y providers.
- Cookie de sesión firmada, `httpOnly`, `sameSite=lax`, expiración de ocho horas y `secure` en producción.
- Autorización de roles server-side para ingestión y mutaciones.
- Rate limit de login y comparación de contraseña con bcrypt.
- SQL parametrizado con `postgres`, sin interpolación manual de entradas.
- Organización en cada relación privada; las consultas de producción deben filtrar por `organization_id` derivado de sesión.
- Snapshots con hash, audit logs y eventos de dominio.
- User-Agent identificable, timeout y baja concurrencia hacia autoridades.
- Sentencias en Blob privado; la URL de objeto no llega al navegador. `/api/documents/[id]` vuelve a validar sesión, suscripción y pertenencia de organización antes de transmitir el stream.

## Auditoría de amenazas

- IDOR: no aceptar `organizationId` del navegador; obtenerlo de sesión.
- CSRF: `sameSite=lax`, métodos mutables POST y verificación de sesión. En integraciones cross-site, agregar token explícito.
- XSS: React escapa texto; no usar `dangerouslySetInnerHTML` para publicaciones.
- SSRF: providers usan bases allowlisted y no reciben URLs del usuario.
- Mass assignment: schemas enumeran campos permitidos.
- Enumeration y brute force: mensajes genéricos, retraso uniforme y rate limit.
- Privilege escalation: comparación de rol en servidor; ocultar un botón no concede autorización.
- Secrets: únicamente variables de entorno, nunca payloads ni logs.

## Pendiente antes de usuarios reales

Conectar un proveedor de identidad con MFA, implementar rate limiting distribuido (Redis/KV), CSP con nonce, rotación de sesiones y pruebas de aislamiento contra una base de datos de staging.
