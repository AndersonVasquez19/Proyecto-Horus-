# Contrato de integración — Etapa 4A.2 (bandeja resumida y exportación CSV)

Documento para el compañero responsable del frontend. Describe el contrato del backend ya publicado en la Etapa 4A.1 y el cambio de React previsto para la 4A.2. **La 4A.2 no está implementada**: no se ha modificado ningún archivo de `frontend/`. El detalle técnico del backend está en `exportacion-consultas.md`.

## 0. Decisiones aprobadas (fase 1 del backend)

1. **Se mantiene por ahora** el comportamiento actual de `GET /api/admin/messages` (sin `vista`, devuelve correo, teléfono y mensaje completo) para no romper React.
2. `mensajes:exportar` sigue **exclusivamente para Gerencia**.
3. **No se conceden permisos nuevos** a Coordinación ni a Secretaría.
4. **No se establece todavía** un límite nuevo de consultas de detalle por cuenta.
5. `vista_previa` se mantiene provisionalmente. **Puede contener información personal** (son los primeros 160 caracteres del mensaje) y **no equivale a anonimización**.
6. Objetivo futuro: Coordinación y Secretaría reciben en el listado solo los campos mínimos y consultan el detalle autorizado cuando lo necesiten.
7. **(Fase 2, backend implementado, sin publicar)** La detección de duplicados del registro manual pasa al servidor: `POST /api/admin/messages/duplicados` (sección 1 bis). Responde solo `{ hayCoincidencias, cantidad }`. Es el único endpoint nuevo; no cambia ninguna ruta existente.

**La restricción que fuerza `vista=resumen` NO está activa.** Se activará solo después de comprobar que React ya usa el contrato nuevo. El backend dispone ya de todo lo necesario para migrar la bandeja (listado resumen, detalle por id y exportación) y, con la fase 2, de la comprobación de duplicados (sección 1 bis). Cubierto por `backend/test/messages-privacidad.test.ts` y `backend/test/messages-duplicados.test.ts`.

## 1. Endpoints

| Uso | Endpoint | Permiso | Estado |
| --- | --- | --- | --- |
| Bandeja resumida | `GET /api/admin/messages?vista=resumen&page=N&limit=M` | `mensajes:leer` | Existe. `page` por defecto 1; `limit` por defecto 20, máximo 100. |
| Detalle | `GET /api/admin/messages/:id` | `mensajes:leer` | Existe (`useMessageDetail` ya lo usa). |
| Exportación CSV | `GET /api/admin/messages/exportar` | `mensajes:exportar` | Existe (4A.1). Solo `GERENTE_GENERAL`. |
| Posibles duplicados | `POST /api/admin/messages/duplicados` | `mensajes:crear` | Nuevo (4A.2 fase 2). Los tres roles que pueden registrar una consulta. Ver sección 1 bis. |

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

## 1 bis. Comprobación de posibles duplicados (`POST /api/admin/messages/duplicados`)

Sustituye a la comparación que hacía React (`findPossibleDuplicates` sobre 20 filas completas del listado). Es una **lectura** aunque use POST: el correo y el texto viajan en el cuerpo, no en la URL. Responde 200 (no 201) con `Cache-Control: no-store` y no crea ni modifica nada.

**Solicitud** (`Content-Type: application/json`, `Authorization: Bearer …`). Cuerpo, con las mismas reglas que `POST /admin/messages` (se recorta cada valor):

| Campo | Regla |
| --- | --- |
| `email` | obligatorio, correo válido |
| `asunto` | obligatorio, 1–150 caracteres |
| `mensaje` | obligatorio, 1–5 000 caracteres |

Cualquier otro campo (`nombre`, `telefono`, `search`, `page`, `limit`, `vista`…) responde **400**. Los parámetros de la URL se ignoran. Si envías el borrador completo del formulario, filtra antes: solo esos tres campos.

**Respuesta 200:**

```json
{ "hayCoincidencias": true, "cantidad": 1 }
```

`cantidad` va de 0 a 5; **5 significa «5 o más»**. No hay `ok` en esta respuesta (el cliente actual solo trata `ok: false` como error). No se devuelven identificadores, nombres, correos, teléfonos ni textos.

**Qué cuenta como coincidencia.** Una consulta guardada con el **mismo correo, asunto y mensaje**, creada en los **últimos 7 días**, de cualquier origen (web, chatbot, manual). Comparación exacta (no parcial), sin distinguir mayúsculas ni espacios de los extremos (la misma normalización que usaba React). Diferencias respecto al algoritmo anterior:

