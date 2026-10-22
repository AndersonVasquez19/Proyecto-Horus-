# Exportación controlada de consultas (Etapa 4A)

Documento técnico del endpoint `GET /api/admin/messages/exportar`, de los permisos efectivos, del estado real del riesgo de extracción masiva y de la migración pendiente del frontend.

Estado: **Etapa 4A.1 cerrada en el backend**. El frontend no se ha tocado. El contrato para la integración posterior está en `contrato-etapa-4a2-mensajes.md`.

Decisiones aprobadas: `mensajes:exportar` solo para `GERENTE_GENERAL`; Coordinación y Secretaría conservan `mensajes:leer` sin exportar; CSV con tope de 5 000 filas y lectura por lotes; listado paginado (20 por defecto, 100 máximo); corte temporal fijo para «antiguas». **El riesgo de extracción masiva NO se declara resuelto:** siguen siendo posibles consultas paginadas o repetidas al listado y al detalle (`GET /:id`) con `mensajes:leer`. No se fija todavía un límite de detalles por minuto: primero se estudiará el uso legítimo.

## 1. Contrato del endpoint

`GET /api/admin/messages/exportar` — requiere sesión (JWT) y el permiso `mensajes:exportar`.

| Parámetro | Valores | Notas |
| --- | --- | --- |
| `search` | texto, 0–100 caracteres | Nombre, correo, asunto o texto del mensaje (como la bandeja). |
| `estado` | `nuevo`, `en_proceso`, `atendido`, `archivado` | Estado **efectivo** (el del seguimiento si existe). |
| `channel` | `chatbot`, `other` | |
| `responsable` | texto, 0–100 | Responsable exacto del seguimiento. |
| `antiguas` | `si` | Nuevas o en proceso con más de 48 h. |
| `formato` | `csv` | Único formato. |
| `separador` | `punto_y_coma` (por defecto), `coma` | |

Cualquier otro parámetro (`page`, `limit`, `vista`, `columnas`…) responde **400**: el cliente no elige columnas ni evita el tope.

Respuestas:

| Código | Situación |
| --- | --- |
| 200 | Adjunto `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="horus-consultas-AAAAMMDD-HHmm.csv"`, `Cache-Control: no-store`. |
| 400 | Parámetro inválido o no admitido. |
| 401 | Sin sesión o token inválido. |
| 403 | Sesión válida sin `mensajes:exportar`. |
| 422 | El filtro supera **5 000** consultas. Se responde tras el conteo, sin leer datos personales. |

Archivo: BOM UTF-8, saltos CRLF, comillas RFC 4180. Columnas fijas: `ID; Nombre; Correo; Teléfono; Asunto; Origen; Estado; Recibida (hora de Lima)`. Al final: `Filas`, `Generado el` y el aviso de datos personales. **No incluye el texto del mensaje, notas, respuestas ni historial.**

Protección contra fórmulas: toda celda que empiece por `=`, `+`, `-`, `@` (también variantes de ancho completo, tabulación o salto previo) se antepone con `'`.

## 2. Garantías de la implementación

- **Autorización antes de cualquier lectura.** `AccessGuard` (guardia global) corta con 401/403 antes del controlador, del `ValidationPipe` y del conteo. Probado: con 401 y 403 se ejecutan 0 consultas y 0 transacciones.
- **Solo lectura.** Únicamente `SELECT`; una transacción `REPEATABLE READ` (instantánea coherente), `timeout` 20 s, `maxWait` 5 s. Las pruebas fallan ante cualquier `INSERT/UPDATE/DELETE`.
- **Lotes estables.** `COUNT` y después lotes de 500 con `ORDER BY createdAt DESC, id DESC` (orden total por `id` único). El corte de «antiguas» se fija **una vez** (ver §5, corrección nueva).
- **Memoria.** Máximo 5 000 filas × 8 columnas (unos pocos MB) y un único `Buffer`.
- **Registro sin datos personales.** El log guarda cuenta, número de filas y **nombres** de los filtros (nunca sus valores).
- **Sin persistencia de auditoría ni migraciones** (decisión de esta etapa).

## 3. Permisos efectivos

