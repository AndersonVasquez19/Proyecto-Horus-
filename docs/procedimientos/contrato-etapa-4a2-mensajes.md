# Contrato de integración — Etapa 4A.2 (bandeja resumida y exportación CSV)

Documento para el compañero responsable del frontend. Describe el contrato del backend ya publicado en la Etapa 4A.1 y el cambio de React previsto para la 4A.2. **La 4A.2 no está implementada**: no se ha modificado ningún archivo de `frontend/`. El detalle técnico del backend está en `exportacion-consultas.md`.

## 0. Decisiones aprobadas (fase 1 del backend)

1. **Se mantiene por ahora** el comportamiento actual de `GET /api/admin/messages` (sin `vista`, devuelve correo, teléfono y mensaje completo) para no romper React.
2. `mensajes:exportar` sigue **exclusivamente para Gerencia**.
3. **No se conceden permisos nuevos** a Coordinación ni a Secretaría.
4. **No se establece todavía** un límite nuevo de consultas de detalle por cuenta.
5. `vista_previa` se mantiene provisionalmente. **Puede contener información personal** (son los primeros 160 caracteres del mensaje) y **no equivale a anonimización**.
6. Objetivo futuro: Coordinación y Secretaría reciben en el listado solo los campos mínimos y consultan el detalle autorizado cuando lo necesiten.

**La restricción que fuerza `vista=resumen` NO está activa.** Se activará solo después de comprobar que React ya usa el contrato nuevo. El backend dispone ya de todo lo necesario para migrar la bandeja (listado resumen, detalle por id y exportación), **sin endpoints nuevos**. Cubierto por `backend/test/messages-privacidad.test.ts`.

## 1. Endpoints

| Uso | Endpoint | Permiso | Estado |
| --- | --- | --- | --- |
| Bandeja resumida | `GET /api/admin/messages?vista=resumen&page=N&limit=M` | `mensajes:leer` | Existe. `page` por defecto 1; `limit` por defecto 20, máximo 100. |
| Detalle | `GET /api/admin/messages/:id` | `mensajes:leer` | Existe (`useMessageDetail` ya lo usa). |
| Exportación CSV | `GET /api/admin/messages/exportar` | `mensajes:exportar` | Existe (4A.1). Solo `GERENTE_GENERAL`. |

Orden de rutas: `exportar` está declarada antes de `:id`.

### Listado (`GET /api/admin/messages`)

Filtros: `search`, `estado`, `channel`, `responsable`, `antiguas=si`, `page`, `limit`, `vista=resumen`. Respuesta: `{ ok, messages, pagination, metrics }`.

- **Sin `vista`** (comportamiento actual, no se ha cambiado en 4A.1): cada fila incluye `email`, `telefono` y `mensaje` completo.
- **Con `vista=resumen`:** cada fila trae `id`, `nombre`, `asunto`, `estado`, `createdAt`, `updatedAt`, `vista_previa` (primeros 160 caracteres del mensaje), `origen` y `responsable`. **No** trae `email`, `telefono` ni `mensaje`.

### Detalle (`GET /api/admin/messages/:id`)

Devuelve el registro completo (correo, teléfono, mensaje, seguimiento). Hoy lo puede leer cualquier usuario con `mensajes:leer`.

### Exportación (`GET /api/admin/messages/exportar`)

Parámetros admitidos: `search` (0–100), `estado` (`nuevo|en_proceso|atendido|archivado`), `channel` (`chatbot|other`), `responsable` (0–100), `antiguas=si`, `formato=csv`, `separador=punto_y_coma|coma`. Cualquier otro (`page`, `limit`, `vista`, `columnas`…) responde **400**.

Respuesta 200: `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="horus-consultas-AAAAMMDD-HHmm.csv"`, `Cache-Control: no-store`. Máximo **5 000 filas**, lectura por lotes de 500. Columnas fijas: ID, Nombre, Correo, Teléfono, Asunto, Origen, Estado, Recibida (hora de Lima). No incluye el texto del mensaje, notas ni historial. Las celdas que empiezan por `=`, `+`, `-`, `@` salen neutralizadas desde el servidor.

## 2. Campos visibles por rol

Estado **actual (4A.1)** y **objetivo (4A.2)**:

| Dato | Gerente General | Coordinación | Secretaría |
| --- | --- | --- | --- |
| Listado completo (sin `vista`): correo, teléfono, mensaje | Hoy sí | Hoy sí | Hoy sí |
| **Objetivo 4A.2:** listado `vista=resumen` | Sí | Sí (sin correo/teléfono/mensaje completo) | Sí (ídem) |
| Detalle `GET /:id` (correo, teléfono, mensaje completo) | Sí | Sí, al abrir una consulta | Sí, al abrir una consulta |
| `mensajes:exportar` / botón y endpoint CSV | **Sí** | No | No |

Aclaraciones:

- En 4A.1 el servidor **todavía no obliga** a Coordinación y Secretaría a usar la vista resumen: ese filtrado por rol (ignorar la vista completa sin `mensajes:exportar`) es un cambio de backend de la 4A.2 y requiere que el frontend ya haya migrado.
- `vista_previa` expone hasta 160 caracteres del mensaje. Decisión aprobada: se mantiene provisionalmente, **puede contener información personal** y no equivale a anonimización (ver sección 0).

## 3. Errores

| Código | Cuándo | Qué hace el frontend |
| --- | --- | --- |
| 401 | Sin sesión, token vencido o inválido | Tratamiento existente de sesión expirada (`reportExpiredSession`); no reintentar. |
| 403 | Sesión válida sin el permiso (`mensajes:leer` o `mensajes:exportar`) | `reportAccessDenied` con el mensaje de acceso denegado del panel. El botón CSV no debería mostrarse sin `mensajes:exportar`; el 403 cubre permisos cambiados durante la sesión. |
| 422 | Solo en exportación: el filtro supera 5 000 consultas | Mostrar: «Hay demasiadas consultas para exportar de una vez. Acota la búsqueda o los filtros.» No se leyeron datos personales. |
| 400 | Parámetro inválido o no admitido (p. ej. enviar `page`/`limit` a `exportar`) | Mensaje genérico en español; es un error de programación del cliente. |
| 5xx / red / timeout | | Mensaje genérico; sin texto técnico del backend; no declarar éxito. |

## 4. Riesgo residual (NO resuelto)

**El riesgo de extracción masiva de datos personales no está resuelto, ni en 4A.1 ni con la 4A.2 prevista.**

- La paginación (20 por defecto, 100 máximo) y el permiso `mensajes:exportar` solo acotan cada petición y el camino oficial de descarga. No impiden solicitudes sucesivas.
- Un usuario con `mensajes:leer` puede seguir recuperando correos y teléfonos con consultas paginadas repetidas (mientras el listado completo siga disponible) o con lecturas repetidas de `GET /:id` por identificador secuencial (aun con la bandeja resumida).
- No hay auditoría persistente de lecturas (solo el registro de la exportación, sin datos personales ni valores de filtros).
- **No se ha fijado un límite de detalles por minuto.** Se decidió no establecer un número arbitrario antes de estudiar el uso legítimo (cuántas consultas abre una persona de Secretaría en un turno normal). Hasta entonces, cualquier cifra del documento `exportacion-consultas.md` es solo un ejemplo.

## 5. Cambios necesarios en React (no realizados)

### `frontend/src/panel/components/workspace/MessageInbox.tsx`

1. Pedir el listado con `vista=resumen`; mostrar `vista_previa` en lugar de `mensaje`.
2. Al seleccionar una consulta, cargar el detalle con `useMessageDetail` (`GET /:id`) y mostrar correo, teléfono y mensaje completo desde ahí. Conservar estados de carga y error del detalle, y evitar que una respuesta antigua pise la selección actual.
3. Sustituir `exportResults` (recorre `messages?page=N&limit=100` y arma el CSV en el navegador) por una llamada a `GET /admin/messages/exportar` (ver `messageExport.ts`).
4. Mostrar el botón «Exportar resultados» solo con `mensajes:exportar` (añadir el permiso a `frontend/src/panel/context/panelAccess.ts` y a sus pruebas).
5. Conservar: bloqueo síncrono contra doble envío, `AbortController`, timeout (sugerido 60 s), cambio de sesión durante la descarga y la protección de cambios sin guardar.
6. Revisar el diálogo de duplicados (`MessageCreateDialog`): hoy lee `email` y `mensaje` del listado; debe pasar a comparar con lo que ofrezca el resumen o con el detalle.

### `frontend/src/panel/services/messageExport.ts`