- Se comprueban **todas** las consultas de la ventana, no solo las 20 más recientes que contenían el correo: ya no hay falsos negativos por ese límite.
- Ventana de 7 días (antes no había). El caso de uso es comprobar un registro con resultado incierto, que como mucho tiene horas (la sesión dura 8 h); una coincidencia de hace más de 7 días ya no se avisa.
- MySQL compara con la colación de la columna (`utf8mb4_0900_ai_ci`): además de mayúsculas, **ignora acentos** (React no lo hacía). `TRIM` solo quita espacios, no tabuladores ni saltos de línea.
- Ya no se muestran `#id · asunto · fecha`: el endpoint no devuelve identificadores (ver «Instrucciones para React»).

**Errores.**

| Código | Cuándo | Qué hace el frontend |
| --- | --- | --- |
| 400 | Falta un campo, correo inválido, longitud excedida o campo no admitido | Error de programación del cliente; mensaje genérico. No consume cuota. |
| 401 | Sin sesión, token vencido o inválido | `reportExpiredSession`; no reintentar. |
| 403 | Sesión sin `mensajes:crear` | `reportAccessDenied`. |
| 429 | Más de **30 comprobaciones por cuenta en 15 minutos** | Cuerpo `{ ok: false, codigo: 'limite_de_uso', mensaje, reintentar_en_segundos }`. Mostrar «Has comprobado demasiadas veces; espera unos minutos». **No** declarar que no hay duplicados. |
| 503 | Falla **específica del almacén compartido del límite** (`rate_limit_buckets` inaccesible): falla cerrada, no se lee ningún dato | Cuerpo `{ ok: false, codigo: 'limite_no_disponible', mensaje }`. Mensaje genérico de reintento. **No** declarar que no hay duplicados. |
| 500 | Fallo de base de datos **anterior** al limitador (p. ej. MySQL completamente caído: el guard de permisos no puede leer `admin_users`) | Igual que el 503: mensaje genérico, **no** declarar que no hay duplicados. |
| 5xx / red / timeout | | Igual: el resultado de la comprobación es desconocido, no «sin coincidencias». |

No todos los fallos de MySQL producen 503: solo los que ocurren **en** el limitador. Una caída completa de la base aborta antes, en el guard de permisos, y sale como **500**. Para el frontend el tratamiento es idéntico (ambos son «no se pudo comprobar»), y en ningún caso se devuelve un 200 sin haber consultado. Comprobado contra MySQL 8.0.46 real el 22/10/2026.

**Límite por cuenta.** 30 por ventana fija de 15 minutos y por cuenta (en el cambio de ventana una cuenta puede concentrar hasta el doble). Usa la tabla existente `rate_limit_buckets` en MySQL, con la misma operación atómica que `PublicRateLimitGuard` y el asistente: es compartido entre instancias y **no requiere migración**. Solo gastan cuota las solicitudes que llegan al servicio con sesión, permiso y cuerpo válidos (los 400, 401 y 403 no la gastan). Un 429 o 503 no gasta cuota ajena.

**Limitaciones y riesgos conocidos.**

- La comprobación sigue confirmando que *existe* una consulta con exactamente ese correo, asunto y mensaje en los últimos 7 días. Exige conocer los tres valores completos (no sirve para buscar por prefijo o subcadena ni para listar), pero alguien con `mensajes:crear` podría, con un listado de correos y un asunto/mensaje genérico, probar hasta 2 880 combinaciones por día y cuenta. Mitigaciones: ventana de 7 días, límite por cuenta y respuesta solo con recuento. No se ha añadido auditoría persistente (requeriría migración).
- Sin índices por `email`/`createdAt` en `contactos`: la consulta recorre la tabla. El límite por cuenta acota el coste; un índice sería una mejora que requiere migración y autorización aparte.
- El oráculo preexistente de `search` por subcadena sobre `email` y el mensaje completo en `GET /admin/messages` (también con `vista=resumen`) **no se modifica en esta fase** (ver sección 4).
- Las pruebas aisladas usan SQLite: no reproducen la colación de MySQL (acentos) ni la atomicidad real entre procesos; esta última descansa en las mismas sentencias SQL ya probadas con MySQL desechable en la infraestructura de límites existente.

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
6. Sustituir la comparación del diálogo de duplicados (`MessageCreateDialog.checkInbox` + `findPossibleDuplicates`, que lee `email` y `mensaje` del listado completo) por una llamada a `POST /admin/messages/duplicados` (sección 1 bis). No usar el resumen ni el detalle para esto.

### `frontend/src/panel/services/messageExport.ts`

