# Gestión de matrículas e historial académico

Fase 3 de NestJS/Prisma/MySQL y React, sobre las tablas existentes: Estudiante → Matricula ← Convocatoria ← Curso. Laravel permanece fuera de este flujo. Pantalla: `/admin/dashboard?section=matriculas`.

## API y permisos

Todas las rutas tienen prefijo `/api/admin/matriculas`, JWT y AccessGuard global. La matriz de roles no cambia.

| Método y ruta | Permiso | Contrato |
| --- | --- | --- |
| GET `/` | `matriculas:leer` | `page`, `limit`, `search`, `estudiante_id`, `curso_id`, `convocatoria_id`, `estado` |
| GET `/ediciones` | `matriculas:leer` | Selector paginado, `search` por curso/edición, filtro `curso_id`; incluye ocupados y disponibles |
| GET `/:id` | `matriculas:leer` | Matrícula, estudiante y edición con curso |
| GET `/:id/historial` | `matriculas:leer` | Historial paginado, más reciente primero |
| POST `/` | `matriculas:crear` | `estudiante_id`, `convocatoria_id`, `convocatoria_revision`; crea activa/pendiente |
| PUT `/:id/anulacion` | `matriculas:anular` | `revision`, `motivo` obligatorio (1–300 caracteres después de quitar espacios exteriores) |
| PUT `/:id/reactivacion` | `matriculas:anular` y comprobación de `matriculas:editar` en servicio | `revision`, `convocatoria_revision`, `motivo` obligatorio |

Las listas responden `{ ok, items, pagination: { page, limit, total, pages } }`; los detalles/escrituras, `{ ok, item }`. Página inicial 1, límite predeterminado 20 y máximo 100. Búsqueda por palabras en nombres, apellidos, DNI, título del curso y nombre de edición. Las fechas de edición se serializan como `YYYY-MM-DD`.

Gerente y coordinación consultan, registran, anulan y reactivan. Secretaría consulta y registra; no anula ni reactiva. La reactivación revierte una anulación y exige su mismo privilegio, además de editar: el permiso editar de Secretaría no concede esa acción. Cuentas básicas reciben 403; sin JWT, 401. No existe DELETE ni PUT genérico para eludir las transiciones.

## Estados y cupos

Se conservan los estados NestJS `activa` y `anulada`. La única transición de esta fase es activa → anulada y su reactivación inversa. Un estado repetido o una revisión obsoleta responde 409. No se implementa confirmación de cumplimiento ni se modifican sus campos: no son estados de inscripción. No se implementan notas, asistencia, pagos ni certificados. Si ya existe un certificado vigente heredado, la matrícula no se puede anular desde este módulo.

Una matrícula activa consume un cupo, cualquiera que sea su cumplimiento; una anulada no consume. La ocupación se calcula desde `matriculas` usando el índice existente `(convocatoria_id, estado)`. No hay contador independiente que pueda desincronizarse.

Las altas y reactivaciones exigen estudiante sin archivar y edición abierta, sin archivar y con capacidad positiva definida. `NULL` significa **capacidad pendiente de configurar** y bloquea esas operaciones con 409; nunca se interpreta como capacidad ilimitada. Las fechas siguen el contrato de Ediciones; no se inventa otra ventana de inscripción automática.

La anulación permite liberar cupos aunque la edición esté cerrada/cancelada/archivada o el estudiante archivado. La reactivación siempre revalida la disponibilidad y el estado actual. La restricción UNIQUE existente `(estudiante_id, convocatoria_id)` incluye anuladas: se reactiva la fila original en vez de crear otra.

## Transacciones y concurrencia

Todas las escrituras usan una transacción InnoDB `READ COMMITTED`, con bloqueos `SELECT … FOR UPDATE` en orden **curso → edición → estudiante → matrícula**. Ediciones ya usa curso → edición: una reducción de capacidad o cierre se serializa con la admisión de una matrícula. El curso de una edición y las relaciones de una matrícula son inmutables en estas APIs.

Después de obtener los bloqueos se releen estado/revisión y se cuentan las matrículas activas. Dos solicitudes por el último cupo producen un alta y un 409. Dos altas para el mismo estudiante/edición producen una única fila y un 409, incluso tras un doble clic. Dos cambios con la misma revisión de matrícula producen un cambio y un 409. No hay reintentos automáticos de escrituras.

`convocatoria_revision` identifica los datos de edición vistos por el operador. Una matrícula no incrementa la revisión de la edición: la ocupación se comprueba nuevamente bajo bloqueo, aunque la revisión permanezca igual. Un cambio de capacidad o estado sí la incrementa y vuelve obsoleta la selección anterior. El bloqueo de curso también serializa otras ediciones del mismo curso, siguiendo el protocolo existente. Escritores SQL externos deben respetar este protocolo; la integridad de cupos no se promete frente a SQL arbitrario que lo omita.

## Historial y panel

