# Horarios y sesiones académicas

> **DOCUMENTO HISTÓRICO — MÓDULO RETIRADO (23 de octubre de 2026).** La empresa decidió no administrar sesiones individuales. El módulo `backend/src/sesiones/`,
> sus rutas (`/api/admin/sesiones*`, `GET /api/admin/convocatorias/:id/sesiones`), el recurso de permisos `sesiones:*` y la herramienta de HORUS Assistant
> **ya no existen**. La migración `20261020-sesiones-academicas` está **retirada**: su SQL se conserva intacto, pero `db:migrate` ya no la aplica; en una base
> que la tuviera aplicada, su tabla y sus datos se conservan y `db:check` verifica esa estructura histórica. Los días y horas recurrentes de cada edición se
> administran ahora en [Horarios de las ediciones](horarios-ediciones.md) (tabla `convocatoria_horarios`). El resto de este documento describe el diseño retirado.

> **Actualización (simplificación académica, octubre de 2026): las sesiones ya no dependen de docentes.** Este es el contrato vigente; donde el resto del
> documento hable de docentes, asignaciones, `docente_id` o «docente habilitado», describe el diseño anterior y **ya no se aplica**.
>
> - **Entrada:** `docente_id` ya no existe en el alta, la edición ni los filtros de `GET /api/admin/sesiones` y `GET /api/admin/convocatorias/:id/sesiones`: enviarlo responde 400 (el DTO rechaza campos ajenos).
> - **Persistencia:** toda sesión nueva guarda `asignacion_id = NULL`. Editar o reprogramar no modifica ese campo. La columna, su clave foránea y las filas anteriores se conservan (la migración `20261020-sesiones-academicas` no se tocó; no se borró ningún dato).
> - **Respuesta:** ya no incluye `docente` ni `docente_id`; conserva `asignacion_id` como dato histórico (no se interpreta ni se consulta el módulo de Docentes).
> - **Solapamientos:** solo **por edición** (`[inicio, fin)`, las canceladas no ocupan; 409 `CONFLICTO_HORARIO` con `tipo: ['edicion']`). Ya no hay regla ni bloqueo por docente; el orden de bloqueo es curso → edición.
> - **Sin validaciones de docente:** desaparecen los 409 por docente inactivo, no asignado o con asignación retirada, y el barrido de «sesiones futuras sin docente habilitado».
> - Quienes dictan el curso, si se quieren mostrar, se escriben en el título, las observaciones de la sesión o el temario del curso.
> - **Pruebas:** `backend/test/sesiones.test.ts` (unitarias, adaptadas y ejecutadas) y la integración `sesiones.integration.cjs` (MySQL desechable), reescrita para el nuevo contrato (alta con `asignacion_id` NULL, `docente_id` rechazado, solapamientos y concurrencia por edición, datos históricos). **Esa integración solo se comprobó de forma estática (sintaxis): no se ejecutó, porque no hubo autorización para usar Docker.** Debe correrse en la CI o con autorización antes de darla por válida.


Fase backend 3 de NestJS/Prisma/MySQL. **Solo API**: no hay pantallas React, notificaciones por correo ni WhatsApp todavía. Una sesión es una clase concreta de una edición (convocatoria): su día, su horario, su docente y su estado. Este módulo programa y reprograma; **no registra asistencia ni calificaciones** (ver «Dependencia del módulo de Asistencia»).

Estado de activación: **la migración `20261020-sesiones-academicas` NO está aplicada en ninguna base habitual** (`horus_db`, `horus_local`, Railway ni otra). Está implementada y probada solo en MySQL 8.4 desechable. Su activación real necesita una autorización posterior e independiente, con el procedimiento de «Migración y activación». Hasta entonces, el código con `SesionesModule` **no debe desplegarse** (la migración va antes del código) y las rutas responderían 503 en una base sin la tabla.

## Decisiones funcionales confirmadas

Autorizadas por el responsable del proyecto para esta versión (20 de octubre de 2026). Son reglas vigentes, no pendientes:

1. **Sin sesiones simultáneas dentro de una misma edición**: su grupo de estudiantes es uno solo; no hay grupos paralelos.
2. **Sin cruce de medianoche**: cada sesión empieza y termina el mismo día de Lima (`fin ≤ 23:59`).
3. **`fuera_de_periodo` sigue siendo un aviso**, no un bloqueo: la API acepta sesiones fuera de `fecha_inicio`–`fecha_fin` de la edición y lo indica en la respuesta.
4. **`cancelada` es un estado final**: no se edita ni se reabre; la clase se vuelve a programar con una sesión nueva.
5. **`sesiones:editar` cubre reprogramar y cambiar de estado** (realizada, cancelada, reabrir una realizada).
6. **No existe `sesiones:programar`**: no se añadió ese permiso.
7. **Gerencia y Coordinación gestionan las sesiones por completo** (`leer`, `crear`, `editar`).
8. **Secretaría y cuentas básicas no reciben permisos nuevos** sobre sesiones (403).
9. **Sin recurrencias ni feriados** por ahora: cada clase se crea individualmente y no hay calendario de feriados.
10. **Desactivar a un docente (o retirar su asignación) no cancela ni modifica automáticamente sus sesiones futuras**: se conservan y se detectan (ver «Sesiones futuras sin docente habilitado»).

