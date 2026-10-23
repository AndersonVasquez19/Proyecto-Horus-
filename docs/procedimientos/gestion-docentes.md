# Gestión de docentes y ponentes

> **Documento histórico: módulo retirado (simplificación académica, octubre de 2026).** Los cursos los dictan integrantes de la propia empresa, por lo que ya no hay
> administración de docentes: se retiraron `/api/admin/docentes`, `/api/admin/asignaciones-docentes` y los permisos `docentes:*`. Se conservan las tablas
> `docentes` y `docente_asignaciones`, la migración `20261020-docentes`, sus datos y su respaldo. Las sesiones ya no dependen de docentes
> (`asignacion_id` se guarda siempre en NULL). Lo que sigue describe el diseño anterior y no el comportamiento actual.


Fase backend 2 de NestJS/Prisma/MySQL. **Solo API**: no hay pantallas React todavía. Un docente es una entidad académica propia; **no es una cuenta de acceso**: no tiene contraseña, rol ni relación con `admin_users`, y registrarlo nunca crea ni habilita un usuario. Las cuentas se siguen gestionando únicamente en «Roles y usuarios».

Estado de activación: **la migración `20261020-docentes` ya fue aplicada a `horus_db` (20 de octubre de 2026)**, tras un respaldo verificado y un ensayo en un clon aislado; el registro completo está en [Activación real en horus_db](activacion-docentes-mysql-real.md). **Cualquier otra base o entorno** (`horus_local`, Railway, instalaciones nuevas, copias restauradas) **debe verificar su propio historial de migraciones** (`npm run db:check`) y seguir el orden de «Migración y activación»: no se debe asumir que está migrada. El código con `DocentesModule` está probado en MySQL 8.4 desechable y, según el responsable, un backend NestJS conectado a `horus_db` respondió a `GET /api/admin/docentes` con su sesión real de Gerencia; **no se ha registrado ningún despliegue en Railway ni en otro entorno**.

Verificación real: el 20 de octubre de 2026 el responsable comprobó personalmente, desde Microsoft Edge y con su sesión real de Gerente General, una petición `GET /api/admin/docentes` de solo lectura contra el backend NestJS conectado a `horus_db`: HTTP 200, 0 docentes, mensaje «Acceso autorizado correctamente» (detalle en la sección 7.1 de [Activación real en horus_db](activacion-docentes-mysql-real.md)).

Limitaciones de la validación real: los permisos de **Coordinación** (200) y **Secretaría** (403), y el 403 de la cuenta básica, se comprobaron solo con **cuentas ficticias en el entorno aislado**, no con sesiones reales. Contra `horus_db` no se ha probado ninguna escritura (crear, editar, asignar). Los respaldos de la activación no están cifrados.

## Modelo de datos

Migración `20261020-docentes` (última de `versions` en `backend/scripts/migrate.cjs`). Modelos Prisma `Docente` y `DocenteAsignacion` en `backend/prisma/schema.prisma`.

### `docentes`

| Columna | Tipo | Regla |
| --- | --- | --- |
| `id` | INT autoincremental | clave primaria |
| `nombres`, `apellidos` | VARCHAR(120) | obligatorios; CHECK: no vacíos tras `TRIM` |
| `doc_pais`, `doc_tipo`, `doc_numero` | CHAR(2), ENUM('DNI'), VARCHAR(20) | **opcionales y todo-o-nada**; solo DNI peruano (`PE` + 8 dígitos ASCII), igual que Estudiantes; `UNIQUE` (varios NULL admitidos) |
| `especialidad`, `profesion` | VARCHAR(120) NULL | área de conocimiento y profesión o experiencia; CHECK: si existen, no están en blanco |
| `email` | VARCHAR(254) NULL | `UNIQUE` (varios NULL admitidos); minúsculas; sin distinguir mayúsculas ni tildes (colación `utf8mb4_unicode_ci`) |
| `telefono` | VARCHAR(30) NULL | sin índice: se puede compartir |
| `activo` | TINYINT(1) NOT NULL, 1 | CHECK 0/1. Un docente se **desactiva**, nunca se elimina |
| `revision` | INT NOT NULL, 1 | control de concurrencia optimista (CHECK ≥ 1) |
| `createdAt`, `updatedAt` | DATETIME(3) | |

