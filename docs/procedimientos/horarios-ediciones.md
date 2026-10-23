# Horarios de las ediciones

Fecha: 23 de octubre de 2026 (America/Lima). Estado: **backend implementado y probado; sin pantallas; migración activada en `horus_db` local el 23/10/2026** ([activación](activacion-preinscripciones-horarios.md)); pendiente en `horus_local`, Railway y demás bases.

Los horarios son los **días y horas recurrentes** en que se dicta una edición (por ejemplo, lunes y miércoles de 19:00 a 22:00 y sábado de 09:00 a 13:00). **No son clases individuales**: no tienen fecha, estado, reprogramaciones ni seguimiento. El módulo de Sesiones, que administraba clases concretas, se **retiró** (ver [Sesiones retiradas](#sesiones-retiradas)).

Código: `backend/src/horarios/` (DTO, reglas puras, servicio y controlador) y `backend/src/common/lima-time.ts` (hora de pared de Lima, compartida con HORUS Assistant). Migración: `backend/migrations/20261023-convocatoria-horarios.sql`.

## 1. Modelo de datos

Tabla `convocatoria_horarios` (una fila por tramo semanal):

| Columna | Tipo | Regla |
| --- | --- | --- |
| `id` | `INT AUTO_INCREMENT` | Identificador único |
| `convocatoria_id` | `INT NOT NULL` | Edición. Clave foránea `convocatoria_horarios_convocatoria_fk` → `convocatorias(id)`, `ON DELETE RESTRICT ON UPDATE RESTRICT` |
| `dia_semana` | `TINYINT NOT NULL` | ISO-8601: **1 = lunes … 7 = domingo**. `CHECK convocatoria_horarios_dia_chk` (1–7) |
| `hora_inicio`, `hora_fin` | `TIME NOT NULL` | Hora de pared de **America/Lima**, minutos exactos. `CHECK convocatoria_horarios_horas_chk`: `00:00 ≤ inicio < fin ≤ 23:59`, segundos en cero |
| `createdAt` | `DATETIME(3)` | Alta del tramo |

- **Duplicados:** `UNIQUE convocatoria_horarios_inicio_uq (convocatoria_id, dia_semana, hora_inicio)`: dos tramos de una misma edición no pueden empezar el mismo día a la misma hora. El índice también sirve a la clave foránea y a la lectura por edición.
- **Solapamientos:** MySQL no tiene restricciones de exclusión por intervalos; los impide el servicio, que valida el **conjunto completo** antes de escribir y escribe bajo el bloqueo de la edición. Los intervalos son `[inicio, fin)`: un tramo puede empezar justo cuando termina otro (09:00–12:00 y 12:00–14:00 se admiten). Un `INSERT` por SQL directo puede saltarse esta regla (igual que ocurría con Sesiones).
- **Horarios distintos por día y varios tramos el mismo día:** se admiten (lunes 19–22, sábado 09–13 y 14–17).
- **Sin cruce de medianoche:** una clase que pase de las 23:59 se registra como dos tramos.
- **Borrar una edición:** la relación es `RESTRICT`, como todo el esquema académico. Las ediciones no se borran (se archivan) y no hay `DELETE` de ediciones en la API; un borrado por SQL de una edición con horarios se rechaza (1451) en lugar de borrar horarios en cascada.
- **Zona horaria:** `TIME` guarda la hora tal como se anuncia en Lima; no depende de la zona del sistema ni de MySQL (`America/Lima` es UTC-5 todo el año). La integración lo comprueba con MySQL en `+13:00` y la API en `Pacific/Auckland`.

Prisma: modelo `ConvocatoriaHorario` (`dia_semana Int @db.TinyInt`, horas `DateTime @db.Time(0)`), relación `Convocatoria.horarios`. `db:check` verifica columnas, tipos, índice único, clave foránea restrictiva y los dos `CHECK` con su expresión.

## 2. API (contrato para React)

Prefijo `/api`. Ambas rutas exigen JWT (`Authorization: Bearer …`) y pasan por `AccessGuard`. Reutilizan los permisos de Ediciones **sin cambiar la matriz de roles**:

| Ruta | Permiso | Gerencia | Coordinación | Secretaría | Cuenta sin rol |
| --- | --- | --- | --- | --- | --- |
| `GET /admin/convocatorias/:id/horarios` | `convocatorias:leer` | ✔ | ✔ | ✔ | 403 |
| `PUT /admin/convocatorias/:id/horarios` | `convocatorias:editar` | ✔ | ✔ | 403 | 403 |

Sin sesión: 401. No hay `POST`, `PATCH` ni `DELETE` por tramo: el `PUT` **reemplaza el conjunto completo**.

### `GET /admin/convocatorias/:id/horarios`

```json
{
  "ok": true,
  "convocatoria": { "id": 7, "nombre": "Excel Básico – Noviembre", "estado": "abierta", "archivada": false, "revision": 4, "modificable": true },
  "zona_horaria": "America/Lima",
  "items": [
    { "id": 12, "dia_semana": 1, "dia": "lunes", "hora_inicio": "19:00", "hora_fin": "22:00" },
    { "id": 13, "dia_semana": 3, "dia": "miércoles", "hora_inicio": "19:00", "hora_fin": "22:00" },
    { "id": 14, "dia_semana": 6, "dia": "sábado", "hora_inicio": "09:00", "hora_fin": "13:00" }
  ]
}
```

- `items` viene ordenado por día y hora de inicio. Una edición sin horarios devuelve `items: []`.
- `convocatoria.revision` es la **revisión de la edición** (la misma que usan Editar, abrir, cerrar, archivar y la recepción de preinscripciones). Es la que debe enviarse en el siguiente `PUT`.
- `modificable` es `false` si la edición está archivada o cancelada: el panel debe mostrar los horarios en modo consulta.
- 404 si la edición no existe; 400 si `:id` no es un entero positivo.

### `PUT /admin/convocatorias/:id/horarios`

Cuerpo (estricto: cualquier campo ajeno, como `id`, `convocatoria_id` o `fecha`, responde 400):

```json
{
  "revision": 4,
  "horarios": [
    { "dia_semana": 1, "hora_inicio": "19:00", "hora_fin": "22:00" },
    { "dia_semana": 3, "hora_inicio": "19:00", "hora_fin": "22:00" },
    { "dia_semana": 6, "hora_inicio": "09:00", "hora_fin": "13:00" }
  ]
}
```

- `dia_semana`: entero 1–7 (número JSON, no cadena). Horas: `HH:MM` de 24 horas con dos dígitos (`"07:00"`, nunca `"7:00"` ni `"07:00:00"`).
- Máximo **21** tramos por edición. Una lista vacía deja la edición sin horarios (operación explícita).
- Respuesta 200: la misma forma que el `GET`, más `cambios: true|false`. Con `cambios: true` la revisión de la edición **sube en 1**: React debe adoptar `convocatoria.revision` de la respuesta para cualquier operación posterior sobre la edición (incluido Editar). Reenviar exactamente el mismo conjunto devuelve `cambios: false` y no sube la revisión ni deja historial.
- Los tramos que no cambian conservan su `id`; cambiar la hora de fin de un tramo es retirarlo y crear otro (id nuevo).

Errores (todos con mensaje en español, sin SQL ni detalles internos):

| Estado | Cuándo | Cuerpo relevante |
| --- | --- | --- |
| 400 | Tipos, formato de hora, día fuera de 1–7, más de 21 tramos, campos ajenos | `message` (lista de validación) |
| 404 | La edición no existe | `message` |
| 409 | Revisión obsoleta (otro usuario cambió la edición o sus horarios), edición archivada o cancelada, o colisión concurrente | `message` |
| 422 `HORARIO_INVALIDO` | Alguna hora de fin igual o anterior a la de inicio | `codigo`, `tramos: [{ indice, dia_semana, dia, hora_inicio, hora_fin }]` |
| 422 `HORARIO_DUPLICADO` | Dos tramos idénticos (mismo día, inicio y fin) | `codigo`, `conflictos: [{ tipo, primero, segundo }]` |
| 422 `HORARIO_SOLAPADO` | Dos tramos del mismo día que se solapan | `codigo`, `conflictos: [{ tipo: "solapamiento", primero, segundo }]` |
| 503 | La tabla aún no existe (migración pendiente) | mensaje neutro |

Guía para React:

- Cargar con `GET` al abrir la edición; editar la lista en memoria; enviar el conjunto completo con la `revision` recibida. Usar `panelRequest`.
- Ante **409** conservar el borrador local, avisar y ofrecer recargar (`GET`) para comparar; no reintentar automáticamente con la revisión nueva (podría pisar el cambio de otra persona).
- Ante **422** señalar en línea los tramos de `tramos`/`conflictos`. Se puede validar en el cliente lo mismo (fin > inicio, sin solapamientos por día) para avisar antes, pero la validación que cuenta es la del servidor.
- Mostrar el botón de guardar solo con `convocatorias:editar` (`usePanelAccess().can('convocatorias:editar')`) y cuando `modificable` sea `true`; la secretaría ve los horarios en modo consulta. Declarar el permiso de la escritura en `PANEL_ACTIONS`/`RESOURCE_WRITE` (`test:panel-access` lo contrasta con `route-inventory.ts`).
- Tras guardar, actualizar la revisión de la edición en el estado del panel: un `PUT /admin/convocatorias/:id` con la revisión anterior responderá 409.
- Etiquetas de los días: usar `dia` de la respuesta o la misma tabla ISO (1 lunes … 7 domingo).

## 3. Reglas del servicio

1. **Validación previa (sin tocar la base):** cada tramo con fin > inicio; sin duplicados ni solapamientos del mismo día (comparación de todos los pares). Si falla, 422 y no se abre ninguna transacción.
2. **Transacción única `READ COMMITTED`** con el orden de bloqueo común a Ediciones, Matrículas y Preinscripciones: `SELECT … FROM cursos … FOR UPDATE` → `SELECT … FROM convocatorias … FOR UPDATE`. Dentro: comprobar la revisión (409), comprobar que la edición no esté archivada ni cancelada (409; planificada, abierta y **cerrada** sí admiten cambios, porque una edición cerrada a nuevas matrículas puede seguir dictándose), calcular la diferencia, **retirar** los tramos que ya no figuran, **insertar** los nuevos, subir la revisión de la edición (`updateMany` condicionado a la revisión) y registrar el historial.
3. **Historial** (`academico_historial`, misma transacción): `entidad = convocatoria`, `operacion = edicion`, `campos = ["horarios"]`, la revisión resultante, el actor y su rol, y en `estado_anterior`/`estado_nuevo` solo el número de tramos («2 horarios» → «3 horarios»). No se añadieron valores al ENUM del historial.
4. **Atomicidad:** si falla cualquier paso (incluido el historial), no queda ningún cambio: ni tramos, ni revisión, ni historial (probado con un `TRIGGER` que hace fallar el historial).
5. **Concurrencia:** dos reemplazos simultáneos con la misma revisión → uno 200 y otro 409, y el estado final es exactamente el del ganador; lo mismo frente a una edición simultánea de la edición (5 rondas en la integración).

## 4. Migraciones

### Secuencia vigente (`versions` en `backend/scripts/migrate.cjs`)

`… 20261019-importaciones-academicas`, `20261020-docentes`, `20261020-preinscripciones`, `20261023-convocatoria-horarios`.

- `20261020-preinscripciones` sigue **pendiente** y aplicable: no depende de la migración de sesiones (no la referencia ni usa sus valores de ENUM; lo comprueba `test/migrations.test.ts`).
- `20261023-convocatoria-horarios` va al final: depende de `convocatorias` (`20261015-academico-estructura`). Una sola sentencia `CREATE TABLE IF NOT EXISTS`: atómica e idempotente (una interrupción se completa repitiendo `db:migrate`; una tabla preexistente con otra forma no se corrige en silencio: `db:check` la rechaza).

### Migración retirada: `20261020-sesiones-academicas`

- Se declara en la lista explícita `retired` de `migrate.cjs`, con su motivo. Su archivo SQL se **conserva intacto** (su SHA-256 normalizado está fijado en `test/migrations.test.ts`).
- `db:migrate` **no la aplica nunca**: ni en bases nuevas ni en las que no la tienen (como `horus_db`, que tiene 16 de las antiguas 18).
- **Bases donde ya estuviera aplicada:** su fila de `horus_migrations`, la tabla `sesiones`, sus datos y los valores `sesion`/`reprogramacion` del historial **se conservan** (nada se borra ni se revierte). `db:check` detecta el registro y verifica esa estructura histórica **entera** (columnas, índices, claves, `CHECK` con su expresión y ENUM ampliados); una estructura alterada se informa.
- **Restos sin registro** (por ejemplo, una aplicación parcial anterior: la tabla `sesiones` o los ENUM ampliados sin la fila en `horus_migrations`): `db:check` lo informa como problema («la tabla existe pero … no está registrada»; «academico_historial.entidad: tipo distinto») y **no corrige ni borra nada**; hay que revisarlo con el responsable antes de continuar.
- **Prisma:** el modelo `Sesion` y sus enums se retiraron (ningún código los usa); se conservan los valores `sesion` y `reprogramacion` de `AcademicoEntidad`/`AcademicoOperacion` para leer filas históricas.
- **Respaldo y restauración:** `db:backup`/`db:restore` son genéricos (vuelcan todas las tablas y `horus_migrations`): una copia de una base con la tabla histórica se restaura con ella y su registro, y `db:check` acepta la copia (probado).

### Activación en una base real (pendiente de autorización)

**No se ejecutó ninguna migración sobre `horus_db` ni otra base real.** Cuando el responsable lo autorice, para `horus_db` (MySQL 8.0.46, 16 migraciones aplicadas):

1. Detener el backend que use esa base; `npm run db:backup` y verificar la copia (`db:restore -- --verify-only` y restauración en `horus_restore_*`).
2. `npm run db:check`: debe informar solo lo pendiente (`preinscripciones`, `convocatorias.minimo_apertura`… y `convocatoria_horarios`), **nunca** la tabla `sesiones`.
3. Ensayar en un clon aislado de la copia: `db:migrate` + `db:check` (el procedimiento de clon de [la activación de preinscripciones](activacion-sesiones-preinscripciones-ensayo.md) sigue valiendo, sin la parte de sesiones).
4. En la base real: `npm run db:migrate` (aplicará `20261020-preinscripciones` y `20261023-convocatoria-horarios`, en ese orden) y `npm run db:check` («Esquema compatible»). Desplegar el código después.
5. Si `db:check` informara restos de sesiones sin registro, **detenerse** y decidir con el responsable (no borrar nada).

## 5. Pruebas

| Nivel | Comando | Qué cubre |
| --- | --- | --- |
| Unitarias (sin MySQL) | `npm test` (`test/horarios.test.ts`, `test/lima-time.test.ts`, `test/migrations.test.ts`, `test/permissions.test.ts`) | DTO estricto; reglas (intervalo, duplicados, solapamientos, consecutivos, orden, diferencia); servicio con Prisma simulado (bloqueo curso → edición, diferencia, revisión, historial, idempotencia, 404/409, validación antes de la transacción, sin cambios parciales ante fallos, 503); permisos reales de las rutas; migración nueva y retirada; hora de Lima |
| Integración MySQL desechable | `npm run build` y `node test/run-academic-isolated.cjs horarios` (alias `sesiones`, que es el nombre que usa la CI manual) | Base nueva (`db:init` + `db:migrate`), actualización desde el estado actual de `horus_db`, base histórica con la migración retirada aplicada (y alterada), restos sin registro, tabla ajena, respaldo y restauración, `CHECK`/`UNIQUE`/clave foránea/`RESTRICT`, HTTP real con AccessGuard, validación, permisos, ediciones cerradas/canceladas/archivadas, concurrencia, atomicidad, errores sin detalles internos y 503 sin tabla |
| Misma integración en 8.0.46 | `HORUS_IT_MYSQL_IMAGE=mysql:8.0.46 node test/run-academic-isolated.cjs horarios` | La misma batería en la versión mayor de `horus_db` (la imagen debe existir en local; el ejecutor no descarga nada) |

El ejecutor crea un contenedor propio (puerto aleatorio en `127.0.0.1`, etiqueta `horus.test=fase3`), verifica su `server_uuid` y lo retira con su volumen al terminar; la suite solo crea bases `horus_horarios_it_*` y `horus_restore_horarios_*`.

## Sesiones retiradas

Decisión de la empresa (octubre de 2026): **no se administran sesiones individuales**. Se retiraron del código activo el módulo `backend/src/sesiones/` (controladores, servicio, DTO, reglas, historial), las rutas `/api/admin/sesiones*` y `GET /api/admin/convocatorias/:id/sesiones`, el recurso de permisos `sesiones:*` (la matriz de la coordinación pasa de 65 a 62 permisos), sus entradas en `route-inventory.ts`, la sección y la herramienta `sesiones` de HORUS Assistant (incluida la consulta «esta semana») y sus pruebas. Las funciones de hora de Lima pasaron a `backend/src/common/lima-time.ts`. No se borró ninguna tabla ni dato. Documento histórico: [Horarios y sesiones académicas](horarios-sesiones-academicas.md).