## Arquitectura

| Pieza | Archivo |
| --- | --- |
| Rutas y permisos | `backend/src/sesiones/sesiones.controller.ts` |
| Entrada (DTO, validación estricta) | `sesiones.dto.ts` |
| Reglas puras (intervalo, modalidad, transiciones, errores) | `sesiones.rules.ts` |
| Fecha y hora de Lima (puras, sin depender de la zona del sistema) | `sesiones.time.ts` |
| Servicio (transacciones, bloqueos, conflictos, vista) | `sesiones.service.ts` |
| Historial académico | `sesiones.history.ts` |
| Modelo y tablas | `backend/prisma/schema.prisma` (`Sesion`), `backend/migrations/20261020-sesiones-academicas.sql` |

Sigue las convenciones de Docentes y Ediciones: controladores solo HTTP, DTO que rechazan cualquier campo desconocido (`forbidNonWhitelisted`), reglas en el servicio, una sola `PrismaService`, historial en `academico_historial` dentro de la misma transacción, `revision` para escrituras concurrentes y ningún DELETE. **No modifica** Docentes, Ediciones, Matrículas, Estudiantes ni Reportes.

## Modelo de datos

Una sola tabla: `sesiones`. Se evaluó separar «horarios recurrentes» y «sesiones concretas» y se descartó: el caso real (programar cada clase de una edición, moverla o cancelarla) lo resuelve una entidad de sesión concreta, y una plantilla recurrente añade reglas de excepciones y feriados que hoy nadie ha definido. Si más adelante se quiere generar clases por patrón («todos los martes»), bastará un asistente que cree varias sesiones con este mismo endpoint.

| Columna | Tipo | Regla |
| --- | --- | --- |
| `id` | INT autoincremental | clave primaria |
| `convocatoria_id` | INT NOT NULL | edición; clave foránea `RESTRICT` |
| `asignacion_id` | INT NULL | docente de la sesión **como asignación** (`docente_asignaciones.id`); NULL = docente por definir. Clave foránea **compuesta** `(asignacion_id, convocatoria_id)` → `docente_asignaciones (id, convocatoria_id)` |
| `titulo` | VARCHAR(160) NOT NULL | título o tema; CHECK: no vacío tras `TRIM` |
| `fecha` | DATE NOT NULL | día de calendario en **hora de Lima**; CHECK: 2000-01-01 a 2100-12-31 |
| `hora_inicio`, `hora_fin` | TIME NOT NULL | hora de pared de Lima (HH:MM); CHECK: `00:00 ≤ inicio < fin ≤ 23:59`, sin segundos |
| `modalidad` | ENUM('presencial','virtual','hibrida') NOT NULL | las mismas del curso (`CursoModalidad`); si se omite al crear se hereda del curso |
| `lugar` | VARCHAR(200) NULL | lugar físico; CHECK: presencial sin enlace, virtual sin lugar, híbrida admite ambos |
| `enlace_url` | VARCHAR(2048) NULL | enlace de reunión, **solo `https://`** y sin espacios (CHECK y DTO). Nunca se genera uno |
| `estado` | ENUM('programada','realizada','cancelada') NOT NULL, `programada` | ver «Estados» |
| `cancelada_at`, `cancelacion_motivo` | DATETIME(3), VARCHAR(300) | CHECK: presentes si y solo si `estado = cancelada` (motivo no vacío) |
| `observaciones` | VARCHAR(500) NULL | notas de la sesión; CHECK: no en blanco |
| `revision` | INT NOT NULL, 1 | control de concurrencia optimista (CHECK ≥ 1) |
| `createdAt`, `updatedAt` | DATETIME(3) | |

Índices: `sesiones_id_edicion_uq (id, convocatoria_id)` (único, **preparado para Asistencia**: una asistencia podrá apuntar a `(sesion_id, convocatoria_id)` y a la matrícula de la misma edición), `sesiones_edicion_idx (convocatoria_id, fecha, hora_inicio)`, `sesiones_asignacion_idx (asignacion_id, convocatoria_id, fecha)` y `sesiones_fecha_idx (fecha, hora_inicio)`.

Se omiten a propósito: datos personales del docente (la sesión solo apunta a su asignación), vínculos con estudiantes o matrículas, enlaces generados, reuniones virtuales automáticas, aforo, recurrencia, color o cualquier campo sin un caso de uso hoy.

### Relaciones

