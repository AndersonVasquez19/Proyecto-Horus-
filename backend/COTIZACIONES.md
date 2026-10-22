# Módulo de Cotizaciones

Código: `backend/src/cotizaciones/` (`cotizaciones.module.ts` controlador, `cotizaciones.service.ts`, `cotizacion.dto.ts`, `idempotency.ts`, `quote-rules.ts`).
Pruebas: `test/cotizaciones-flujo.test.ts` y `test/cotizaciones-idempotencia.test.ts` (más las de permisos, correo y asistente que tocan el módulo).

## 1. Objetivo

Que el equipo de Horus Group SRL prepare una propuesta económica para un cliente, la comunique, registre qué pasó con ella y pueda explicarlo después: **quién** hizo **qué**, **cuándo** y **con qué resultado**, sin perder ni duplicar propuestas aunque dos personas trabajen a la vez.

## 2. Problema que resuelve

- Evitar propuestas duplicadas (doble clic, reintento por red, dos administradores a la vez).
- Evitar importes mal calculados: el servidor recalcula todo; el cliente nunca fija subtotal, impuesto, total, estado ni número.
- Evitar estados incoherentes (aceptar un borrador, reabrir una propuesta aceptada, avanzar una vencida).
- No confundir «el sistema envió un correo» con «el cliente lo recibió» o «lo aceptó».
- Dejar trazabilidad en el historial sin tablas nuevas.

## 3. Flujo comercial

En este sistema **la Cotización es a la vez la solicitud atendida y el presupuesto formal**: no existen dos entidades. La *solicitud* del cliente llega como un **mensaje/consulta** (`contactos`: formulario, chatbot o registro manual) y el equipo la atiende desde Atención; el *presupuesto* es la **Cotización** que se crea (opcionalmente vinculada a esa consulta con `contacto_id`). El chatbot puede marcar una consulta como intención comercial (`[Cotización]` en el asunto), pero **no crea ninguna cotización**: la crea una persona.

```
Solicitud del cliente (Contacto/Mensaje)  ── revisión administrativa en Atención
        │
        ▼  POST /admin/cotizaciones (opcional contacto_id)
   BORRADOR ──editar (PUT, solo en borrador)──┐
        │ ▲_________________________________│
        │
        ├─► (comunicar) POST :id/correo      → registra un intento; NO cambia el estado
        │
        ▼  POST :id/estado {estado:'enviada'}   (declarar que la propuesta se entregó al cliente)
    ENVIADA ── seguimiento ──┬─► ACEPTADA  (final)
        │                    └─► RECHAZADA (final)
        └─► ANULADA (final, también desde BORRADOR)
```

Reglas de honestidad del flujo:

- **Enviar el correo no marca la propuesta como «enviada»** y **«enviada» no prueba que el cliente la recibió**. El estado es un registro administrativo: lo cambia una persona con permiso, y el historial guarda quién y cuándo.
- **«Aceptado por el proveedor» de correo no es «entregado»** (y menos «leído» o «aceptado por el cliente»). La API lo dice textualmente en `mensaje` y en `correo.aceptados`.
- **«Aceptada» tampoco prueba la aceptación del cliente por sí sola**: use `nota` para dejar la evidencia (p. ej. «aceptó por correo el 12/10»).
- Un envío cuyo resultado es incierto o está en curso **no se reintenta solo**; hace falta confirmación expresa (`confirmar_reenvio`).

## 4. Roles y permisos

La autorización la aplica `AccessGuard` (global) con la matriz de `permissions/policy.ts`. Sin rol o sin permiso → 401/403. Denegación por defecto.

| Permiso | Gerente general | Coordinadora institucional | Secretaría | Cuenta básica |
| --- | :-: | :-: | :-: | :-: |
| `cotizaciones:leer` | sí | sí | no | no |
| `cotizaciones:crear` | sí | sí | no | no |
| `cotizaciones:editar` | sí | sí | no | no |
| `cotizaciones:enviar` | sí | sí | no | no |
| `cotizaciones:anular` | sí | sí | no | no |

Qué exige cada ruta de estado (`POST :id/estado`, según el campo `estado` del cuerpo):