1. Quitar el armado del CSV en cliente (`fetchAllPages`, `toExportRows`, `buildCsv`, `MESSAGE_EXPORT_COLUMNS`) del flujo de mensajes: el servidor ya entrega el archivo y neutraliza las fórmulas.
2. Crear una función con `fetch` (no `panelRequest`, que siempre hace `response.json()`) hacia `/admin/messages/exportar` con `Authorization: Bearer`, `cache: 'no-store'` y lectura con `blob()`. Enviar solo `search`, `estado`, `channel` (y opcionalmente `responsable`, `antiguas`). Nunca `page` ni `limit`.
3. Descargar con `URL.createObjectURL` y `<a download>`; nombre desde `Content-Disposition`, o el patrón `horus-consultas-AAAAMMDD-HHmm.csv`; revocar la URL.
4. Mapear 401, 403, 422 y 400 según la sección 3.


### Pruebas a ajustar

`test:list-records`, `smoke:messages-table`, `smoke:message-detail`, `smoke:message-center`, `smoke:unsaved`, `test:panel-access`, `smoke:panel-actions`, más un caso con `/admin/messages/exportar` (200 CSV, 403, 422) con bloqueo previo de destinos no locales.

## 5 bis. Guía corta para el frontend (pasos exactos)

Todo con la API actual; ninguna petición nueva salvo `/exportar` y `/duplicados`. No guardes correos ni teléfonos en `localStorage`/`sessionStorage`.

1. **`MessageInbox.tsx`**
   - Pedir el listado con `vista=resumen` (más `page`, `limit`, `search`, `estado`, `channel`, y opcionalmente `responsable`, `antiguas=si`).
   - En filas y tabla, mostrar `vista_previa` en lugar de `mensaje`; `email` y `telefono` ya no existen en la fila.
   - Al seleccionar o abrir `?id=N`, cargar `GET /admin/messages/:id` con `useMessageDetail` y mostrar correo, teléfono y mensaje completo desde ahí, con estados de carga y error, sin que una respuesta antigua pise la selección actual.
   - Reemplazar `exportResults` por la descarga desde `/admin/messages/exportar` (ver `messageExport.ts`) y mostrar el botón solo con `mensajes:exportar`.
   - Conservar bloqueo síncrono, `AbortController`, timeout y protección de cambios sin guardar.
2. **`MessageCreateDialog`**
   - La detección de duplicados lee hoy `email` y `mensaje` del listado. Con `vista=resumen` no vienen, así que **hay que sustituirla**, no adaptarla. Instrucciones para `checkInbox`:
     1. Llamar `panelRequest<{ hayCoincidencias: boolean; cantidad: number }>('messages/duplicados', token, 'POST', { email, asunto, mensaje }, signal)` con los valores del borrador recortados. Enviar **solo** esos tres campos (cualquier otro da 400). Conservar el `AbortController` y `CHECK_TIMEOUT_MS`.
     2. Retirar `findPossibleDuplicates` (y su prueba en `tests/message-export.test.mjs`) y la petición `messages?page=1&limit=20&search=<correo>`: ya no hay que pedir filas ni poner el correo en la URL.
     3. Mostrar el resultado con `hayCoincidencias`/`cantidad` (`cantidad` 5 = «5 o más»). Sin identificadores no se puede listar `#id · asunto · fecha`: el texto pasa a ser «Encontramos una consulta (o N consultas) de los últimos 7 días con el mismo correo, asunto y mensaje…». Si el producto necesita enlazar la consulta, hay que pedirlo como cambio de contrato del backend (devolver `id` y `createdAt`) antes de implementarlo en React.
     4. **429, 503, red, timeout o cualquier otro error: estado `error` («No pudimos comprobar…»), nunca «No encontramos…».** El 429 lleva `reintentar_en_segundos`.
     5. Mantener el comportamiento actual: la comprobación solo se ofrece tras un resultado incierto del registro, el POST de registro nunca se repite solo y «Registrar de todos modos» sigue exigiendo la confirmación. Cada pulsación de «Comprobar» gasta una de las 30 comprobaciones por 15 minutos.
     6. Smokes (`smoke:message-center`, casos 25 y 28): el mock debe atender `POST /admin/messages/duplicados` y los destinos no locales seguir bloqueados antes de enviarse.
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

0. Backend (hecho en la fase 2, pendiente de publicar): `POST /admin/messages/duplicados`. Debe estar desplegado **antes** de que React deje de usar la comparación sobre el listado completo.
1. Frontend: migrar bandeja a `vista=resumen` + detalle, el CSV al endpoint nuevo y la comprobación de duplicados a `/duplicados`.
2. Backend (solo después, y solo si React ya usa `/duplicados`): sin `mensajes:exportar`, el listado devuelve siempre la vista resumen. Si se activa antes, la comparación antigua dejaría de encontrar duplicados sin avisar (las filas resumidas no traen correo ni mensaje).
3. Estudiar el uso legítimo del detalle antes de proponer cualquier límite por minuto o auditoría persistente (esta exige migración y autorización aparte).