`Convocatoria 1 — N Sesion` y `DocenteAsignacion 1 — N Sesion (opcional)`; todas `RESTRICT`: **no se puede borrar una edición, una asignación ni un docente que tenga sesiones**, y la clave compuesta impide, por SQL directo también, asignar a una sesión un docente de otra edición. Las asignaciones retiradas se conservan (ya era así) y por eso las sesiones antiguas siguen apuntando a una fila válida. Matrículas, estudiantes y reportes no se tocan.

### Historial

Reutiliza `academico_historial` (solo inserción, misma transacción). La migración **añade al final** `sesion` al ENUM `entidad` y `reprogramacion` al ENUM `operacion`. Cada alta, edición, reprogramación y cambio de estado registra actor (id y rol de ese momento), revisión, estados, motivo y los **nombres** de los campos tocados, nunca sus valores. Única excepción justificada: en una **reprogramación**, `estado_anterior` y `estado_nuevo` llevan la programación en hora de Lima (`2026-11-05 14:00-16:00`, cabe en VARCHAR(30)): es información de calendario, no un dato personal, y permite saber de qué día y hora se movió la clase. Si falla la inserción del historial, el cambio no se aplica (probado con un disparador que lo fuerza).

## API

Prefijo `/api`, JWT y `AccessGuard` global (denegación por defecto). Toda ruta exige exactamente un permiso y consta en `route-inventory.ts`. Sin JWT → 401. **Ningún dato de sesiones es público.** No existe DELETE.

Las listas responden `{ ok, items, pagination: { page, limit, total, pages } }`; los detalles y las escrituras, `{ ok, item }`.

| Método y ruta | Permiso | Cuerpo / consulta |
| --- | --- | --- |
| GET `/api/admin/sesiones` | `sesiones:leer` | `page`, `limit` (≤ 100), `convocatoria_id`, `docente_id`, `estado` (`programada` \| `realizada` \| `cancelada`; omitido = todos), `desde`, `hasta` (días de Lima, **ambos incluidos**), `orden` = `asc` (predeterminado) \| `desc` |
| GET `/api/admin/sesiones/:id` | `sesiones:leer` | 404 si no existe |
| GET `/api/admin/convocatorias/:id/sesiones` | `sesiones:leer` | igual que la lista sin `convocatoria_id`; **404 si la edición no existe** (en vez de una lista vacía). Va bajo `convocatorias` porque así se llama el recurso de ediciones en la API |
| POST `/api/admin/sesiones` | `sesiones:crear` | `convocatoria_id`\*, `titulo`\*, `fecha`\*, `hora_inicio`\*, `hora_fin`\*, `docente_id`, `modalidad`, `lugar`, `enlace_url`, `observaciones`. Cadena vacía = sin dato. 201 |
| PATCH `/api/admin/sesiones/:id` | `sesiones:editar` | `revision`\* y al menos un campo de: `titulo`, `fecha`, `hora_inicio`, `hora_fin`, `docente_id` (`null` quita al docente), `modalidad`, `lugar`, `enlace_url`, `observaciones` (`''` limpia los tres últimos) y `motivo` |
| PUT `/api/admin/sesiones/:id/estado` | `sesiones:editar` | `revision`\*, `estado`\* (`realizada` \| `cancelada` \| `programada`), `motivo` |

\* obligatorio. El orden de toda lista es estable: fecha, hora de inicio e `id` (con `orden=desc`, los tres descendentes), de modo que no se repiten ni se omiten sesiones entre páginas. `docente_id` y `convocatoria_id` desconocidos dan una lista vacía; `desde > hasta` es 400.

**Contrato de la respuesta** (pensado para un calendario): `id`, `convocatoria_id`, `asignacion_id`, `titulo`, `fecha` (`AAAA-MM-DD`), `hora_inicio` y `hora_fin` (`HH:MM`), `zona_horaria` (`America/Lima`), **`inicio_utc` y `fin_utc`** (instantes ISO ya calculados, para que ningún cliente tenga que adivinar la zona), `modalidad`, `lugar`, `enlace_url`, `estado`, `cancelada_at`, `cancelacion_motivo`, `observaciones`, `revision`, `createdAt`, `updatedAt`, `docente_id`, `convocatoria` (`id`, `nombre`, `estado`, `archivado_at`, fechas y el curso `id`, `titulo`, `tipo`) y `docente` (`null` si no hay) con solo `id`, `nombres`, `apellidos`, `especialidad`, `activo`, `asignacion_id`, `rol`, `asignacion_estado` y **`vigente`** (docente activo con asignación activa). `fuera_de_periodo` avisa (sin rechazar) si la fecha cae fuera de `fecha_inicio`–`fecha_fin` de la edición. **Nunca se devuelven documento, correo, teléfono ni profesión del docente**: esos datos se consultan en `GET /api/admin/docentes/:id` (`docentes:leer`).

## Zona horaria (America/Lima)