| Destino | Permisos exigidos |
| --- | --- |
| `enviada` | `cotizaciones:editar` **y** `cotizaciones:enviar` *(nuevo: declarar la propuesta entregada es parte de enviarla)* |
| `aceptada`, `rechazada` | `cotizaciones:editar` |
| `anulada` | `cotizaciones:editar` **y** `cotizaciones:anular` |

La secretaría no ve cotizaciones (datos personales y comerciales del cliente). Los datos del cliente (correo, teléfono, documento, dirección) solo salen en rutas con `cotizaciones:leer`.

## 5. Endpoints

Todos bajo `/api/admin/cotizaciones`, con `Authorization: Bearer <JWT>`.

| Método y ruta | Permiso | Descripción |
| --- | --- | --- |
| `GET /` | leer | Listado paginado **mínimo** (sin datos personales del cliente, historial, conceptos, condiciones ni datos del emisor; ver §5.1). |
| `GET /:id` | leer | Detalle completo (incluye los datos personales) + `vencida` + `correo` (resumen de envíos). |
| `GET /:id/pdf` | leer | Descarga la cotización en **PDF** A4 para el cliente (`application/pdf`, `attachment`, `Cache-Control: no-store`). Solo lectura: no cambia estado, revisión ni historial; no se guarda en disco ni se envía por correo. Lleva número, fechas, cliente (nombre, documento, dirección), emisor, conceptos, importes guardados, estado y condiciones; **no** lleva correo ni teléfono del cliente, historial, revisiones ni datos internos. Borrador y anulada se rotulan con marca de agua. 404 si no existe. |
| `POST /` | crear | Crea un **borrador**. Encabezado opcional `Idempotency-Key`. |
| `POST /:id/duplicar` | crear | Crea una cotización **nueva** en borrador a partir de otra, en cualquier estado. Hereda cliente, conceptos, importes, condiciones y consulta de origen; **no** hereda id, número, estado, revisión, historial/correos ni clave de idempotencia. La original no se modifica. La vigencia se conserva tal cual: si la original ya venció, la copia queda en borrador con esa fecha pasada y la respuesta incluye `requiere_nueva_vigencia: true`; no puede enviarse ni pasar a «enviada» hasta editar el borrador con una vigencia nueva (no existe un plazo comercial predeterminado y no se inventa uno). `Idempotency-Key` opcional (misma clave + misma original + mismo usuario = misma copia; otra combinación, 422). Sin cuerpo. |
| `PUT /:id` | editar | Reemplaza el contenido de un **borrador** (exige `revision`). |
| `POST /:id/correo` | enviar | Envía el correo con la propuesta (exige `revision`). No cambia el estado. |
| `POST /:id/estado` | según destino | Cambia el estado (exige `revision`; admite `nota`). |

Consulta del listado (`GET /`): `page` (1–100000, def. 1), `limit` (1–100, def. 12), `search` (≤100; busca en número, cliente y correo), `estado` (`borrador|enviada|aceptada|rechazada|anulada`), **`contacto_id`** (cotizaciones de una consulta de Atención) y **`vencida=si`** (solo enviadas con la vigencia pasada). Orden: más recientes primero; el `id` desempata (`createdAt` tiene precisión de segundos).

### 5.1 Exposición de datos personales (listado vs. detalle)

**Listado `GET /` — campos expuestos:** `id`, `numero`, `estado`, `revision`, `vencida`, `cliente`, `emisor`, `moneda`, `validez`, `subtotal`, `descuento`, `tasa`, `impuesto`, `total`, `contacto_id`, `createdAt`, `updatedAt`. Más `pagination`.

**Reservado para el detalle `GET /:id`** (y para la respuesta de crear/editar/cambiar estado, que son del mismo administrador con permiso): `email`, `telefono`, `documento`, `direccion`, `datos_emisor`, `condiciones`, `conceptos`, `historial` y el resumen `correo`.

- **Roles autorizados** (tanto listado como detalle, permiso `cotizaciones:leer`): Gerente general y Coordinadora institucional. Secretaría y cuenta básica reciben 403 en ambas rutas. No existe ninguna ruta pública ni del Asistente que devuelva datos del cliente.
- `search` sigue buscando por número, cliente **y correo** en el servidor, pero el correo ya no vuelve en el listado.
- `idempotencia_clave` e `idempotencia_huella` nunca salen en la API.

