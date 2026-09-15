# Consumo de GitHub Actions

Configuración de ahorro: septiembre de 2026. Todos los horarios indicados son de Guadalajara (UTC−6).

| Tarea | Frecuencia | Límite por ejecución |
| --- | --- | --- |
| Vigilancia de expedientes activos | Lunes a viernes: 08:00, 09:00, 11:00, 14:00, 17:00, 20:00 | Conserva su límite de 120 minutos |
| Ampliación del índice global | Domingo, 08:30 | Dos jobs, 25 minutos cada uno; 18 minutos de procesamiento por proveedor |
| Búsquedas ampliadas solicitadas | Lunes a viernes, 20:35 | 10 minutos; un trabajo con dos unidades por ejecución |
| Correos de suscripción | Diario, 09:20 | Conserva su límite de 15 minutos |
| Calidad | Push a main y pull requests | 20 minutos; cancela validaciones anteriores de la misma referencia |

El índice deja de lanzar ocho jobs dos veces cada día hábil. Ahora utiliza dos jobs por semana, sin replicar instalación y catálogos en cuatro segmentos por proveedor. En un mes con cinco domingos su techo programado es 250 minutos de runner. Las búsquedas ampliadas tienen un techo de 230 minutos en un mes con 23 días hábiles. Son límites, no una estimación del consumo real ni una garantía de permanecer dentro de los 2,000 minutos: deben sumarse vigilancia, correos, calidad y ejecuciones manuales.

## Cobertura y continuidad

La ejecución semanal consulta desde hace siete días hasta ayer. Omite unidades ya completas y conserva el cursor al alcanzar el presupuesto del procesador. No garantiza recorrer todos los órganos o fechas: la cobertura global y las búsquedas por nombre avanzarán más despacio. El monitor continúa consultando los expedientes activos, independientemente del índice global.

Las búsquedas ampliadas ya no dependen de que termine correctamente el índice CJJ. Sus cursores y bloqueos temporales permiten continuarlas en otras ejecuciones. Una solicitud extensa puede necesitar varios días.

Para continuar una semana incompleta, ejecutar manualmente **Índice judicial global** con las mismas fechas `from` y `to`. `--resume=latest` busca el cursor de ese rango. La semana siguiente abre un rango nuevo; las semanas incompletas anteriores no se recuperan automáticamente. Los backfills antiguos segmentados deben continuarse con su identificador/segmento original. Cada ejecución manual consume minutos adicionales.

## Activación y seguimiento

Los cambios entran en vigor cuando estos archivos llegan a la rama predeterminada en GitHub. No reactivan una cuenta bloqueada por facturación ni recuperan minutos consumidos.

En Billing → Usage, comprobar el consumo por workflow después de una semana. Medir especialmente la vigilancia antes de reducir su frecuencia: es la tarea que mantiene actualizados los asuntos de los clientes. Las cifras de consumo bruto cubiertas íntegramente por descuentos no son un cargo pendiente.