- **Qué se guarda.** `fecha`, `hora_inicio` y `hora_fin` son la **hora de pared de Lima** tal como se anuncia la clase («5 de noviembre, de 14:00 a 16:00»), en columnas `DATE` y `TIME`. No son instantes UTC y no se guardan en `TIMESTAMP`/`DATETIME`: no hay conversión de ida y vuelta que pueda correr el día, y no importan la zona del sistema operativo, la de MySQL ni la de Node. Lima es UTC-5 todo el año y no usa horario de verano.
- **Qué se devuelve.** Además de los tres campos locales, `inicio_utc` y `fin_utc`, calculados con `Intl` y la zona `America/Lima` (`sesiones.time.ts`), nunca con un desfase escrito a mano ni con `Date` local.
- **«Ya empezó».** Marcar una sesión como realizada compara la hora de inicio, en Lima, con el reloj del servidor (inyectable solo en pruebas).
- **Límites del día.** Un intervalo es `[inicio, fin)` dentro de **un mismo día**: `fin > inicio` y `fin ≤ 23:59`. Una sesión **no cruza la medianoche**: una clase de 22:00 a 00:30 se registra como dos sesiones (22:00–23:59 y 00:00–00:30 del día siguiente). 23:59 es el último minuto expresable. Es una decisión confirmada (ver «Decisiones funcionales confirmadas»).
- **Pruebas.** Las unitarias fijan los mismos resultados con `TZ` = UTC, Tokio, Auckland, Los Ángeles, Lima y Madrid; la integración levanta la API con `TZ=Pacific/Auckland` y MySQL con `time_zone = +13:00` y comprueba que la base conserva `14:00:00` y que `inicio_utc` es `19:00Z`.

## Estados

| De → a | Permitido | Motivo | Notas |
| --- | --- | --- | --- |
| programada → realizada | sí | opcional | solo si la hora de inicio (Lima) ya llegó |
| programada → cancelada | sí | **obligatorio** | guarda `cancelada_at` y `cancelacion_motivo`; libera el horario |
| realizada → programada | sí («reabrir») | **obligatorio** | para corregir una marca equivocada |
| realizada → cancelada | **no** (409) | — | una clase dictada no se cancela; se reabre primero |
| cancelada → cualquiera | **no** (409) | — | estado final; la clase se vuelve a programar con una sesión nueva |

- **Reprogramar** es editar `fecha`, `hora_inicio`, `hora_fin` o `docente_id` de una sesión **programada** (PATCH). Exige `motivo`, vuelve a validar al docente y los solapamientos, y deja una entrada `reprogramacion` con la programación anterior y la nueva (si solo cambia el docente, la operación es `edicion`).
- **Una sesión realizada es historia:** no cambia de día, horas, docente ni modalidad (409); solo se corrigen `titulo` y `observaciones`, y con `motivo`. Para moverla hay que reabrirla (queda auditado). No hay modificaciones silenciosas.
- **Una cancelada no se edita.** Nada se borra: la fila, su motivo y su historial se conservan.
- Una edición **archivada o cancelada** no admite programar, editar ni marcar como realizada; **cancelar siempre se permite** (para limpiar su calendario). Una edición **cerrada** (a nuevas matrículas) sí admite sesiones: sigue dictándose y sirve para registrar las clases de una edición ya terminada.
- Enviar valores iguales a los actuales no cambia nada (ni revisión ni historial).
- Si una sesión ya está en ese estado → 409.

## Reglas de negocio y validación

**Entrada** (400 si no se cumple; ningún campo desconocido se ignora ni se convierte): `titulo` 1–160 caracteres tras recortar y reducir espacios; `fecha` un día real `AAAA-MM-DD` entre 2000 y 2100; horas `HH:MM` de 24 h (`24:00`, `9:00`, `14:00:00` se rechazan); `lugar` ≤ 200; `observaciones` ≤ 500; `motivo` 1–300; `enlace_url` solo `https://`, sin espacios, ≤ 2048; identificadores enteros positivos (un texto como `"4"` se rechaza); `revision` entero. No se inventan longitudes mínimas.

**Relaciones y reglas** (404 / 409 / 422):

| Caso | Código |
| --- | --- |
| edición, docente o sesión inexistentes | 404 |
| hora final igual o anterior a la inicial; presencial con enlace; virtual con lugar; falta de modalidad (el curso no tiene una y no se indicó); falta de motivo | 422 |
| edición archivada o cancelada | 409 |
| docente **inactivo** | 409 |
| docente **no asignado** a la edición | 409 |
| asignación **retirada** | 409 |
| solapamiento | 409 con `codigo: 'CONFLICTO_HORARIO'` y `conflictos` |
| revisión obsoleta, transición no permitida, sesión cancelada o realizada que no admite el cambio | 409 |

El docente se indica con `docente_id`; el servicio resuelve su asignación **activa** en esa edición (y la clave compuesta de MySQL garantiza que es de esa edición). Desactivar a un docente o retirar su asignación **no toca sus sesiones**: se conservan, `docente.vigente` pasa a `false`, se puede corregir su texto o cancelarlas, y para **reprogramar** hay que asignar otro docente (409 si no). Tampoco se programan sesiones nuevas con él. El módulo de Docentes no se modificó: no avisa ni bloquea al retirar a alguien con sesiones futuras (ver «Sesiones futuras sin docente habilitado»).

