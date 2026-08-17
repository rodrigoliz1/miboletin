# Correos de continuidad de suscripción

El trabajo `pnpm billing:retention` se ejecuta diariamente. Usa el calendario de Guadalajara y reglas idempotentes:

- Suscripción Stripe `active` o `trialing`, recurrente y sin cancelación programada: no envía recordatorio.
- Recurrencia cancelada o no activa con 3, 2 o 1 días restantes: un correo por día.
- Cuenta vencida: un correo promocional por semana, rotando entre cuatro mensajes.

Los dedupe keys se guardan en `transactional_email_log`; repetir el cron no duplica envíos exitosos. El botón lleva a `/settings#billing`, donde Stripe gestiona la renovación. El workflow `.github/workflows/billing-retention.yml` requiere `DATABASE_URL`, `APP_URL`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` y opcionalmente `BREVO_SENDER_NAME`.
