# Atención al Cliente: recepción, seguimiento y cierre de consultas

Documento de sustentación y de integración para el panel React. Describe lo que el backend **hace hoy** (rama `anderson`, sin migraciones). Lo que necesitaría tablas o columnas nuevas está en la sección «Pendientes».

## 1. Problema que resuelve

Una persona escribe a Horus Group (formulario web, chatbot o registro manual). Sin un proceso, la consulta se pierde, dos personas la contestan a la vez, se cierra «porque sí» o se da por entregado un correo que nunca llegó. El módulo garantiza que cada consulta:

1. queda **registrada** al recibirse;
2. tiene un **recorrido ordenado** (no se puede cerrar sin dejar evidencia ni «des-revisar» un caso);
3. deja un **historial** de quién hizo qué y cuándo;
4. distingue **intentar contestar** de **haber contestado** (el proveedor de correo «aceptó» el mensaje, que no es «entregado»);
5. no pierde cambios cuando dos personas trabajan a la vez;
6. se mantiene coherente con las **Cotizaciones** y con las cifras de **estadísticas** y de **HORUS Assistant**.

## 2. Flujo completo

```text
Consulta recibida ─▶ revisión/asignación ─▶ seguimiento ─▶ respuesta ─▶ cierre ─▶ (archivo)
   estado: nuevo        en_proceso             en_proceso     en_proceso    atendido   archivado
```

| Paso | Qué ocurre | Qué queda registrado |
| --- | --- | --- |
| Recibida | `POST /api/contacto` (web), chatbot (`origen=chatbot`) o `POST /api/admin/messages` (manual). Nace `nuevo` | Fila en `contactos` |
| Revisión / asignación | `PUT seguimiento` con `estado: en_proceso` y `responsable` | Fila en `attention_records` + entrada de historial |
| Seguimiento | Notas internas (`notas`) y borrador de `respuesta`; opcionalmente cotizaciones vinculadas | Cada guardado sube `revision` y añade historial |
| Intento de comunicación | `POST …/correo` (respuesta) o `POST …/constancia` | Entradas `iniciado` y luego `aceptado` / `fallido` / `incierto` |
| Respuesta realmente enviada | Solo existe si el proveedor la **aceptó** (`envios.respuesta.estado = "aceptado"`) | Entrada con el id del proveedor. **No** prueba que el cliente la leyó |
| Cierre | `PUT` con `estado: atendido` (exige respuesta guardada **o** nota) | Historial `en_proceso → atendido` |
| Archivo | `PUT` con `estado: archivado` (exige que no haya cotizaciones abiertas) | Historial; se puede reabrir a `en_proceso` |

Enviar la respuesta **no cierra** el caso automáticamente: el cierre es una decisión explícita. Así nunca se «inventa» un estado que el sistema no verificó.

## 3. Roles autorizados

La autorización es del backend (JWT + AccessGuard); el panel solo adapta la interfaz.

| Operación | Gerente | Coordinadora | Secretaría | Sin rol |
| --- | :-: | :-: | :-: | :-: |
| Ver bandeja y detalle (`mensajes:leer`) | ✔ | ✔ | ✔ | ✘ |
| Registrar consulta manual (`mensajes:crear`) | ✔ | ✔ | ✔ | ✘ |
| Cambiar estado heredado (`mensajes:editar`) | ✔ | ✔ | ✔ | ✘ |
| Seguimiento: leer / editar / enviar (`seguimiento_mensajes:*`) | ✔ | ✔ | ✔ | ✘ |
| Eliminar una consulta (`mensajes:eliminar`) | ✔ | ✘ | ✘ | ✘ |
| Seguimiento de reclamaciones (`seguimiento_reclamaciones:*`) | ✔ | ✔ | **✘** | ✘ |
| Cotizaciones (`cotizaciones:*`) | ✔ | ✔ | **✘** | ✘ |
| Estadísticas (`estadisticas:leer`) | ✔ | ✔ | **✘** | ✘ |