## Sesiones futuras sin docente habilitado

Una sesión **programada** y futura queda «sin docente habilitado» cuando su docente se desactivó o su asignación se retiró después de programarla. **No hace falta ninguna tabla ni cambio de código**: la respuesta de cada sesión ya trae `docente.vigente` (`true` solo si el docente está activo **y** su asignación sigue `activa`), además de `docente.activo` y `docente.asignacion_estado`, que dicen el motivo. Una sesión sin docente definido (`docente: null`) es otro caso, válido («por definir»).

Mecanismo para el futuro panel React (solo lecturas, nada se modifica solo):

1. **Al desactivar o retirar a un docente concreto:** `GET /api/admin/sesiones?docente_id=<id>&estado=programada&desde=<hoy en Lima>&limit=100` (el filtro `docente_id` se aplica en el servidor, antes de paginar y sin importar el estado de la asignación). Todas las filas devueltas están afectadas. El panel puede mostrar ese listado antes o después de la acción, sin actuar por su cuenta.
2. **Revisión general (por ejemplo, en el calendario de una edición):** `GET /api/admin/convocatorias/:id/sesiones?estado=programada&desde=<hoy en Lima>` y señalar las filas con `docente !== null && docente.vigente === false` (con un icono y texto, no solo color). `<hoy en Lima>` se calcula en el cliente con la zona `America/Lima` (la misma que devuelve `zona_horaria`).
3. **Resolverlo es una decisión humana:** asignar otro docente con `PATCH /api/admin/sesiones/:id` (`docente_id`, `revision` y `motivo`; el servidor vuelve a exigir docente activo, asignación activa y sin solapamientos), quitarlo (`docente_id: null`) o cancelar la sesión con motivo. El servidor **no** reasigna ni cancela nada automáticamente.

Límite conocido: no existe hoy un filtro del servidor «solo sesiones con docente no vigente» para toda la base; el barrido general (punto 2) pagina por edición o por docente, lo que es suficiente mientras el volumen sea el de una institución pequeña. Si se vuelve incómodo, la mejora mínima y segura sería un filtro de solo lectura `docente_vigente=false` en las dos listas (una condición sobre `asignacion.estado` y `docente.activo`, sin tablas nuevas ni escrituras). **No se implementó** para no ampliar el alcance de esta entrega; queda como mejora opcional a decidir cuando exista el panel. Tampoco hay avisos por correo ni notificaciones al desactivar (fuera de alcance).

## Prevención de solapamientos

**Política** (intervalos `[inicio, fin)`, mismo día de Lima; compiten las sesiones `programada` y `realizada`, las `cancelada` no ocupan horario):

1. **Un docente no puede tener dos sesiones simultáneas**, ni siquiera en ediciones distintas.
2. **Una edición no puede tener dos sesiones simultáneas**, con o sin docente: su grupo de estudiantes es uno solo y el modelo no tiene grupos paralelos. Si el negocio necesita talleres en paralelo, habrá que introducir grupos; mientras tanto no se inventa una excepción.
3. Una sesión que termina justo cuando empieza otra **no** se solapa (por eso `[inicio, fin)`).

**Mecanismo.** MySQL no tiene restricciones de exclusión por intervalos, así que no hay un UNIQUE que lo exprese. Una comprobación previa al INSERT sin protección tendría una carrera, así que **toda escritura es una transacción `READ COMMITTED` con bloqueos de fila en el orden curso → edición → docente**, el mismo de Ediciones, Matrículas y Docentes:

- el bloqueo de la **edición** serializa todas las escrituras de sus sesiones y también el equipo docente, el cierre, la cancelación y el archivo de esa edición;
- el bloqueo del **docente** serializa las sesiones de un mismo docente aunque sean de ediciones distintas, y también su activación o desactivación (por eso el chequeo «docente activo» no tiene carrera);
- con ambos tomados, se consulta si hay sesiones que se solapan y recién entonces se escribe. La segunda solicitud espera y ve a la primera.

La prueba de integración lanza **ocho solicitudes simultáneas** para el mismo docente y horario desde cuatro ediciones (resultado: un 201 y siete 409), ventanas encadenadas que se solapan entre sí (lo aceptado nunca se solapa), cinco simultáneas en una misma edición sin docente, dos reprogramaciones al mismo hueco, cambios con la misma revisión y programar contra desactivar al docente, retirar su asignación o cancelar la edición (nunca un 500). Además se verificó con una **mutación**: quitando los `FOR UPDATE` del código compilado, la prueba falla (`201,201,409…`), es decir, detecta la reserva doble.