1. Quitar el armado del CSV en cliente (`fetchAllPages`, `toExportRows`, `buildCsv`, `MESSAGE_EXPORT_COLUMNS`) del flujo de mensajes: el servidor ya entrega el archivo y neutraliza las fórmulas.
2. Crear una función con `fetch` (no `panelRequest`, que siempre hace `response.json()`) hacia `/admin/messages/exportar` con `Authorization: Bearer`, `cache: 'no-store'` y lectura con `blob()`. Enviar solo `search`, `estado`, `channel` (y opcionalmente `responsable`, `antiguas`). Nunca `page` ni `limit`.
3. Descargar con `URL.createObjectURL` y `<a download>`; nombre desde `Content-Disposition`, o el patrón `horus-consultas-AAAAMMDD-HHmm.csv`; revocar la URL.
4. Mapear 401, 403, 422 y 400 según la sección 3.


### Pruebas a ajustar

`test:list-records`, `smoke:messages-table`, `smoke:message-detail`, `smoke:message-center`, `smoke:unsaved`, `test:panel-access`, `smoke:panel-actions`, más un caso con `/admin/messages/exportar` (200 CSV, 403, 422) con bloqueo previo de destinos no locales.

## 5 bis. Guía corta para el frontend (pasos exactos)

Todo con la API actual; ninguna petición nueva salvo `/exportar`. No guardes correos ni teléfonos en `localStorage`/`sessionStorage`.

1. **`MessageInbox.tsx`**
   - Pedir el listado con `vista=resumen` (más `page`, `limit`, `search`, `estado`, `channel`, y opcionalmente `responsable`, `antiguas=si`).
   - En filas y tabla, mostrar `vista_previa` en lugar de `mensaje`; `email` y `telefono` ya no existen en la fila.
   - Al seleccionar o abrir `?id=N`, cargar `GET /admin/messages/:id` con `useMessageDetail` y mostrar correo, teléfono y mensaje completo desde ahí, con estados de carga y error, sin que una respuesta antigua pise la selección actual.
   - Reemplazar `exportResults` por la descarga desde `/admin/messages/exportar` (ver `messageExport.ts`) y mostrar el botón solo con `mensajes:exportar`.
   - Conservar bloqueo síncrono, `AbortController`, timeout y protección de cambios sin guardar.
2. **`MessageCreateDialog`**
   - La detección de duplicados lee hoy `email` y `mensaje` del listado. Con `vista=resumen` no vienen: comparar por `nombre`, `asunto` y `vista_previa` del resumen, o abrir el detalle de los candidatos. Decisión de producto pendiente; no pedir el listado completo.
3. **`messageExport.ts`**
   - Quitar `fetchAllPages`, `toExportRows`, `buildCsv` y `MESSAGE_EXPORT_COLUMNS` del flujo de mensajes.
   - Nueva función con `fetch` (no `panelRequest`): `GET /admin/messages/exportar` con `Authorization: Bearer`, `cache: 'no-store'`, `blob()`, y solo `search`, `estado`, `channel` (y `responsable`, `antiguas`). Nunca `page`, `limit` ni `vista` (400).
   - Descarga con `URL.createObjectURL` y `<a download>`; nombre desde `Content-Disposition` o `horus-consultas-AAAAMMDD-HHmm.csv`; revocar la URL.
   - Mapear 401, 403, 422 y 400 según la sección 3.
4. **`panelAccess.ts`**
   - Declarar `mensajes:exportar` (permiso del botón CSV) y contrastarlo con `route-inventory.ts` en `test:panel-access`. Confirmar que `RESOURCE_READ`/`PANEL_ACTIONS` no ofrezcan la exportación sin él.
5. **Pruebas** a ajustar: ver «Pruebas a ajustar» (sección 5). Los smokes deben bloquear destinos no locales antes de enviar.
6. **Aviso al terminar:** cuando React use `vista=resumen` y el detalle, el backend podrá activar la restricción (sección 6, paso 2). Hasta entonces el servidor no la aplica.

## 6. Orden recomendado de la 4A.2

1. Frontend: migrar bandeja a `vista=resumen` + detalle, y el CSV al endpoint nuevo.
2. Backend (solo después): sin `mensajes:exportar`, el listado devuelve siempre la vista resumen.
3. Estudiar el uso legítimo del detalle antes de proponer cualquier límite por minuto o auditoría persistente (esta exige migración y autorización aparte).