**Compatibilidad (verificada en el frontend actual):** la tabla de `PanelQuotes` solo lee `id`, `numero`, `cliente`, `estado`, `total` y `moneda`; la comprobación de duplicados de `QuoteForm` solo lee `cliente`, `createdAt`, `contacto_id`, `numero` y `estado`; abrir, editar y duplicar parten de `GET /:id`. Ninguna referencia real usa `email`, `telefono`, `documento` ni `direccion` del listado. Aviso: el tipo TypeScript `Quote` del frontend los declara como obligatorios (no afecta en ejecución); cualquier cliente externo que los leyera del listado debe pasar al detalle.

### Contratos JSON

**Crear — `POST /api/admin/cotizaciones`** (encabezado opcional `Idempotency-Key: <16–128 caracteres [A-Za-z0-9._:-]>`; recomendado: una clave por intento de «Guardar», reutilizada solo al reintentar la misma operación)

```json
{
  "cliente": "Constructora Andina SAC",
  "email": "compras@andina.example",
  "telefono": "999 111 222",
  "documento": "20123456789",
  "direccion": "Av. Principal 123, Lima",
  "emisor": "Horus Group SRL",
  "datos_emisor": "RUC 20000000000 · Av. Ejemplo 100",
  "moneda": "PEN",
  "validez": "2026-11-30",
  "condiciones": "Pago 50% adelanto.",
  "conceptos": [{ "descripcion": "Capacitación in-house", "cantidad": 2, "precio": 1500.5 }],
  "descuento": 100,
  "tasa": 18,
  "contacto_id": 42
}
```

`email`, `telefono`, `documento`, `direccion`, `datos_emisor` y `condiciones` pueden ir vacíos (`""`). `contacto_id` es opcional. `validez` (`YYYY-MM-DD`) **no puede ser anterior a hoy en Lima**.

Respuesta `201`:

```json
{
  "ok": true,
  "item": {
    "id": 17, "numero": "COT-2026-000017", "estado": "borrador", "revision": 1, "vencida": false,
    "cliente": "Constructora Andina SAC", "email": "compras@andina.example", "moneda": "PEN", "validez": "2026-11-30", "contacto_id": 42,
    "conceptos": [{ "descripcion": "Capacitación in-house", "cantidad": 2, "precio": 1500.5, "importe": 3001 }],
    "subtotal": 3001, "descuento": 100, "tasa": 18, "impuesto": 522.18, "total": 3423.18,
    "historial": [{ "accion": "Creada como borrador", "usuario": 3, "fecha": "2026-10-22T15:04:05.000Z" }],
    "createdAt": "2026-10-22T15:04:05.000Z", "updatedAt": "2026-10-22T15:04:05.000Z"
  }
}
```

Con la misma `Idempotency-Key` y el mismo contenido (y mismo administrador) se devuelve la misma cotización con `"reutilizada": true` y estado actual. Con otro contenido → `422`.

**Detalle — `GET /:id`** (campos extra respecto al alta; los importes salen como texto con 2 decimales, p. ej. `"3423.18"`):

```json
{
  "ok": true,
  "item": {
    "id": 17, "numero": "COT-2026-000017", "estado": "enviada", "revision": 5, "vencida": false, "validez": "2026-11-30",
    "subtotal": "3001.00", "impuesto": "522.18", "total": "3423.18",
    "historial": [
      { "accion": "Creada como borrador", "usuario": 3, "fecha": "2026-10-22T15:04:05.000Z" },
      { "accion": "Correo de cotización: aceptado por el proveedor (no confirma la entrega)", "usuario": 3, "fecha": "2026-10-22T15:10:00.000Z",
        "correo": { "intento": "5f0c…", "tipo": "cotizacion", "estado": "aceptado", "huella": "9a1b…", "proveedor_id": "msg-1" } },
      { "accion": "Estado: enviada", "usuario": 3, "fecha": "2026-10-22T15:12:00.000Z", "estado_anterior": "borrador", "estado_nuevo": "enviada" }
    ],
    "correo": { "intentos": 1, "aceptados": 1, "fallidos": 0, "inciertos": 0, "en_curso": 0, "ultimo": { "intento": "5f0c…", "estado": "aceptado", "fecha": "2026-10-22T15:10:00.000Z" } }
  }
}
```