La Secretaría atiende consultas de principio a fin, pero no ve reclamaciones, cotizaciones ni estadísticas. Verificado en `test/atencion-proceso.test.ts` y `test/permissions.test.ts`.

## 4. Endpoints

Todos bajo `/api/admin` y con sesión válida.

| Método y ruta | Permiso | Qué hace |
| --- | --- | --- |
| `GET /messages` | `mensajes:leer` | Bandeja paginada con filtros (ver contrato 8.1) |
| `GET /messages/exportar` | `mensajes:exportar` | CSV controlado (máx. 5 000 filas, sin el texto del mensaje). Solo Gerente General. Ver [exportacion-consultas.md](exportacion-consultas.md) |
| `GET /messages/:id` | `mensajes:leer` | Detalle completo, con correo, teléfono y mensaje íntegro (mismo permiso que la bandeja) |
| `POST /messages` | `mensajes:crear` | Registro manual |
| `PUT /messages/:id` | `mensajes:editar` | Cambio de estado heredado (3 estados). Si ya existe seguimiento responde 409: se usa `PUT seguimiento` |
| `DELETE /messages/:id` | `mensajes:eliminar` | Solo si no tiene cotizaciones ni seguimiento (409 en otro caso) |
| `GET /seguimiento/messages/:id` | `seguimiento_mensajes:leer` | Seguimiento + `transiciones_permitidas` + `cotizaciones` (resumen) |
| `PUT /seguimiento/messages/:id` | `seguimiento_mensajes:editar` | Guarda estado, responsable, notas y respuesta con `revision` |
| `POST /seguimiento/messages/:id/correo` | `seguimiento_mensajes:enviar` | Envía la respuesta guardada |
| `POST /seguimiento/messages/:id/constancia` | `seguimiento_mensajes:enviar` | Reenvía la confirmación a la persona |
| `GET /asistente/resumen`, `POST /asistente/consultar` | sesión (solo lectura) | HORUS Assistant |

## 5. Estados y reglas de negocio

| Estado | Significado |
| --- | --- |
| `nuevo` | Recibida, nadie la ha revisado |
| `en_proceso` | Revisada o asignada; en seguimiento |
| `atendido` | Cerrada con evidencia (respuesta guardada o nota) |
| `archivado` | Fuera del trabajo diario; reabrible |

**Transiciones** (desde → hacia; quedarse en el mismo estado siempre se permite para anotar):

| Desde | Hacia |
| --- | --- |
| `nuevo` | `en_proceso`, `atendido`, `archivado` |
| `en_proceso` | `atendido`, `archivado` |
| `atendido` | `en_proceso`, `archivado` |
| `archivado` | `en_proceso`, `atendido` |

**Reglas** (todas devuelven **400** con un mensaje en español; no escriben nada):

1. Una consulta ya revisada no vuelve a `nuevo`.
2. Pasar a `atendido` exige `respuesta` **o** `notas` con contenido (cómo se atendió: «se llamó al cliente»).
3. No se archiva una consulta con cotizaciones **abiertas** (`borrador`, o `enviada` con vigencia no vencida). `atendido` sí se permite aunque haya una propuesta enviada esperando respuesta del cliente.
4. No se envía una respuesta a una consulta `archivado`: primero se reabre.
5. Guardar exactamente lo ya guardado (misma `revision`) es **idempotente**: no escribe, no sube la revisión ni duplica el historial.
6. `revision` obsoleta → **409**. Un estado desconocido de datos antiguos no atrapa al administrador.
7. Reclamaciones conservan su regla anterior (`atendido` exige respuesta); esta matriz es solo para consultas.

Concurrencia: el guardado bloquea la fila de la consulta (`SELECT … FOR UPDATE`), compara `revision` y escribe con compare-and-swap; el estado de partida se lee dentro de esa transacción, de modo que el `PUT` heredado no puede colarse entre medias. El envío de correo reclama el intento **antes** de contactar al proveedor: dos envíos simultáneos contactan una sola vez; un resultado incierto no se reintenta solo.

## 6. Historial y seguimiento

Cada guardado añade al arreglo `historial`:

```json
{ "accion": "Seguimiento actualizado: atendido", "usuario": 7, "fecha": "2026-10-22T15:04:05.000Z",
  "estado_anterior": "en_proceso", "estado_nuevo": "atendido", "cambios": ["notas", "respuesta"] }
```

- `accion`, `usuario` y `fecha` son los de siempre (el panel ya los muestra). Los otros tres campos son **aditivos**.
- `cambios` lista solo **nombres** de campos (`responsable`, `notas`, `respuesta`): el historial nunca copia notas privadas ni el texto de la respuesta.
- Los intentos de correo van en el mismo historial con la forma `{ correo: { tipo, intento, estado, huella } }` (`iniciado` → `aceptado` | `fallido` | `incierto`).

## 7. Relación con Cotizaciones

- Una cotización se vincula a la consulta por `cotizaciones.contacto_id`.
- El detalle de seguimiento trae un **resumen solo con conteos** (sin datos del cliente): `{ total, abiertas, por_estado }`.
- Regla de coherencia: la consulta no se archiva mientras tenga cotizaciones abiertas; borrar la consulta ya estaba bloqueado si tiene cotizaciones.
- Las cotizaciones siguen con su propio ciclo (`borrador → enviada → aceptada | rechazada | anulada`), su `revision` y su `Idempotency-Key`. Este módulo no las modifica.
- Una cotización `enviada` cuya vigencia pasó se considera vencida (mismo criterio que HORUS Assistant) y **no** bloquea archivar.

## 8. Contratos JSON para el panel React

### 8.1 `GET /api/admin/messages`

Parámetros (todos opcionales; sin ellos todo funciona como antes):

| Parámetro | Valores | Efecto |
| --- | --- | --- |
| `page`, `limit` | enteros (`limit` ≤ 100, 20 por defecto) | Paginación. Sin `page` equivale a `page=1` (ya no devuelve todo; corregido en 4A.1) |
| `estado` | `nuevo`, `en_proceso`, `atendido`, `archivado` | Estado efectivo, filtrado antes de paginar |
| `search` | texto ≤ 100 | Nombre, correo, asunto o mensaje |
| `channel` | `chatbot`, `other` | Origen |
| `responsable` | texto ≤ 100 | **Nuevo.** Responsable exacto del seguimiento |
| `antiguas` | `si` | **Nuevo.** Nuevas o en proceso con más de 48 h (igual que el asistente) |
| `vista` | `resumen` | **Nuevo.** Datos mínimos (privacidad) |

Respuesta por defecto (**sin cambios**, trae datos personales):

```json
{ "ok": true,
  "messages": [{ "id": 12, "nombre": "Ana Pérez", "email": "ana@ejemplo.pe", "telefono": "999111222",
                 "asunto": "Curso de Excel", "mensaje": "Texto completo…", "estado": "nuevo",
                 "createdAt": "2026-10-21T14:00:00.000Z", "updatedAt": "2026-10-21T14:00:00.000Z" }],
  "pagination": { "page": 1, "limit": 20, "total": 1, "pages": 1 },
  "metrics": { "nuevo": 1, "en_proceso": 0, "atendido": 0, "archivado": 0 } }
```

Con `?vista=resumen` cada fila es **solo**:

```json
{ "id": 12, "nombre": "Ana Pérez", "asunto": "Curso de Excel", "vista_previa": "Primeros 160 caracteres…",
  "origen": "web", "responsable": "Rosa", "estado": "nuevo",
  "createdAt": "2026-10-21T14:00:00.000Z", "updatedAt": "2026-10-21T14:00:00.000Z" }
```

`responsable` es `null` si aún no hay seguimiento. `metrics` siempre es global (no depende de los filtros). El detalle (`GET /messages/:id`) conserva `email`, `telefono` y `mensaje` completos.