El alta (`creacion`), la anulación (`anulacion`) y la reactivación (`cambio_estado`) insertan `AcademicoHistorial` en la **misma transacción**. Si falla esa inserción, la matrícula tampoco cambia. Se conservan todos los movimientos previos. La fila identifica la matrícula por `entidad_id`; sus relaciones inmutables identifican estudiante y edición mediante el detalle. Registra hora, responsable autenticado por ID y rol de ese momento, estados, revisión, nombres de campos y motivo. No copia nombres/DNI al historial ni a logs nuevos.

El panel incluye lista paginada, búsqueda/filtros, selección paginada de estudiantes y ediciones existentes, cupos, detalle, historial paginado y confirmación con motivo. Las ediciones no admisibles aparecen deshabilitadas en el alta. Mantiene componentes, colores y estilos del panel, sin cambios del sitio público. Ofrece carga, vacío, error/reintento y protección de borradores.

Los envíos se bloquean sincrónicamente para evitar doble clic. Un 409 conserva la selección/motivo y exige consultar datos actuales antes de iniciar otra operación. Red/timeout/5xx o respuesta ilegible se tratan como resultado incierto, sin reintentar. El motivo se conserva, y los cambios sin guardar requieren confirmación al salir. 401/403 siguen el manejo centralizado de sesión.

## Migraciones y activación

No se añade ni reescribe ninguna migración. Se reutilizan las restricciones UNIQUE/FK, historial y revisiones académicas existentes. Sigue pendiente en los destinos habituales **`20261018-convocatorias-capacidad`**, ya registrada en `backend/scripts/migrate.cjs`; debe aplicarse antes de activar Ediciones/Matrículas. Conserva las capacidades heredadas como NULL. El responsable debe configurar esas capacidades explícitamente antes de admitir estudiantes.

Esta implementación no aplica migraciones a `horus_db`, `horus_local` ni `horus_group`, ni cambia sus datos, roles, contenedores o `.env`. La activación en una base habitual exige una tarea posterior autorizada que verifique destino y respaldo.

## Comprobaciones reproducibles

Desde `backend/`, con dependencias existentes, build previo e imagen `mysql:8.4` ya disponible:

```powershell
npm run build
node --test -r ./test/isolate-env.cjs -r ts-node/register test/matriculas.test.ts
node test/run-academic-isolated.cjs matriculas
node test/run-academic-isolated.cjs access
node test/run-academic-isolated.cjs estudiantes
node test/run-academic-isolated.cjs ediciones
```

El ejecutor crea un contenedor nuevo por suite, comprueba imagen/UUID por Docker y por conexión, usa credenciales ficticias por entorno y puerto efímero solo en bucle local, y retira exclusivamente su contenedor identificado por nombre y etiqueta. No lee `.env`, descarga imágenes ni usa Compose. Se comprueba que el servidor esté vacío antes de preparar bases con prefijo propio. Para la regresión de Estudiantes crea una plantilla vacía `horus_students_template_<hex>` desde los SQL versionados dentro de ese servidor; el test copia únicamente su estructura. No consulta las plantillas habituales. El barrido AccessGuard respeta las ventanas reales del limitador y tarda varios minutos.

Para navegador con persistencia real, compilar antes el frontend y ejecutar desde `backend/`:

```powershell
$env:MATRICULAS_BROWSER='true'
$env:MATRICULAS_SCREENSHOTS_DIR=Join-Path $env:TEMP 'horus-fase3-capturas'
node test/run-academic-isolated.cjs matriculas
```

Solo el proceso de integración entrega la API/credenciales ficticias al smoke por IPC. El navegador usa un puente HTTP local hacia el AppModule real; no simula respuestas en ese modo. Nunca admite `MATRICULAS_API_URL`. Los recursos externos se bloquean antes de enviarse. Las capturas contienen exclusivamente fixtures ficticios y quedan fuera del repositorio.

Desde `frontend/`: `npm run test:enrollments` prueba reglas/payload/acciones; `npm run smoke:enrollments` compila y prueba el navegador con API simulada, incluyendo conflictos e incertidumbre. Para ambos paquetes ejecutar también sus controles de tipos, suites, ESLint del frontend y builds. CI añade pruebas puras de Matrículas y su integración en contenedor propio; los smokes de navegador siguen siendo comprobaciones locales, sin afirmar CI ni despliegue a partir de ellas.

## Verificación previa a la publicación — 19 de octubre de 2026