`vencida` y `correo` se calculan al responder; no se guardan.

**Cambiar estado — `POST /:id/estado`**

```json
{ "estado": "rechazada", "revision": 5, "nota": "El cliente eligió otra oferta" }
```

`estado` ∈ `enviada|aceptada|rechazada|anulada`. `nota` es opcional (≤500) y aparece en el historial (`accion`: `"Estado: rechazada — El cliente eligió otra oferta"`, más `estado_anterior`, `estado_nuevo` y `nota`). Respuesta `200`: `{ "ok": true, "item": { …detalle… } }`.

**Editar — `PUT /:id`**: mismo cuerpo que crear más `"revision": <int>`. Solo borradores. **Reemplaza** el contenido: si se omite `contacto_id`, la cotización queda sin vínculo.

**Enviar correo — `POST /:id/correo`**: `{ "revision": 5, "confirmar_reenvio": false }`. Solo `borrador` o `enviada`, con correo del cliente y vigencia vigente.

- `200` `{ "ok": true, "envio": "aceptado", "mensaje": "El proveedor aceptó el correo… Esto no confirma que ya esté en la bandeja del cliente.", "intento": "…", "registrado": true, "item": {…}, "revision": 7 }`
- `409` `{ "ok": false, "envio": "bloqueado", "motivo": "en_curso|ya_aceptado|incierto", "requiere_confirmacion": true, "mensaje": "…" }` → repetir con `confirmar_reenvio: true` solo si la persona lo confirma.
- `503` `{ "envio": "fallido", … }` (el proveedor lo rechazó; se puede reintentar) · `502` `{ "envio": "incierto", … }` (no se sabe si salió; **no reintentar sin revisar el historial**).

### Errores

| Código | Cuándo |
| --- | --- |
| 400 | Entrada inválida (campo desconocido, tipo, longitud, fecha imposible o anterior a hoy, correo inválido, descuento mayor al subtotal, consulta de origen inexistente, `Idempotency-Key` mal formada). |
| 401 / 403 | Sin sesión / sin permiso para esa acción. |
| 404 | Cotización inexistente. |
| 409 | `revision` desactualizada (alguien más cambió la cotización), transición no permitida, edición de una propuesta que ya no es borrador, propuesta vencida, envío que requiere confirmación. |
| 409 (concurrencia) | Conflicto de concurrencia de la base (interbloqueo / conflicto de escritura) al crear, duplicar o cambiar una cotización: «Otra operación estaba modificando los mismos datos. No se guardó nada; vuelve a intentarlo.» No se reintenta solo (ver §10.1). |
| 422 | Misma `Idempotency-Key` con contenido o administrador distinto. |
| 502 / 503 | Resultado de correo incierto / fallido (ver arriba). |

Los mensajes son en español, sin detalles internos.

## 6. Datos y relaciones

Tabla `cotizaciones` (modelo Prisma `Cotizacion`):

- `numero` único: nuevas cotizaciones `COT-AAAA-NNNNNN` (NNNNNN = id con ceros). Las anteriores a este cambio conservan su número (`COT-AAAA-<uuid>`).
- Cliente: `cliente`, `email`, `telefono`, `documento`, `direccion`. Emisor: `emisor`, `datos_emisor`.
- Económico: `moneda` (`PEN|USD`), `conceptos` (JSON), `subtotal`, `descuento`, `tasa`, `impuesto`, `total` (DECIMAL; el servidor calcula en céntimos enteros).
- `validez` (DATE), `condiciones`, `estado`, `revision` (control de concurrencia), `historial` (JSON, bitácora), `idempotencia_clave` (UNIQUE) e `idempotencia_huella` (internas, nunca salen en la API).
- `contacto_id` → `contactos.id` (`ON DELETE RESTRICT`): una consulta con cotizaciones vinculadas **no se puede eliminar** (lo comprueba `MessagesService.remove` y lo garantiza la FK).

No existe endpoint para eliminar cotizaciones: se **anulan** y se conservan.

## 7. Estados

| Estado | Significado | Siguientes |
| --- | --- | --- |
| `borrador` | Propuesta en preparación; única editable | `enviada`, `anulada` |
| `enviada` | Una persona declaró que la propuesta se entregó al cliente | `aceptada`, `rechazada`, `anulada` |
| `aceptada` | Se registró que el cliente aceptó (final) | — |
| `rechazada` | Se registró que el cliente rechazó (final) | — |
| `anulada` | Cancelada internamente (final) | — |