Se omiten a propósito: fotografía, documentos escaneados, dirección, fecha de nacimiento, CV y cualquier dato bancario. Documento, correo y teléfono son opcionales para no obligar a recopilar datos personales de más; solo se guardan si se tienen y se necesitan.

Índices: `docentes_documento_uq`, `docentes_email_uq` y `docentes_nombre_idx (apellidos, nombres)` (orden estable del listado).

### `docente_asignaciones` (docente ↔ edición)

| Columna | Tipo | Regla |
| --- | --- | --- |
| `docente_id`, `convocatoria_id` | INT | claves foráneas `RESTRICT`; `UNIQUE (docente_id, convocatoria_id)`: **una sola fila por docente y edición**, incluidas las retiradas (se reactiva, no se duplica) |
| `rol` | ENUM('principal','participante') | `principal` = responsable de la edición (como máximo **uno activo**); `participante` = ponente o docente adicional (sin límite) |
| `estado` | ENUM('activa','retirada') | `retirada` conserva la fila |
| `principal_activo_convocatoria_id` | INT, columna generada STORED | `convocatoria_id` si `rol='principal'` y `estado='activa'`, NULL en otro caso. `UNIQUE` → MySQL impide dos principales activos aunque falle el servicio. Prisma no la declara ni la escribe |
| `sustituye_a_id` | INT NULL | la asignación a la que reemplaza; clave foránea compuesta `(sustituye_a_id, convocatoria_id)` → `(id, convocatoria_id)`: ambas son de la **misma** edición |
| `retirado_at`, `retiro_motivo` | DATETIME(3), VARCHAR(300) | CHECK: `activa` sin ellos; `retirada` con ambos (motivo no vacío) |
| `revision`, `createdAt`, `updatedAt` | | como arriba |

Relaciones: `Docente 1 — N DocenteAsignacion N — 1 Convocatoria`. No se modifica `convocatorias`, `matriculas`, `estudiantes`, `cursos` ni los reportes. Ninguna clave foránea hacia `admin_users`: quién actuó consta en el historial.

### Historial

Reutiliza `academico_historial` (solo inserción, misma transacción que el cambio, sin claves foráneas). La migración **añade al final** del ENUM `entidad` los valores `docente` y `asignacion_docente`. Cada alta, edición, cambio de estado, retiro, reactivación y sustitución registra actor (id y rol de ese momento), revisión, estados, motivo y los **nombres** de los campos tocados; **nunca valores ni datos personales**. Si falla la inserción del historial, el cambio no se aplica (probado con un disparador que lo fuerza).

## API

Prefijo `/api`, JWT y `AccessGuard` global (denegación por defecto). Toda ruta exige exactamente un permiso y consta en `route-inventory.ts`. Sin JWT → 401; cuenta sin rol → 403. **Ningún dato de docentes es público.** No existe DELETE ni PUT genérico.

Las listas responden `{ ok, items, pagination: { page, limit, total, pages } }` (`page` desde 1, `limit` 20 por defecto y 100 como máximo); los detalles y escrituras, `{ ok, item }`. Los DTO rechazan con 400 cualquier campo no declarado (`forbidNonWhitelisted`): no se puede colar `activo`, `revision`, `rol`, `password` ni `id`.

### Docentes — `/api/admin/docentes`

| Método y ruta | Permiso | Cuerpo / consulta |
| --- | --- | --- |
| GET `/` | `docentes:leer` | `page`, `limit`, `search` (palabras en nombres, apellidos o DNI; todas deben coincidir; sin distinguir tildes ni mayúsculas), `especialidad` (contiene), `estado` = `activos` (predeterminado) \| `inactivos` \| `todos`. Orden fijo: apellidos, nombres, id |
| GET `/:id` | `docentes:leer` | 404 si no existe |
| GET `/:id/asignaciones` | `docentes:leer` | `page`, `limit`, `estado` = `activas` \| `retiradas` \| `todas` (predeterminado). Historial del docente, edición más reciente primero |
| POST `/` | `docentes:crear` | `nombres`\*, `apellidos`\*, `doc_numero`, `especialidad`, `profesion`, `email`, `telefono`, `confirmar_homonimo`. Cadena vacía = sin dato. 201 |
| PATCH `/:id` | `docentes:editar` | `revision`\* y al menos un campo. `''` limpia un campo opcional (también `doc_numero`); los obligatorios no admiten vacío. No cambia `activo` |
| PUT `/:id/estado` | `docentes:editar` | `revision`\*, `activo`\* (booleano). 409 si ya tiene ese estado |