| Rol | `mensajes:leer` | `mensajes:exportar` |
| --- | --- | --- |
| `GERENTE_GENERAL` | sí | **sí** |
| `COORDINADORA_INSTITUCIONAL` | sí | no |
| `SECRETARIA` | sí | no |
| Sin rol / otros | no | no |

No se modificó ningún otro permiso.

## 4. `GET /api/admin/messages` (listado): comportamiento final

- **Corregido:** omitir `page` ya **no** devuelve todos los registros. Equivale a `page=1` y `limit` por defecto 20 (máximo 100). La respuesta mantiene `ok` y `messages` y añade `pagination` y `metrics`.
- Sin cambios: sin `vista`, cada fila trae `email`, `telefono` y `mensaje` (lo que usa hoy la bandeja). Con `vista=resumen` no trae esos campos y añade `vista_previa` (160 caracteres), `origen` y `responsable`.
- `GET /api/admin/messages/:id` sigue devolviendo el detalle completo con `mensajes:leer`.

### Consumidores reales

| Consumidor | Qué pide | Qué necesita |
| --- | --- | --- |
| `MessageInbox` (bandeja) | `messages?page&limit=20&search&estado&channel` | De cada fila usa `asunto`, `mensaje` (vista previa) y, de la fila seleccionada, `email`, `telefono` y `mensaje`. **Hoy depende de los datos personales en el listado.** |
| `MessageInbox` (botón «Exportar resultados») | recorre `messages?page=N&limit=100` | Todos los campos; construye el CSV en el navegador. **Es el camino de extracción masiva abierto a cualquier `mensajes:leer`.** |
| `MessageCreateDialog` (duplicados) | `messages?page=1&limit=20&search=<correo>` | `email`, `asunto` y `mensaje` para comparar. |
| `useMessageDetail` | `messages/:id` | Detalle completo. |
| `adminApi.getAdminMessages` | `messages` sin paginar | **Sin uso en componentes.** Era el único camino sin tope. |
| Panel de inicio | otro endpoint (estadísticas); `recentMessages` ya omite correo y mensaje | — |

Nadie usa la respuesta sin `page` salvo `getAdminMessages`, que no se invoca desde ningún componente.

## 5. Riesgos

### Corregidos en esta etapa

1. Listado sin `page` ilimitado (volcado en una sola petición con datos personales).
2. Exportación de Gerencia con corte de «antiguas» recalculado en cada lote: al cruzar consultas el umbral de 48 h durante la lectura, el conteo y los lotes veían conjuntos distintos y podían **repetir o perder filas**. Ahora el corte es único. Prueba nueva; se verificó que **falla** sin la corrección.
3. Exportación completa restringida a `mensajes:exportar`, con tope de 5 000 filas y sin el texto del mensaje.

### Pendientes (no resueltos)

1. **La separación lectura/exportación NO está cerrada.** Cualquier usuario con `mensajes:leer` (Secretaría, Coordinación) puede obtener los mismos correos y teléfonos de forma masiva:
   - recorriendo el listado completo a 100 filas por petición (es exactamente lo que hace hoy el botón CSV del navegador), o
   - con `vista=resumen` + `GET /:id` por identificador secuencial.
2. La paginación solo limita cada petición; no impide solicitudes sucesivas.
3. Sin auditoría persistente de lecturas ni de descargas (solo el log de la exportación).
4. El botón actual del navegador sigue exportando con `mensajes:leer`.

### Propuesta para cerrar el riesgo (requiere aprobación; cambia lo que ven Secretaría y Coordinación)

No se aplicó porque rompe la bandeja actual.

- **Paso 1 — frontend (compañero).** La bandeja pide `vista=resumen` y abre el detalle con `GET /:id` (`useMessageDetail` ya existe). El diálogo de duplicados deja de leer `email`/`mensaje` del listado. El botón CSV usa el endpoint nuevo y solo se muestra con `mensajes:exportar`.
- **Paso 2 — backend (con tu aprobación).** Sin `mensajes:exportar`, el listado devuelve siempre la vista resumen (se ignora la vista completa). El detalle conserva los datos completos.
- **Paso 3 — frenar la enumeración del detalle.** Posible límite por cuenta con la tabla `rate_limit_buckets` ya existente (sin migración) y registro de picos; **la cifra no está decidida** y no se fijará hasta estudiar el uso legítimo. Nota honesta: quien necesita leer cada caso siempre puede leerlos uno a uno; el límite eleva el costo y deja rastro, no lo imposibilita. La auditoría persistente exige una migración y queda fuera de esta etapa.
- **Decisión que necesito:** ¿Secretaría y Coordinación dejan de ver correo y teléfono en el listado (solo en el detalle)? ¿Qué límite de detalles por cuenta es aceptable?