Además: **vencida** no es un estado guardado sino un indicador (`vencida: true`) para una propuesta `enviada` cuya `validez` ya pasó. Una propuesta con vigencia pasada no puede pasar a `enviada` ni a `aceptada`; sí puede cerrarse como `rechazada` o `anulada`.

## 8. Validaciones

- Cuerpo estricto (`whitelist` + `forbidNonWhitelisted`): campos desconocidos o calculados (`total`, `estado`, `numero`, `revision` en el alta…) → 400.
- Texto recortado y con longitud máxima; `moneda` `PEN|USD`; 1–50 conceptos con cantidad entera 1–10000 y precio ≥ 0 con 2 decimales; `descuento` ≤ subtotal; `tasa` 0–100 %; tope de importe total.
- `validez`: formato `YYYY-MM-DD`, fecha real y **no anterior a hoy (hora de Lima)**.
- `email`: formato básico si se informa; el envío exige correo.
- `Idempotency-Key`: 16–128 caracteres `[A-Za-z0-9._:-]`.
- Estado y edición: `revision` obligatoria en edición, cambio de estado y envío (compare-and-swap).

## 9. Integraciones con otros módulos

- **Contactos / Atención**: `contacto_id` vincula la cotización con la consulta de origen (se verifica que exista). `GET /?contacto_id=` lista las cotizaciones de una consulta. Eliminar una consulta con cotizaciones se bloquea (409). Crear (o duplicar) una cotización vinculada a una consulta cuyo estado efectivo (el del seguimiento si existe; si no, el de la consulta) es **«nuevo»** la pasa a **«en_proceso»** en la **misma transacción**: bloqueo de la fila de origen, seguimiento creado o con revisión +1 y entrada en su historial (`origen: cotizacion`). La respuesta añade `consulta: { id, estado, actualizada }`. Cualquier otro estado (en_proceso, atendido, archivado) se respeta. Si algo falla, no queda ni la cotización ni el cambio de estado.
- **Correo**: usa el registro de intentos común con Atención (`mail/mail-attempts.ts`) y respeta `MAIL_PROVIDER`. Sin correo real en pruebas.
- **Estadísticas** (`/admin/stats/activity`): cuenta cotizaciones por estado; no cambia.
- **HORUS Assistant**: solo **lee** (`groupBy` por estado y conteo de enviadas vencidas, con el mismo criterio que `vencida`). Nunca modifica cotizaciones, estados ni importes; una prueba lo verifica.
- **Reportes** (`reportes/`): son académicos; **no existe un reporte de cotizaciones** y no se creó uno artificial.
- **Permisos**: `route-inventory.ts` documenta cada ruta; las pruebas de permisos lo cruzan con los decoradores.

## 10. Pruebas ejecutadas

Registro de la validación de este cambio (todo con dobles en memoria, sin MySQL, correo real ni red):

- `tsc --noEmit` en `backend/`: sin errores.
- `node --test --test-concurrency=1 -r ./test/isolate-env.cjs -r ts-node/register` sobre 14 archivos relacionados (`cotizaciones-flujo`, `cotizaciones-idempotencia`, `permissions`, `access-guard`, `mail-reliability`, `validation-rules`, `backend-regressions`, `stats-activity`, `asistente*`, `message-states`, `migrations`): **261 pruebas, 261 aprobadas**.
- `git diff --check`: sin problemas.
- **No se ejecutó**: la suite completa, `test:integration` (requiere MySQL), ni pruebas contra una base real. El comportamiento transaccional real de MySQL (el UPDATE con `revision` y el índice UNIQUE) está simulado, no ejecutado.

### PDF de la cotización (`GET /api/admin/cotizaciones/:id/pdf`)