**Límite honesto.** El solapamiento **no** está garantizado contra SQL directo en la base: quien inserte filas en `sesiones` sin pasar por la API puede crear sesiones solapadas (una prueba lo deja a la vista para no afirmar una garantía que MySQL no da). Sí se garantizan por SQL directo el intervalo válido, la modalidad, el enlace `https`, la cancelación completa, la edición y el docente existentes y la pertenencia del docente a la edición. Los triggers quedan descartados: el ejecutor de migraciones parte por `;`, no resolvería la carrera sin bloqueos y es más frágil que el bloqueo transaccional. Una alternativa declarativa (una tabla de franjas de 15 minutos con UNIQUE) se evaluó y se descartó por restringir los horarios y multiplicar filas sin que hoy haya una necesidad.

**Otras reglas de concurrencia.** `revision` en cada cambio (409 si es obsoleta, un ganador entre escrituras simultáneas); cada transacción usa una sola conexión (el pool es de 2); un interbloqueo, un tiempo de espera de bloqueo o una referencia desaparecida responden 409 con un mensaje neutro y repetir es seguro; un pool agotado responde 503.

## Permisos

El recurso `sesiones` ya existía en la matriz con `leer`, `crear` y `editar` (y la coordinadora ya los tenía): **la matriz no cambia**. No se creó un permiso `sesiones:programar` (decisión confirmada): reprogramar y cambiar de estado son `sesiones:editar`, y no hay hoy una persona que deba cancelar pero no reprogramar. Si el negocio lo pide más adelante, bastará añadirlo a `RESOURCE_OPERATIONS` y a la lista de la coordinadora.

| Rol | Permisos de sesiones | Estado |
| --- | --- | --- |
| `GERENTE_GENERAL` | los tres | regla vigente (tiene todos) |
| `COORDINADORA_INSTITUCIONAL` | los tres | ya los tenía; coherente con sus permisos sobre Ediciones y Docentes |
| `SECRETARIA` | ninguno | **no se le otorga nada** (decisión confirmada); si se decide lo contrario, añadir `sesiones:leer` a su lista y a las pruebas |
| Cuenta básica (sin rol) | ninguno | 403 «sin rol» |

`sesiones` salió de `FUTURE_RESOURCES` (ya tiene rutas). `permissions.test.ts` fija el catálogo exacto, cada ruta con su permiso según los decoradores reales y el inventario, y que no exista `sesiones:eliminar`.

## Errores

| Código | Cuándo |
| --- | --- |
| 400 | cuerpo o consulta inválidos, campos no declarados, identificador no numérico, edición sin ningún campo, `desde` posterior a `hasta` |
| 401 | sin sesión o JWT inválido, vencido o revocado |
| 403 | sin permiso o cuenta sin rol |
| 404 | edición, docente o sesión inexistentes |
| 409 | conflictos de estado o de horario (ver tabla de reglas) |
| 422 | reglas de la sesión incumplidas: intervalo, modalidad, motivo |
| 503 | la base no tiene la estructura esperada (faltan migraciones) o el pool está agotado: mensaje neutro, revisar `npm run db:check` |

Ninguna respuesta incluye SQL, nombres de restricciones o índices, trazas ni datos personales (las pruebas recorren todos los cuerpos de error). Un fallo interno responde 500 genérico.

## Migración y activación

`20261020-sesiones-academicas` (última de `versions` en `backend/scripts/migrate.cjs`) es **aditiva e idempotente**: un `CREATE TABLE IF NOT EXISTS` (tabla nueva, vacía, claves `RESTRICT`) y dos `ALTER TABLE academico_historial MODIFY … ENUM(...)` que solo **añaden un valor al final** (ampliar un ENUM por el final no reescribe la tabla). No modifica filas ni columnas existentes y no inserta datos. Requiere `20261020-docentes` antes (referencia `docente_asignaciones`) y, con ella, las migraciones académicas anteriores; `db:check` la espera y verifica columnas, tipos, índices, claves foráneas (incluida la compuesta), los ocho CHECK y los dos ENUM del historial.

Como MySQL no hace DDL transaccional, una ejecución interrumpida deja un prefijo de las tres sentencias; **repetir `npm run db:migrate` la completa** (probado con cada prefijo, con datos previos intactos). Si una tabla homónima preexistente tiene otra forma, `CREATE TABLE IF NOT EXISTS` no la corrige: `db:check` la rechaza.

**Orden de activación en un destino habitual — pendiente, requiere autorización explícita:**

1. Confirmar el destino (`DB_HOST`, `DB_NAME`) sin mostrar credenciales y que nadie más esté migrando.
2. `npm run db:backup` y `--verify-only` sobre el archivo; ensayo previo en un clon aislado (`horus_restore_*`).
3. `npm run db:check`: debe señalar únicamente la tabla `sesiones` y los dos ENUM del historial como pendientes.
4. `npm run db:migrate` (solo aplica lo pendiente).
5. `npm run db:check`: debe terminar en «Esquema compatible».
6. Desplegar el backend con `SesionesModule` (la migración va **antes** del código: el cliente Prisma consulta la tabla).
7. Verificar con una cuenta de gerente: `GET /api/health`, `GET /api/admin/sesiones` (200, lista vacía) y que una cuenta de secretaría reciba 403.