**Estado de la privacidad (Etapa 4A.2, fase 1):** hoy el servidor **no obliga** a ningún rol a usar `vista=resumen`; sin `vista`, Gerente, Coordinación y Secretaría reciben correo, teléfono y mensaje completo, porque la bandeja de React aún los lee del listado. `vista_previa` (160 caracteres del mensaje) **puede contener información personal** y no equivale a anonimización. El objetivo, aún no activo, es que Coordinación y Secretaría reciban solo los campos mínimos y consulten el detalle cuando lo necesiten. Contrato y pasos: [contrato-etapa-4a2-mensajes.md](contrato-etapa-4a2-mensajes.md).

### 8.2 `GET /api/admin/seguimiento/messages/:id`

```json
{ "ok": true,
  "item": {
    "estado": "en_proceso", "responsable": "Rosa", "notas": "Llamar el lunes", "respuesta": "Hola Ana…",
    "revision": 3,
    "historial": [ { "accion": "Seguimiento actualizado: en_proceso", "usuario": 7, "fecha": "…",
                     "estado_anterior": "nuevo", "estado_nuevo": "en_proceso", "cambios": ["responsable"] } ],
    "envios": { "respuesta": { "estado": "aceptado", "fecha": "…", "intento": "uuid" }, "constancia": null },
    "transiciones_permitidas": ["atendido", "archivado"],
    "cotizaciones": { "total": 2, "abiertas": 1,
                      "por_estado": { "borrador": 0, "enviada": 1, "aceptada": 0, "rechazada": 1, "anulada": 0 } } } }
```

`transiciones_permitidas` es lo que el selector de estado debe ofrecer (además del estado actual). Sin seguimiento previo el backend devuelve un respaldo virtual con `revision: 1` y `historial: []`, sin escribir.

### 8.3 `PUT /api/admin/seguimiento/messages/:id`

Petición (siempre los cuatro campos; sin campos ajenos):

```json
{ "revision": 3, "estado": "atendido", "responsable": "Rosa", "notas": "Se llamó el lunes", "respuesta": "" }
```

Respuesta 200: igual que el `item` anterior (con `transiciones_permitidas`, sin `cotizaciones`; para refrescarlas, repetir el `GET`).

| HTTP | Cuándo | Cuerpo |
| --- | --- | --- |
| 400 | Transición no permitida, cierre sin evidencia, archivar con cotizaciones abiertas, campo inválido | `{ "statusCode": 400, "message": "Para marcar la consulta como atendida registra la respuesta o una nota que indique cómo se atendió." }` |
| 403 | Rol sin `seguimiento_mensajes:editar` | mensaje neutro |
| 404 | La consulta no existe | `Consulta no encontrada.` |
| 409 | `revision` obsoleta | `El seguimiento cambió en otra sesión. Recarga el caso.` |

**Importante para el panel:** un 400 de estas reglas **no** es un conflicto de edición; muestra su `message` en línea y no refresques ni descartes el borrador. El 409 sí significa «otra persona guardó antes».

### 8.4 `POST …/correo` y `POST …/constancia`

Sin cambios de contrato. Salvo el 400 nuevo `La consulta está archivada. Reábrela antes de enviar una respuesta.`

### 8.5 Resumen (`GET /api/admin/stats?vista=operativa`)

`actividadReciente.mensajes[]` ya **no** incluye `email` (el panel no lo usaba): `{ id, nombre, asunto, estado, createdAt }`.

## 9. Relación con HORUS Assistant

- Solo lectura y sin migración. La sección «atención» del asistente usa **la misma consulta de estado efectivo** que la bandeja y el resumen (seguimiento si existe, si no `Contacto.estado`), así que las tres cifras coinciden.
- «Consulta antigua» = nueva o en proceso con más de **48 h**. El valor vive en una sola constante (`HORAS_CONSULTA_ANTIGUA`); el filtro `antiguas=si` del listado y el asistente la comparten, por lo que el número que dice el asistente es el que ve la persona al filtrar.
- Todo son **conteos**: el asistente no selecciona nombres, correos, teléfonos ni texto de mensajes, y la pregunta se rechaza si trae datos personales. A OpenAI solo llegan etiquetas e indicadores de cifras, nunca datos de clientes. La IA no ejecuta SQL ni escribe.

## 10. Ejemplo práctico