## 6. Compatibilidad con React

- Todo lo que usa el frontend actual sigue funcionando: `ok`, `messages`, `pagination`, `metrics`, `GET /:id`, filtros y `vista=resumen`.
- Único cambio de contrato: la respuesta sin `page` ahora lleva `pagination` y `metrics`, y solo trae 20 filas.
- `useCollection` ya rechaza listas con `pagination` sin `messages` en formato de arreglo; no se ve afectado.
- Los scripts de humo del frontend usan API simulada y no ejercitan el servidor real (ver §8).

## 7. Instrucciones para migrar el botón CSV (compañero de frontend)

Archivo: `frontend/src/panel/components/workspace/MessageInbox.tsx` (`exportResults`). No se editó.

1. **No usar `panelRequest`.** Siempre hace `response.json()` y fallaría con un CSV. Crear una función con `fetch(API_BASE + '/admin/messages/exportar?' + query, { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store', signal })` y leer `await response.blob()`. Conservar el tratamiento de 401 (`reportExpiredSession(token)`) y 403 (`reportAccessDenied(token)`, mensaje `ACCESS_DENIED`) de `panelRequest`.
2. **Parámetros:** enviar solo `search`, `estado`, `channel` (los filtros que ya toma la bandeja) y, si se quiere, `responsable`/`antiguas`. **No enviar `page` ni `limit`** (el servidor responde 400).
3. **Errores:** 422 → «Hay demasiadas consultas para exportar de una vez. Acota la búsqueda o los filtros.» (el mensaje del servidor es seguro de mostrar); 400/500 → mensaje genérico en español; no mostrar texto técnico.
4. **Descarga:** `URL.createObjectURL(blob)` y un `<a download>`. El nombre sale de `Content-Disposition` (`horus-consultas-AAAAMMDD-HHmm.csv`); si no se puede leer, usar ese patrón. Revocar la URL después.
5. **Quitar** `fetchAllPages`, `toExportRows`, `buildCsv` y `MESSAGE_EXPORT_COLUMNS` del flujo de mensajes (el CSV ya viene hecho y neutralizado del servidor); no reutilizar la neutralización del cliente.
6. **Permiso:** mostrar el botón solo con `mensajes:exportar` (añadir el permiso al módulo de acceso del panel, `frontend/src/panel/context/panelAccess.ts`, y a sus pruebas). Hoy se muestra a todo el que ve la bandeja.
7. **Conservar:** bloqueo síncrono contra doble envío, cancelación con `AbortController`, timeout (sugerido 60 s: la lectura de 5 000 filas es más lenta que una página), sesión cambiada durante la descarga, y la protección de cambios sin guardar. La nota de progreso por páginas ya no aplica: usar «Preparando la exportación…».
8. **Pruebas sugeridas:** actualizar `smoke-messages-table` y los que simulan `messages?page=`, y añadir un caso con `/admin/messages/exportar` (200 CSV, 403, 422) con bloqueo previo de destinos no locales.

## 8. Pruebas y limitaciones

Ejecutado con Node 22.23.3 (portable), en serie: `tsc --noEmit` sin errores; `nest build` sin errores; suite completa del backend (`node --test --test-concurrency=1 -r ./test/isolate-env.cjs -r ts-node/register test/*.test.ts`): 823 pruebas, 823 correctas, 0 fallos. Incluye `messages-export`, `permissions`, `access-guard`, `message-states` y `atencion-proceso`. No se ejecutaron `*.integration.cjs` (requieren MySQL). Alcance: las pruebas HTTP usan Nest real con SQLite en memoria (`node:sqlite`) y datos ficticios; **no** prueban dialecto MySQL, el aislamiento `REPEATABLE READ` real ni la colación de MySQL. No hay prueba contra MySQL 8 real (ver informe).