Recuperación: antes de desplegar el código y sin sesiones registradas, la tabla y los dos ENUM se pueden revertir a mano con autorización (retirar `sesiones`; cada `MODIFY` del ENUM falla por diseño si el historial ya usa los valores nuevos). Con datos, se restaura el respaldo en una base aislada y se decide con el responsable. Nada de esto es automático.

## Pruebas

- `backend/test/sesiones.test.ts` (sin base de datos): hora de Lima con varias `TZ`, fechas y horas, intervalo `[inicio, fin)`, máquina de estados completa 3×3, DTO (rechazo de campos ajenos y de valores inválidos), orden de bloqueo y aislamiento del servicio con transacción simulada, reloj inyectado, conflictos, edición archivada, docente, traducción de errores sin SQL y contrato de la vista.
- `backend/test/permissions.test.ts`, `migrations.test.ts`: catálogo, matriz, rutas frente a los decoradores reales y el inventario, y la migración (estático).
- `backend/test/sesiones.integration.cjs`: MySQL 8.4 desechable y HTTP real con la AppModule compilada (`npm run build` antes): migración desde una base previa con datos (filas y definiciones idénticas, salvo los dos ENUM ampliados), recuperación con cada prefijo, estructura real, restricciones por SQL directo, permisos por rol, alta con base y API en zonas horarias distintas de Lima, validación, solapamientos, concurrencia, reprogramación, estados, listados, conservación ante docentes desactivados o retirados, compatibilidad con Ediciones, Matrículas y Reportes, transaccionalidad y errores sin detalles internos (incluido el 503 sin la tabla).
- `backend/test/access-guard-http.integration.cjs`: el barrido por rol incluye las seis rutas nuevas.

Comandos (desde `backend/`, con la imagen `mysql:8.4` local; el ejecutor crea y retira su propio contenedor y no lee `.env`):

```powershell
node --test --test-concurrency=1 -r ./test/isolate-env.cjs -r ts-node/register test/sesiones.test.ts test/permissions.test.ts test/migrations.test.ts
npm run build
node test/run-academic-isolated.cjs sesiones
node test/run-academic-isolated.cjs access
node test/run-academic-isolated.cjs docentes
node test/run-ediciones-disposable.cjs academico-schema.integration.cjs convocatorias.integration.cjs
```

El job «Integración (MySQL efímero)» de `.github/workflows/ci.yml` ejecuta `node test/run-academic-isolated.cjs sesiones` tras Docentes. Usa un contenedor propio y desechable, nunca `horus_db` ni `horus_local`.

### Resultado de las pruebas de cierre (2026-10-20, Windows, MySQL 8.4 desechable en Docker)

- `tsc --noEmit` y `npm run build`: sin errores. `npm test`: 493 aprobadas, 0 fallos (471 anteriores + 19 de sesiones + 2 de permisos + 1 de migraciones).
- `sesiones.integration.cjs`: 17 de 17. Comprobación de la prueba de concurrencia por **mutación**: sin los `FOR UPDATE` falla (`201,201,409…`).
- Regresiones, cada una en su MySQL 8.4 desechable (contenedor retirado al terminar): AccessGuard HTTP 28/28, Docentes 16/16, estructura académica 20/20 y Ediciones 10/10, Estudiantes 8/8, Matrículas 16/16, Reportes 10/10, Importaciones CSV 15/15. La primera ejecución de la estructura académica falló una expectativa (`db:restore` cuenta ahora **tres** claves compuestas, la nueva incluida) y se actualizó en `academico-schema.integration.cjs`; también se ajustaron los totales del barrido de AccessGuard (+6 rutas) y las tablas «posteriores» que ignora la prueba de Docentes. Ninguna aserción se debilitó.
- Frontend (contratos de permisos, sin cambios): `test:panel-access` 23/23 y `test:session-access` 15/15.
- Revisión de cierre: todas estas pruebas se repitieron sin cambios de código con los mismos resultados (493/493, sesiones 17/17, AccessGuard 28/28, Docentes 16/16, estructura académica 20/20, Ediciones 10/10, Estudiantes 8/8, Matrículas 16/16, Reportes 10/10, Importaciones 15/15); la revisión solo modificó esta documentación.
- No se ejecutó nada contra `horus_db` ni `horus_local`. La compatibilidad con el esquema de `horus_db` se comprobó en la base desechable partiendo de todas las migraciones previas (incluida `20261020-docentes`, ya activa en `horus_db`) con datos, no leyendo `horus_db`.

## Integración posterior con React (no implementada)