| Comprobación ejecutada | Resultado y alcance |
| --- | --- |
| Backend `npm test` (Node 24.19.0, Windows) | **431/431**, sin omitidas, en serie con `isolate-env`; 134 s; sin `ETIMEDOUT` |
| Backend, misma suite en `node:22` (22.23.3) | **430/431**; el único fallo es `build-output.test.ts` por `spawnSync … ETIMEDOUT` del `nest build` interno (límite de 10 s) sobre el montaje Windows → Linux, cuya E/S alargó la suite a 52 min. Es ambiental y pasa en disco nativo; no se cambió su límite |
| Frontend `node --experimental-strip-types --test tests/*.test.mjs` | **117/117** en Node 24.19.0 y **117/117** en `node:22` (22.23.3) |
| Backend `tsc --noEmit --incremental false`; frontend `npm run check` y `npm run lint` | Aprobados |
| `npm run build` en ambos paquetes | Aprobados; generación Prisma sin conexión MySQL |
| `run-academic-isolated.cjs matriculas`, con `MATRICULAS_BROWSER=true` | **16/16** en MySQL 8.4 y Edge (dos ejecuciones; la segunda tras corregir la limpieza de su carpeta temporal): persistencia, permisos, validación, ocupación, duplicados, transiciones, historial, rollback y navegador escritorio/móvil |
| `run-academic-isolated.cjs access` | **28/28** (224 s); AppModule real, guards en orden y barrido completo con las rutas de Matrículas, sin ampliar permisos |
| `run-academic-isolated.cjs estudiantes` / `ediciones` | **8/8** y **10/10**; regresión con API real en contenedores nuevos |
| Smokes de navegador con API simulada, en serie | 14/14 con código 0: Matrículas, Estudiantes, Ediciones, `panel-access`, `panel-actions`, `auth`, `session-access`, `signup`, `roles`, `chatbot`, `panel-sections`, `smoke-ui`, `smoke-home` y `smoke-global-content`; sin Edge `horus-*` sobrantes |
| Diff y límites operativos | `git diff --check` aprobado; huella SHA-256 de `.env` idéntica al inicio y al final; sin cambios en Laravel/Compose ni en los contenedores habituales |

La integración de Matrículas cubre carreras por el último cupo entre dos altas y entre alta/reactivación, duplicado simultáneo, dos anulaciones con la misma revisión, capacidad/cierre concurrentes con alta y fallo del historial durante alta, anulación y reactivación. Rechaza estudiante/edición inexistentes, registros archivados, estados no admisibles, capacidad NULL, cupo agotado y revisiones antiguas. Comprueba filtros/páginas, relaciones restrictivas y ausencia de DELETE.

Las integraciones en contenedor aplican desde cero `00000000-initial` y todas las versiones de `backend/scripts/migrate.cjs`, incluida `20261018-convocatorias-capacidad`. La reproducción en Node 22 usó la imagen local `node:22` sin red y con el repositorio montado en solo lectura; no se instalaron dependencias. La prueba del navegador con MySQL usó el puente local descrito arriba; los demás smokes usaron respuestas simuladas. No se verificaron correo real, IA externa ni datos habituales.

## Archivos de esta entrega

Nuevos:

- `backend/src/matriculas/matriculas.controller.ts`, `matriculas.dto.ts`, `matriculas.module.ts`, `matriculas.service.ts`.
- `backend/test/matriculas.test.ts`, `matriculas.integration.cjs`, `run-academic-isolated.cjs`.
- `frontend/src/panel/components/AcademicSelect.tsx`, `EnrollmentEditor.tsx`, `EnrollmentOperation.tsx`, `EnrollmentDetail.tsx`, `PanelEnrollments.tsx`.
- `frontend/src/panel/services/enrollments.ts`, `frontend/tests/enrollments.test.mjs`, `frontend/scripts/smoke-matriculas.cjs`.
- `docs/procedimientos/gestion-matriculas.md`.

Modificados:

- `backend/src/app.module.ts`, `backend/src/permissions/permissions.ts`, `backend/src/permissions/route-inventory.ts`: módulo e inventario; Matrículas deja de ser recurso futuro. No cambia la matriz de roles.
- `backend/test/permissions.test.ts`, `backend/test/access-guard-http.integration.cjs`, `backend/test/estudiantes.integration.cjs`: rutas nuevas y plantilla desechable.
- `frontend/src/panel/pages/AdminDashboard.tsx`, `frontend/src/panel/context/panelAccess.ts`, `frontend/src/panel/styles/academic-panel.css`: sección, navegación y estilos acotados.
- `frontend/tests/panel-access.test.mjs`, `frontend/scripts/smoke-panel-access.cjs`, `frontend/package.json`: expectativas del menú y comandos nuevos.
- `.github/workflows/ci.yml`, `AGENTS.md`, `docs/procedimientos/gestion-ediciones.md`: cobertura y contratos actualizados.

## Activación pendiente

Las capturas del smoke con `MATRICULAS_SCREENSHOTS_DIR` solo contienen datos ficticios y se guardan fuera del repositorio. `backend/.env` está ignorado por Git y no forma parte de esta entrega.

Por configuración, el backend del equipo apunta a `horus_db` local y el backend de Docker a `horus_local` en MySQL 8.4. Esta entrega no conectó, migró ni modificó esas bases; los contenedores habituales se conservaron y los de prueba se retiraron.

Orden de activación en un destino habitual, en una tarea posterior con autorización explícita:

1. Verificar la identidad del destino y obtener `npm run db:backup` (más `uploads:backup` si corresponde).
2. Aplicar las migraciones pendientes con `npm run db:migrate`; para Ediciones y Matrículas la necesaria es `20261018-convocatorias-capacidad` (aditiva: deja la capacidad NULL en las filas anteriores). Esta fase no añade migraciones.
3. Ejecutar `npm run db:check` y desplegar después el código.
4. Configurar la capacidad de cada edición heredada que deba admitir matrículas; mientras sea NULL, altas y reactivaciones responden 409.
5. Comprobar que las cuentas tengan el rol correcto antes del uso real.
