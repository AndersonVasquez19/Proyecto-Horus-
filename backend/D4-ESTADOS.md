# D4: contrato de estados administrativos

El identificador interno existente es `messages` (no `mensajes`); se conserva junto a `reclamaciones`.

Estado efectivo: seguimiento identificado por `(recurso, registro_id)` cuando existe; en su ausencia, `Contacto.estado` para mensajes y `nuevo` para reclamaciones. Las lecturas no crean seguimientos ni normalizan estados históricos.

Contratos conservados:

- GET `/api/admin/messages` sin `page`: `{ ok: true, messages: [...] }`.
- Con `page`: `{ ok: true, messages: [...], pagination: { page, limit, total, pages }, metrics: { nuevo, en_proceso, atendido, archivado } }`. Las métricas son globales; `pagination.total` incluye los filtros. El filtrado por estado efectivo precede a la paginación.
- GET `/api/admin/messages/:id`: `{ ok: true, message: {...} }`; origen inexistente: 404.
- Los mensajes de lista/detalle conservan sus campos y exponen el estado efectivo en `estado`, sin notas, respuestas ni historial de seguimiento.
- GET seguimiento: `{ ok: true, item: {...} }`; respaldo virtual de revisión 1 sin escrituras. PUT conserva revisión, historial y 409.
- Estadísticas: `stats.mensajes` mantiene `total`, `nuevos`, `enProceso`, `atendidos` y añade `archivados`. Total incluye archivados. La actividad reciente usa el mismo estado efectivo. Reclamaciones mantiene sus métricas documentales.
- PUT heredado de mensajes continúa admitiendo solo nuevo/en_proceso/atendido y rechaza los casos con seguimiento. Leer cuatro estados no amplía este contrato de escritura.

Los fixtures separan contactos y seguimientos, incluso con el mismo ID entre recursos. No se requiere migración, reescritura histórica ni acceso a MySQL para las pruebas aisladas.

## Consultas y concurrencia

`src/attention/message-state.ts` utiliza SQL parametrizado mediante `Prisma.sql`: LEFT JOIN por la clave única `(recurso, registro_id)` y `COALESCE` para el respaldo. No usa el ID de un recurso como si fuera del otro, ni requiere reparar claves foráneas históricas para leer el estado. WHERE se aplica antes de ORDER BY/LIMIT/OFFSET. La proyección excluye los textos de seguimiento; actividad reciente excluye también el mensaje original. La lista paginada ejecuta tres consultas, independientemente de su tamaño: página, total filtrado y agregado global de los cuatro estados. No carga todos los registros ni ejecuta consultas por fila.

El PUT heredado y el guardado de seguimiento toman `SELECT ... FOR UPDATE` sobre la misma fila de Contacto antes de comprobar/crear seguimiento. Conservan validación, revisión y transacción; el PUT heredado no puede pasar su comprobación mientras se crea el primer seguimiento. No se añaden escrituras durante GET.

La tabla heredada reutiliza `AttentionEditor` en modo de estado: utiliza la revisión leída al abrir, conserva los otros campos y resuelve 409 con la comparación D3. Guardar sin cambios no hace PUT. Cambiar de atendido a archivado en otra sesión se reconoce sin equivalencias en las acciones rápidas; reabrir requiere elegir una acción explícita.

## Verificación aislada

Desde `backend/`: `node --test -r ./test/isolate-env.cjs -r ts-node/register test/message-states.test.ts test/backend-regressions.test.ts`.

El doble de `$queryRaw` ejecuta únicamente SELECT sobre SQLite en memoria con fixtures separados, sin instanciar PrismaService ni conectar a MySQL. Un segundo doble simula el bloqueo de origen y ambas intercalaciones de los escritores. Esto comprueba consultas y comportamiento, pero no sustituye mediciones del plan MySQL o pruebas de bloqueo de un servidor MySQL autorizado. `node:sqlite` está disponible en Node 22; puede emitir un aviso experimental según la versión.

Los smokes de tabla, detalle y conflictos mantienen fixtures HTTP; el de conflictos incluye archivo/reapertura, 409 en tabla, métricas y dashboard. Sus procesos y perfiles propios se limpian también al salir por error.

El smoke de autenticación también bloquea peticiones externas antes de enviarlas. `node scripts/smoke-auth.cjs --old-401`, desde `frontend/`, aísla el escenario de 401 antiguo: primero espera la petición de A, después caduca A y activa B. Evita probar accidentalmente una sesión cerrada durante la navegación antes de que exista esa petición.