- **Endpoint y permiso**: `GET /api/admin/cotizaciones/:id/pdf`, con `cotizaciones:leer` (el mismo del detalle). Gerente general y coordinadora lo obtienen; la secretaria, la cuenta sin rol y la sesión anónima reciben 403/401 sin llegar al servicio. La ruta figura en `route-inventory.ts` con ese permiso.
- **Solo lectura**: el PDF se genera al vuelo y no altera la cotización (estado, revisión e historial intactos); no se guarda en disco ni se envía por correo.
- **Pruebas nuevas** (`cotizaciones-pdf.test.ts`): **13/13** aprobadas.
- **Pruebas relacionadas con Node 24.19.0**: **373/373** aprobadas (archivos de cotizaciones, PDF, permisos y acceso).
- **Node 22.23.3** (portable, solo para esta verificación): `tsc --noEmit` y `nest build` sin errores; **112/112** pruebas aprobadas sobre un subconjunto más acotado (`cotizaciones-pdf`, `cotizaciones-flujo`, `cotizaciones-idempotencia`, `permissions`, `access-guard`, `certificados-pdf`, `session-access`). No es el mismo conjunto de 373 pruebas.
- **Limitaciones**: todo con dobles en memoria, sin MySQL real; no se ejecutó la suite completa (poca RAM libre en el equipo) ni `test:integration`.
`cotizaciones-flujo.test.ts` cubre: número legible, vigencia, flujo completo, todas las transiciones prohibidas, vencidas, dos cambios de estado simultáneos, dos envíos simultáneos, edición solo en borrador, filtros y orden del listado, resumen de correo, validación de entrada, roles/permisos y lectura-solo del Asistente.

### 10.1 Vigencia al duplicar, ensayo con MySQL real y conflictos de concurrencia

**Política definitiva de vigencia al duplicar.** La copia conserva SIEMPRE la fecha de vigencia de la original (no existe un plazo comercial predeterminado y no se inventa uno). Si la original ya venció, la copia queda en borrador con esa fecha pasada, la respuesta incluye `requiere_nueva_vigencia: true` (también al repetir la misma `Idempotency-Key`) y el historial anota `vigencia_pendiente`. No puede enviarse ni pasar a «enviada» (409) hasta editar el borrador con una vigencia nueva válida (la edición rechaza fechas anteriores a hoy con 400). Sin cambios de esquema ni migraciones.

**Ensayo con MySQL 8.0.46 real y aislado (13/13).** Clon temporal con `--no-defaults`, datadir y puerto propios, UUID distinto del servicio MySQL80, esquema vacío creado con `db:init` + `db:migrate` (18 migraciones) y solo datos ficticios; nada de `horus_db` ni `horus_local`. Se ejercitó `CotizacionesService` compilado con Prisma real (13 comprobaciones superadas): creación vinculada a una consulta «nuevo»; paso atómico a `en_proceso` con seguimiento (revisión 2); historial correcto; una segunda cotización no repite la transición; duplicar con `Idempotency-Key`; copia de una original vencida; 8 duplicaciones y 8 creaciones simultáneas con la misma clave (una sola fila y una sola transición); rollback completo ante un fallo controlado (disparador SQL temporal solo en el clon: sin cotización huérfana, sin clave consumida, consulta en «nuevo», reintento correcto); 6 creaciones simultáneas sobre la misma consulta (exactamente una transición); restricciones `UNIQUE(recurso, registro_id)`, `UNIQUE(idempotencia_clave)` y la clave foránea de la consulta; e integridad final (sin números ni seguimientos duplicados).

**Interbloqueos observados.** Bajo concurrencia real, algunas solicitudes simultáneas fallaron con el interbloqueo 1213 de MySQL o el conflicto de escritura P2034 de Prisma (p. ej. 1 de 8 con la misma clave y 3 de 6 sobre la misma consulta). La base permaneció consistente (cada transacción afectada se revirtió entera), pero el servicio no traducía el error y se habría respondido un 500.

**Manejo HTTP 409 implementado.** `CotizacionesService` reconoce de forma estructurada solo `P2034` y el código MySQL `1213` (por `mysqlErrorCode`, el mismo mecanismo de las cuentas; no se analizan textos) y responde 409 con un mensaje seguro, sin detalles de MySQL ni Prisma. Cualquier otro error, incluido uno cuyo texto mencione «deadlock», se propaga sin convertirse en 409. **No hay reintentos automáticos**; la transacción no cambió. Los interbloqueos **no desaparecen**: solo se traducen a 409. Repetir la solicitud con la misma `Idempotency-Key` es seguro y devuelve la misma cotización. Repetido el escenario de concurrencia con el 409 activo (6 rondas de 6 solicitudes sobre la misma consulta y 4 de 8 con la misma clave), no quedó ningún error sin traducir, una sola transición y un solo seguimiento por consulta, y ninguna cotización, seguimiento ni número duplicado (3 de 6 y 7 de 8 se aceptaron, el resto recibió 409).