\* obligatorio. Todas las respuestas de docente incluyen `asignaciones_activas` (conteo), útil para avisar antes de desactivar.

### Asignaciones — `/api/admin/asignaciones-docentes`

| Método y ruta | Permiso | Cuerpo / consulta |
| --- | --- | --- |
| GET `/` | `docentes:leer` | `page`, `limit`, `convocatoria_id`, `docente_id`, `rol`, `estado` = `activas` (predeterminado) \| `retiradas` \| `todas`. El principal va primero; después apellidos, nombres, id |
| GET `/:id` | `docentes:leer` | |
| POST `/` | `docentes:asignar` | `docente_id`\*, `convocatoria_id`\*, `rol` (predeterminado `participante`). 201 |
| PUT `/:id` | `docentes:asignar` | `revision`\*, `rol`\*: cambia el rol de una asignación **activa** |
| PUT `/:id/retiro` | `docentes:asignar` | `revision`\*, `motivo`\* (1–300 caracteres tras recortar) |
| PUT `/:id/reactivacion` | `docentes:asignar` | `revision`\*, `motivo`\*, `rol` (opcional; si se omite conserva el anterior) |
| POST `/:id/sustitucion` | `docentes:asignar` | `revision`\*, `docente_id`\* (el sustituto), `motivo`\*, `rol` (opcional; hereda el de la asignación sustituida). 201 `{ ok, item, anterior }` |

La asignación se devuelve con un **resumen** del docente (`id`, `nombres`, `apellidos`, `especialidad`, `activo`; sin documento, correo ni teléfono) y de la edición (`id`, `nombre`, `estado`, `archivado_at`, fechas `AAAA-MM-DD` y el curso `id`, `titulo`, `tipo`). Quien necesite los datos personales usa `GET /api/admin/docentes/:id` (`docentes:leer`).

## Permisos

Recurso nuevo `docentes` con `leer`, `crear`, `editar` y `asignar`. **Editar incluye activar/desactivar.** No existe `docentes:eliminar` (hay una prueba que lo impide), ni archivar ni exportar.

| Rol | Permisos de docentes | Estado |
| --- | --- | --- |
| `GERENTE_GENERAL` | los cuatro | regla vigente (tiene todos los permisos definidos) |
| `COORDINADORA_INSTITUCIONAL` | los cuatro | **autorizado por el responsable (2026-10-20)**: coordina ediciones, sesiones, asistencia y calificaciones, y ya trata datos personales de estudiantes |
| `SECRETARIA` | ninguno | **sin permisos sobre docentes en esta fase** (decisión autorizada): son datos personales de terceros y no se amplía su privilegio. Si se decide otra cosa en el futuro, bastaría añadir `docentes:leer` (y, si procede, `docentes:crear`) a su lista en `policy.ts` y a las pruebas |
| Cuenta básica (sin rol) | ninguno | 403 «sin rol» |

Los permisos se aplican a **todas** las rutas, incluidas asignaciones, sustituciones, retiros y reactivaciones (`docentes:asignar` para escribir y `docentes:leer` para consultar). Sin sesión, 401. No hay escalada: ni el DTO ni las rutas admiten `rol`, `permisos` ni cuentas, y registrar un docente nunca crea acceso.

La matriz de los demás permisos no cambia. `permissions.test.ts` fija el catálogo exacto, cada ruta y su permiso, y que secretaría y las cuentas sin rol queden denegadas.

## Reglas de negocio

**Docentes**