- Sección `?section=sesiones` (o un bloque dentro de **Ediciones**) declarada en `PANEL_SECTIONS` con `sesiones:leer` y sus escrituras en `RESOURCE_WRITE`/`PANEL_ACTIONS` con los mismos permisos que el inventario; `test:panel-access` lo contrasta. Solo el backend decide el acceso.
- **Calendario de una edición:** `GET /api/admin/convocatorias/:id/sesiones?desde=…&hasta=…&limit=100`. **Calendario de un docente:** `GET /api/admin/sesiones?docente_id=…&desde=…&hasta=…`. Pintar con `fecha`, `hora_inicio` y `hora_fin` (hora de Lima) o con `inicio_utc`/`fin_utc` si la librería de calendario trabaja con instantes. Sin dependencias de calendario nuevas sin autorización.
- **Crear:** el formulario ofrece el equipo de la edición (`GET /api/admin/asignaciones-docentes?convocatoria_id=…`) y envía `docente_id`. Ante `409 CONFLICTO_HORARIO` mostrar `conflictos` (sesión, día y horas) sin reintentar solo. Una sesión sin docente es válida («por definir»).
- **Reprogramar:** enviar solo lo que cambia, con `revision` y `motivo`; mostrar el conflicto o el motivo faltante (422). **Cancelar:** `PUT …/estado` con motivo; mostrar las canceladas con otro estilo, no solo con color. **Reabrir** una realizada con motivo.
- Avisos con los campos de la vista: `docente.vigente === false` (docente inactivo o asignación retirada: hay que reasignar antes de reprogramar), `fuera_de_periodo`.
- Revisión en cada guardado con el flujo de 409 y fusión que ya usa el panel; bloqueo síncrono contra doble envío; resultado incierto (red, timeout, 5xx) sin reintento automático: consultar la sesión antes de repetir. No guardar datos de sesiones en `localStorage`/`sessionStorage`; mensajes en español sin texto técnico del servidor.
- Detalle de sesión: es la vista de `GET /api/admin/sesiones/:id`; desde allí se enlazará, más adelante, la asistencia.

## Dependencia del módulo de Asistencia

Este módulo **no** crea tablas ni endpoints de asistencia, no la valida y no calcula nada con ella. Lo que deja preparado:

- `sesiones_id_edicion_uq (id, convocatoria_id)`: una asistencia podrá referenciar `(sesion_id, convocatoria_id)` y exigir, con la misma clave compuesta, que la matrícula sea de esa edición.
- Estados: `realizada` es el punto natural para abrir la toma de asistencia; `cancelada` no admite asistencia. Convendría que Asistencia **rechace** registrar sobre una sesión cancelada y que **bloquee reabrir** (`realizada → programada`) una sesión que ya tenga asistencia, o lo permita con un motivo explícito; hoy no puede comprobarlo porque no existe.
- Los permisos `asistencia:leer` y `asistencia:registrar` ya existen en la matriz y aún no se exigen en ninguna ruta.

## Decisiones de negocio pendientes

Las diez reglas de «Decisiones funcionales confirmadas» **ya no son pendientes**. Sigue abierto, para revisarlo cuando se construya el panel o crezca el uso:

1. **Grupos o talleres en paralelo** dentro de una edición: hoy están prohibidos (regla confirmada); si el negocio los necesita, habría que modelar grupos.
2. **Clases que cruzan la medianoche** (p. ej. 22:00–00:30): se registran como dos sesiones (regla confirmada); un fin «al día siguiente» exigiría revisar el modelo.
3. **Sesiones fuera del periodo** de la edición: solo se avisa (`fuera_de_periodo`); convertirlo en rechazo o confirmación sería un cambio posterior.
4. **Avisos al desactivar o retirar a un docente con sesiones futuras:** el módulo de Docentes no se modificó y no avisa; el panel puede listar las sesiones afectadas con el mecanismo de «Sesiones futuras sin docente habilitado». ¿Se desea un filtro `docente_vigente=false`, una advertencia en la propia acción de Docentes o una reasignación en bloque? Cualquiera de las tres es trabajo nuevo.
5. **Reactivar una sesión cancelada con motivo:** hoy es estado final (confirmado); no se prevé cambiarlo.
6. **Lugar y enlace** son opcionales aunque la modalidad los sugiera (pueden definirse después). ¿Deben ser obligatorios antes de la fecha?
7. **Alta masiva** («todos los martes de 14:00 a 16:00») y **calendario de feriados**: fuera de esta versión por decisión confirmada; un asistente podría crear varias sesiones con el mismo endpoint sin cambiar el modelo.
8. **Marcar como realizada antes de la hora** no se permite; no hay una ventana de gracia ni una marca automática por el paso del tiempo (no hay tareas programadas).
9. **Avisos al docente o a los estudiantes** (correo, WhatsApp) al programar, mover o cancelar: fuera de alcance y no implementado.
10. **Permisos de Secretaría** sobre sesiones (hoy ninguno, decisión confirmada) y un eventual `sesiones:programar`: solo si el negocio lo pide más adelante.