**Limitaciones de este ensayo.** Se probó el servicio, no la API HTTP completa: no se ejercitaron controladores, guards, JWT, límites de frecuencia ni el filtrado de excepciones de Nest (que convierte un error no tratado en un 500 genérico). No se probaron el PDF ni el correo contra la base real, y la carga fue pequeña (6–8 solicitudes en paralelo, un solo proceso). Las evidencias sanitizadas están fuera del repositorio.

## 11. Limitaciones pendientes

**Mejoras que requieren migración (no hechas):**

1. Separar *solicitud* y *presupuesto formal*, o versionar propuestas (p. ej. `reemplaza_a_id`, para «duplicar y renegociar» una rechazada): hoy una propuesta enviada no se edita; `POST /:id/duplicar` ya permite preparar otra, pero sin vínculo formal entre original y copia (solo la mención en el historial de la copia).
2. Numeración correlativa por año (contador propio): hoy `NNNNNN` es el id global.
3. Columnas de auditoría estructuradas: `creada_por`, `enviada_at`, `respondida_at`, `motivo_cierre` (hoy están en el JSON de `historial`).
4. Índices `(estado, validez)` y `(createdAt, id)` si el volumen crece; búsqueda de texto completo (hoy `LIKE '%…%'`).
5. Confirmación real de entrega o apertura del correo (requiere webhooks del proveedor y tablas).
6. Aceptación verificable del cliente (enlace firmado/token): hoy la aceptación es un registro manual.

**Pendientes sin migración, a coordinar con el frontend:**

- El listado **ya no** devuelve `email`, `telefono`, `documento` ni `direccion` (§5.1). Pendiente en el frontend (fuera de este cambio): ajustar el tipo `Quote` para que esos campos sean opcionales en listados, y no añadir columnas de datos personales a la tabla sin pedir el detalle.
- Las respuestas de crear, editar y cambiar estado siguen devolviendo la cotización completa (con datos personales) a quien tiene el permiso de esa acción; hoy coinciden con los roles de `cotizaciones:leer`. Si un rol llegara a tener `crear` sin `leer`, habría que recortar esas respuestas.
- Sin integración real probada: el listado con `omit` se verificó con dobles en memoria, no contra MySQL real.
- `nota` es opcional; para `rechazada`/`anulada` convendría hacerla obligatoria cuando el panel la pida.
- Reintentar un cambio de estado tras perder la respuesta devuelve 409 (la revisión ya avanzó); el panel debe recargar el detalle.
- `PUT` reemplaza `contacto_id`: el panel debe reenviarlo al editar.
- Vigencia: la comprobación usa el día de Lima en el servidor.
- Con mucha concurrencia sobre la misma consulta, parte de las solicitudes recibe 409 (interbloqueo traducido, no evitado): el panel debe permitir reintentar con la misma `Idempotency-Key`.
- Falta una prueba de extremo a extremo con la API HTTP y varios clientes reales contra MySQL.

## 12. Explicación sencilla para la sustentación

> Una cotización nace como **borrador**. Mientras es borrador se puede corregir; cada cambio sube un número de **revisión**, así que si dos personas editan a la vez, la segunda recibe un aviso en lugar de pisar a la primera.
>
> Se puede mandar por **correo**, pero el sistema es honesto: el proveedor dice «recibí tu pedido», no «el cliente lo leyó». Por eso mandar el correo **no** cambia el estado; una persona marca **enviada** cuando de verdad la entregó, y luego **aceptada** o **rechazada** según lo que diga el cliente, dejando una **nota** de evidencia. Aceptada, rechazada y anulada son finales.
>
> Una propuesta vencida no puede avanzar. Todo queda en un **historial** (quién, qué, cuándo). El servidor calcula los importes —el cliente no puede falsearlos— y exige permiso distinto para ver, crear, editar, enviar y anular. Si se hace doble clic al guardar, una **clave de idempotencia** evita crear dos. El Asistente solo lee estas cifras; nunca las cambia.