- **Duplicados.** El DNI y el correo son únicos (409 con el motivo). El nombre **no** lo es, porque existen homónimos: si ya hay un docente con los mismos nombres y apellidos (sin distinguir mayúsculas, tildes ni espacios repetidos) el alta responde 409 `{ codigo: 'POSIBLE_HOMONIMO', coincidencias: [ids] }`; quien registra confirma que es otra persona repitiendo con `confirmar_homonimo: true`. La comprobación de homónimos solo se hace al crear. Dos altas simultáneas con el mismo DNI o correo producen un 201 y un 409 (la barrera final es el índice UNIQUE).
- **Normalización.** Nombres, apellidos, especialidad y profesión: sin espacios exteriores y con los internos reducidos a uno. Correo en minúsculas. El DNI no se recorta ni se convierte: `12345678\n`, espacios o dígitos de otro alfabeto se rechazan.
- **Desactivar** no toca las asignaciones: las históricas se conservan y las **activas siguen activas** hasta que alguien con `docentes:asignar` las retire o las sustituya (retirarlas automáticamente es una decisión de negocio que no se ha tomado; la respuesta informa `asignaciones_activas`). Un docente inactivo no recibe asignaciones nuevas ni se le reactivan las retiradas.
- **Revisión.** Cada cambio exige la `revision` vista; una obsoleta responde 409 y dos escrituras simultáneas con la misma revisión dejan un ganador y un 409. Se serializa con un bloqueo de fila del docente.

**Asignaciones**

- El docente y la edición deben existir (404). Una edición **archivada o cancelada** no acepta cambios en su equipo (crear, cambiar rol, reactivar, sustituir); una **cerrada** sí, para registrar quién dictó una edición terminada. **Retirar siempre se permite**, para poder corregir un equipo mal registrado.
- Un docente aparece una sola vez por edición. Asignarlo de nuevo cuando ya tiene una fila retirada responde 409 indicando que se **reactive** esa fila.
- Un solo principal activo por edición: un segundo (por alta, cambio de rol o reactivación) responde 409, también ante peticiones simultáneas. Retirar al principal libera el puesto.
- **Sustitución**: en una transacción retira al docente actual (con el motivo) y crea la asignación del sustituto con `sustituye_a_id`; o se aplican ambas o ninguna. El sustituto debe estar activo, ser otro docente y no figurar ya en la edición.
- **Bloqueo y orden** (compatible con Ediciones y Matrículas): `READ COMMITTED`, curso → edición → docente → asignación. Cerrar, cancelar o archivar una edición se serializa con los cambios de su equipo docente.
- Cerrar una edición, matricular estudiantes o consultar reportes no cambia por la existencia de docentes: `matriculas`, `convocatorias` y `reportes` no se modificaron y las pruebas lo comprueban.

## Errores

| Código | Cuándo |
| --- | --- |
| 400 | cuerpo o consulta inválidos, campos no declarados, id no numérico, edición sin ningún campo, sustituto igual al actual |
| 401 | sin sesión o JWT inválido, vencido o revocado |
| 403 | sin permiso o cuenta sin rol (mensaje de la guard) |
| 404 | docente, edición o asignación inexistentes |
| 409 | DNI o correo duplicados, posible homónimo, revisión obsoleta, estado repetido, docente inactivo, edición archivada/cancelada, asignación duplicada, segundo principal, asignación ya retirada/activa |
| 503 | la base no tiene la estructura esperada (faltan migraciones): mensaje neutro, revisar `npm run db:check` |

Ninguna respuesta incluye SQL, nombres de índices, trazas ni valores de otros registros (las pruebas recorren todos los cuerpos de error). Un fallo interno responde 500 genérico.

## Migración y activación

`20261020-docentes` es **aditiva e idempotente**: dos `CREATE TABLE IF NOT EXISTS` (tablas nuevas, vacías, claves `RESTRICT`) y un `ALTER TABLE academico_historial MODIFY entidad ENUM(...)` que solo añade dos valores al final. No modifica filas ni columnas existentes ni inserta datos. Requiere antes `20261015-academico-estructura`, `20261016-academico-solo-dni` y `20261018-convocatorias-capacidad`; `db:check` la espera y verifica columnas, tipos, índices, claves foráneas, CHECK y la columna generada.

Como MySQL no hace DDL transaccional, una ejecución interrumpida deja un prefijo de las tres sentencias; **repetir `npm run db:migrate` la completa** (probado con cada prefijo, con datos previos intactos). Si una tabla homónima preexistente tiene otra forma, `CREATE TABLE IF NOT EXISTS` no la corrige: `db:check` la rechaza.

Orden de activación en un destino habitual, con autorización explícita. Este procedimiento se ejecutó en `horus_db` (pasos 1 a 5, ver [la activación real](activacion-docentes-mysql-real.md)); **se conserva para futuras instalaciones y otros entornos**, y los pasos 6 y 7 siguen pendientes:

1. Confirmar el destino (`DB_HOST`, `DB_NAME`) sin mostrar credenciales y que nadie más esté migrando.
2. `npm run db:backup` (más `uploads:backup` si corresponde) y `--verify-only` sobre el archivo.
3. `npm run db:check`: debe señalar únicamente las tablas de docentes y el ENUM del historial como pendientes.
4. `npm run db:migrate` (solo aplica lo pendiente).
5. `npm run db:check`: debe terminar en «Esquema compatible».
6. Desplegar el backend con `DocentesModule` (la migración va **antes** del código: el cliente Prisma consulta esas tablas).
7. Verificar con una cuenta de gerente: `GET /api/health`, `GET /api/admin/docentes` (200, lista vacía) y que una cuenta de secretaría reciba 403.

Recuperación: antes de desplegar el código y sin docentes registrados, las dos tablas y el ENUM se pueden revertir a mano con autorización (retirar `docente_asignaciones` y luego `docentes`; el `MODIFY` del ENUM falla por diseño si el historial ya usa los valores nuevos). Con datos, se restaura el respaldo en una base aislada `horus_restore_*` (`npm run db:restore`, que nunca escribe en `DB_NAME`) y se decide con el responsable. Nada de esto es automático.

## Pruebas

- `backend/test/docentes.test.ts` (sin base de datos): DTO (normalización, límites, campos ajenos, `null`), reglas de edición/docente activo, traducción de errores sin SQL y resumen de asignaciones sin datos personales.
- `backend/test/permissions.test.ts`, `migrations.test.ts`: catálogo, matriz, rutas frente a los decoradores reales, inventario y migración (estático).
- `backend/test/docentes.integration.cjs`: MySQL 8.4 desechable y HTTP real con la AppModule compilada (`npm run build` antes): migración desde una base previa con datos (filas y definiciones idénticas), recuperación con cada prefijo, restricciones por SQL directo (únicos, CHECK, claves foráneas, principal único), permisos por rol, alta/edición/listado/filtros, duplicados simultáneos, asignaciones, sustitución atómica, reversión conjunta con el historial, desactivación con historial, compatibilidad con Ediciones, Estudiantes, Matrículas y Reportes, y protección de datos personales.
- `backend/test/access-guard-http.integration.cjs`: el barrido por rol incluye las trece rutas nuevas (Gerencia y Coordinación pasan; Secretaría y la cuenta básica, ninguna).

Comandos (desde `backend/`, con la imagen `mysql:8.4` local; el ejecutor crea y retira su propio contenedor y no lee `.env`):

```powershell
node --test --test-concurrency=1 -r ./test/isolate-env.cjs -r ts-node/register test/docentes.test.ts test/permissions.test.ts test/migrations.test.ts
npm run build
node test/run-academic-isolated.cjs docentes
node test/run-academic-isolated.cjs access
node test/run-ediciones-disposable.cjs academico-schema.integration.cjs convocatorias.integration.cjs
```

### Integración continua

El job «Integración (MySQL efímero)» de `.github/workflows/ci.yml` ejecuta `node test/run-academic-isolated.cjs docentes` tras Reportes y antes de la importación CSV. Usa un contenedor `mysql:8.4` propio y desechable (`horus-fase3-<hex>`, solo en `127.0.0.1`, contraseña aleatoria de un solo uso, identidad verificada por `server_uuid`), nunca `horus_db` ni `horus_local`, no lee `.env` ni secretos, y el ejecutor lo retira en su bloque `finally`. El paso falla (código distinto de 0) si falla cualquier aserción, migración, permiso o restricción. No se debilitó ni se reordenó ningún paso anterior (AccessGuard, estructura académica, Ediciones, Matrículas, Reportes, Importaciones).

### Resultado de las pruebas de cierre (2026-10-20, Windows, MySQL 8.4 desechable en Docker)