1. Ana escribe desde la web: «Quiero información del curso de Excel». Queda `nuevo` (el asistente cuenta «1 consulta nueva»).
2. Rosa (Secretaría) la abre: `PUT` → `en_proceso`, `responsable: "Rosa"`. Historial: `nuevo → en_proceso`.
3. Rosa redacta la respuesta y pulsa «Enviar». El backend reclama el intento, contacta al proveedor y registra `aceptado`. El panel muestra «El proveedor aceptó el correo», **no** «entregado».
4. Rosa intenta cerrar sin escribir nada: 400 «registra la respuesta o una nota». Con la respuesta guardada, el cierre funciona: `en_proceso → atendido`.
5. La coordinadora había preparado una cotización en borrador para Ana. Al intentar archivar la consulta: 400 «tiene cotizaciones abiertas». Envía o anula la cotización y archiva.
6. Si Ana escribe de nuevo, se reabre a `en_proceso`.

## 11. Guion sencillo de sustentación (3 minutos)

1. **Problema** (20 s): «Las consultas se perdían o se cerraban sin saber si se había contestado.»
2. **Recorrido** (40 s): mostrar los cuatro estados y que enviar un correo no cierra el caso: se cierra a propósito.
3. **Honestidad del correo** (30 s): «Aceptado por el proveedor no es entregado; el sistema lo dice así y no reintenta solo un envío dudoso.»
4. **Seguridad y roles** (30 s): la Secretaría atiende consultas pero no ve reclamaciones, cotizaciones ni estadísticas; la lista puede mostrarse sin correos ni teléfonos.
5. **Dos personas a la vez** (30 s): demostrar el 409 «el seguimiento cambió en otra sesión».
6. **Cotizaciones y asistente** (30 s): no se archiva con cotizaciones abiertas; el asistente cuenta lo mismo que la bandeja y nunca recibe datos personales.

## Pruebas

`backend/test/atencion-proceso.test.ts` (18 pruebas, dobles en memoria, sin MySQL ni correo real): reglas, flujo completo, intentos fallidos/inciertos, validaciones y DTO, transiciones, concurrencia, idempotencia, doble envío, cotizaciones, permisos, privacidad del listado y de la actividad reciente, filtros y asistente de solo lectura.

`backend/test/messages-privacidad.test.ts` (6 pruebas, 4A.2 fase 1): contrato de privacidad del listado (con y sin `vista=resumen`), detalle y exportación para los tres roles.

```bash
cd backend
node --test --test-concurrency=1 -r ./test/isolate-env.cjs -r ts-node/register test/atencion-proceso.test.ts test/message-states.test.ts test/mail-reliability.test.ts test/messages-privacidad.test.ts
```

## Pendientes

**Frontend (compañero del panel):** ofrecer solo `transiciones_permitidas`; mostrar los 400 de reglas en línea (no como conflicto); migrar la bandeja a `vista=resumen` y pedir el detalle por id (hoy el detalle y el CSV usan `email`/`telefono` de la fila del listado, por eso el listado completo se conserva por defecto); mostrar el resumen de cotizaciones y el filtro «antiguas».

**Requieren migración (no se hicieron):**
- `responsable_id` (clave a `admin_users`): hoy `responsable` es texto libre de hasta 100 caracteres y no se valida contra cuentas.
- Fechas explícitas de primera respuesta y de cierre (`primera_respuesta_at`, `cerrado_at`) para medir tiempos de atención.
- ~~Permiso `mensajes:exportar`~~ **Resuelto en el backend (4A.1, sin migración):** existe el permiso (solo Gerente General) y el endpoint `GET /messages/exportar`. **Pendiente:** el botón CSV del navegador sigue armando el archivo con el listado completo (cualquiera con `mensajes:leer`) hasta que React migre; el riesgo de extracción masiva sigue abierto (ver contrato 4A.2).
- Pasar automáticamente `nuevo → en_proceso` al crear una cotización desde la consulta (hoy es manual).

**Integración real no realizada:** no se probó contra MySQL ni con correo real; `test/prisma.integration.cjs` (MySQL desechable) no se ejecutó.