- `tsc --noEmit` y `npm run build`: sin errores. `npm test`: 471 aprobadas, 0 fallos.
- `docentes.integration.cjs`: 16 de 16 aprobadas; contenedor retirado al terminar.
- Regresiones, cada una en su MySQL 8.4 desechable (todas con 0 fallos y contenedor retirado): AccessGuard HTTP 28/28, estructura académica 20/20, Ediciones 10/10, Estudiantes 8/8, Matrículas 16/16, Reportes 10/10, Importaciones CSV 15/15.
- Frontend (contratos de permisos, sin cambios visuales): `test:panel-access` 23/23 y `test:session-access` 15/15.
- Estas pruebas se hicieron antes de la activación: la migración `20261020-docentes` se aplicó después a `horus_db` (ver [Activación real](activacion-docentes-mysql-real.md)), no a ninguna otra base.

## Integración posterior con React (no implementada)

- Sección `?section=docentes` declarada en `PANEL_SECTIONS` (lectura: `docentes:leer`) y sus escrituras en `RESOURCE_WRITE`/`PANEL_ACTIONS` con los mismos permisos que el inventario; `test:panel-access` lo contrasta. Solo el backend decide el acceso.
- Equipo docente dentro de **Ediciones**: `GET /api/admin/asignaciones-docentes?convocatoria_id=…` (usa el permiso de docentes; sin él, ocultar el bloque).
- Usar `panelRequest`; listas paginadas; **revisión** en cada guardado con el flujo de 409 y fusión que ya usa el panel; bloqueo síncrono contra doble envío; resultado incierto (red, timeout, 5xx) sin reintento automático.
- Alta: si responde `POSIBLE_HOMONIMO`, mostrar las coincidencias y pedir confirmación explícita antes de repetir con `confirmar_homonimo: true`.
- Desactivar: mostrar `asignaciones_activas` y ofrecer retirarlas o sustituirlas, sin hacerlo por sí solo.
- No guardar datos de docentes en `localStorage`/`sessionStorage`; mensajes en español sin texto técnico del servidor.

## Dependencias con el módulo de Horarios y Sesiones

> **Histórico:** el módulo de Sesiones también se retiró (octubre de 2026) y su migración ya no se aplica. Los horarios recurrentes de las ediciones
> están en [Horarios de las ediciones](horarios-ediciones.md) y no dependen de docentes.

> Actualización: el backend de Horarios y Sesiones ya está implementado y probado (migración `20261020-sesiones-academicas`, **pendiente de activar**; ver [Horarios y sesiones académicas](horarios-sesiones-academicas.md)). Referencia `docente_asignaciones.id` como se propone abajo, valida docente activo y asignación activa al programar y detecta solapamientos del docente. Este módulo de Docentes **no se modificó**: retirar o desactivar a un docente sigue sin avisar ni bloquear por sus sesiones futuras (pendiente de decisión). El texto que sigue conserva el razonamiento original.

- Una sesión debería referenciar `docente_asignaciones.id` (no `docentes.id`): así el docente de una sesión pertenece, por clave foránea, al equipo de esa edición, y retirar a un docente con sesiones pendientes se puede detectar. Es la razón de conservar las asignaciones retiradas y de que la clave sea `RESTRICT`.
- Los permisos `sesiones:*`, `asistencia:*` y `calificaciones:*` ya existen y aún no se exigen en ninguna ruta.
- Los conflictos de horario (un docente en dos sesiones solapadas), la carga docente y la sustitución por sesión **no** están implementados: corresponden a ese módulo y se apoyarán en `docente_id` + rango horario.
- Un docente sin cuenta no puede iniciar sesión ni registrar asistencia o notas por sí mismo; si algún día lo necesita, vincular un docente con una cuenta será una decisión y una migración propias.

## Pendientes de decisión y límites

1. Permisos de Secretaría: denegados en esta fase (los de Coordinación quedaron autorizados).
2. Si desactivar un docente debe proponer o forzar el retiro de sus asignaciones activas.
3. Si el documento debe ser obligatorio para quienes figuren en certificados.
4. **Supresión de datos personales**: no hay borrado físico (se conserva el historial académico). Una solicitud de cancelación de datos exigiría un procedimiento explícito de anonimización, que no existe.
5. El correo es único: dos docentes no pueden compartir el mismo; se deja vacío o se usa otro.
6. La detección de homónimos es un aviso (solo al crear), no una restricción de la base.
7. No se cuenta aún con límite de frecuencia propio en estas rutas (las protege el JWT y el rol, como el resto del panel).
