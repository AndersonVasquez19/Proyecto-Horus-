# Gestión de ediciones académicas

Implementación de fase 2 sobre Curso → Convocatoria. No crea matrículas ni modifica el catálogo público.

> **Horarios (octubre de 2026):** los días y horas recurrentes de cada edición se consultan y reemplazan con `GET`/`PUT /api/admin/convocatorias/:id/horarios`
> (permisos `convocatorias:leer`/`convocatorias:editar`). Reemplazar los horarios **sube la revisión de la edición**: tras guardarlos, Editar, abrir, cerrar o
> archivar deben usar la revisión nueva. Contrato: [Horarios de las ediciones](horarios-ediciones.md).

## Plan de trabajo

1. Añadir capacidad nullable para conservar filas anteriores sin inventar cupos. Exigir capacidad positiva en altas nuevas y antes de abrir. Probar la migración en MySQL desechable.
2. Implementar lista paginada, selector paginado de cursos, detalle, alta, edición, apertura, cierre/cancelación y archivo/restauración. Mantener curso inmutable después del alta. Revisión obligatoria y transacciones con bloqueo para evitar duplicados por curso/nombre y cambios simultáneos; historial académico en la misma transacción.
3. Conectar Ediciones al panel existente, sus permisos y protección de borradores. Añadir filtros, detalle, formularios y confirmaciones, conservando el diseño de Estudiantes.
4. Comprobar DTO, servicio, permisos, HTTP/MySQL, concurrencia, navegador de escritorio/móvil y regresiones. Ejecutar tipos, lint, builds y barrido AccessGuard completo.

## Contrato

Base `/api/admin/convocatorias`; todas las rutas requieren JWT y AccessGuard.

| Método y ruta | Permiso | Uso |
| --- | --- | --- |
| GET `/` | convocatorias:leer | Lista: page, limit, search, curso_id, estado, archivo (activos/archivados/todos) |
| GET `/cursos` | convocatorias:leer | Selector paginado de cursos existentes; search, page, limit |
| GET `/:id` | convocatorias:leer | Detalle |
| POST `/` | convocatorias:crear | curso_id, nombre, fecha_inicio, fecha_fin, capacidad; estado inicial planificada |
| PUT `/:id` | convocatorias:editar | revision y campos modificados; curso y estado no se editan aquí |
| PUT `/:id/apertura` | convocatorias:editar | revision; planificada → abierta |
| PUT `/:id/cierre` | convocatorias:cerrar | revision, estado (cerrada/cancelada); abierta → cerrada/cancelada, planificada → cancelada |
| PUT `/:id/archivo` | convocatorias:archivar | revision, archivado booleano; solo cerradas/canceladas |

Las fechas son de calendario `YYYY-MM-DD`, entre 1000 y 9999, con fin ≥ inicio. Capacidad es entero positivo hasta 2147483647; las ediciones anteriores pueden conservar NULL (sin definir). Las ediciones abiertas requieren ambas fechas y capacidad. Las cerradas, canceladas o archivadas no se editan ni reabren. No se cambia el curso asociado para conservar las relaciones académicas existentes. Capacidad no puede bajar del número de matrículas activas existente. La fase 3 añade la [API de Matrículas](gestion-matriculas.md), que comparte los bloqueos de curso/edición con este módulo para serializar admisiones y cambios de capacidad.

Un mismo curso no admite dos ediciones con el mismo nombre según la colación MySQL, incluidos los archivados. La comprobación se serializa bloqueando el curso; no se añade una restricción UNIQUE que pudiera impedir migrar datos anteriores. Los escritores externos deben respetar este protocolo. Un duplicado devuelve 409, al igual que una revisión obsoleta. No se borran filas. El historial solo guarda nombres de campos, estados, actor y revisión.

## Migración propuesta

`20261018-convocatorias-capacidad.sql`, registrada en `scripts/migrate.cjs`, añade únicamente `capacidad INT NULL` y su CHECK positivo. No rellena datos anteriores. Se aplica con el ejecutor SQL existente del proyecto, sin Prisma Migrate. No aplicar en bases habituales sin autorización y verificación del destino. Un despliegue requiere aplicar esta migración antes del código.

## Verificación

Los resultados y límites de las ejecuciones se entregan al finalizar. Las pruebas automatizadas utilizan configuración ficticia; cualquier MySQL de integración debe ser un servidor desechable identificado por UUID. No se permite apuntarlas a horus_db, horus_local ni horus_group.

Desde `backend/`: `node --test -r ./test/isolate-env.cjs -r ts-node/register test/convocatorias.test.ts` prueba DTO, reglas y errores del servicio. Desde `frontend/`: `npm run test:editions` prueba formularios/acciones; `npm run smoke:editions` ejecuta Edge con API simulada y bloquea destinos externos.

Para integración local, con Docker disponible y la imagen `mysql:8.4` ya instalada: `node -r ./test/isolate-env.cjs test/run-ediciones-disposable.cjs`. Crea un contenedor propio con puerto efímero de bucle local, UUID comprobado y contraseña ficticia, ejecuta AccessGuard, esquema académico y Ediciones, y retira únicamente ese contenedor. No usa los contenedores del proyecto ni instala imágenes. Se puede pasar uno de los tres nombres de suite para repetirla aisladamente. La suite de cuotas respeta las ventanas reales de un minuto y puede tardar varios minutos.

`EDITIONS_BROWSER=true` activa además React ↔ NestJS ↔ MySQL para la suite de Ediciones. El navegador recibe el destino aislado por IPC, rechaza URLs de API por entorno y no almacena las credenciales. `EDITIONS_SCREENSHOTS_DIR` guarda las capturas fuera de Git. Las pruebas históricas de DNI preparan capacidad en su línea base para seguir comparando exactamente sus dos ALTER; la suite de Ediciones comprueba por separado la actualización natural de un esquema anterior con datos.

## Verificación previa a publicación

- Se utilizó Node 22.23.3 portable en Windows, con SHA-256 comprobado contra el manifiesto oficial, y la imagen local `node:22` (`sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8`) en Linux. No se instalaron dependencias ni se descargaron imágenes. La copia Linux excluyó `.env`, bases y respaldos y reutilizó las dependencias existentes dentro del sistema de archivos del contenedor.
- Backend completo en Linux, mediante `npm test`: **427/427**, sin omitidas, en 135,9 segundos. TypeScript también aprobado. Las 47 pruebas específicas de DTO/reglas/servicio de Ediciones, permisos, AccessGuard y separación de compilaciones pasaron en Windows.
- **Limitación de Windows:** se reprodujo el resultado 426/427 por `ETIMEDOUT` al compilar el fixture de `build-output.test.ts`, tanto en paralelo como en una repetición en serie; también ocurrió en un intento aislado. Otra ejecución completa en serie pasó 427/427. El fixture solo contiene dos módulos sintéticos y no importa Ediciones. En Linux sus tres compilaciones pasaron en 4,6 segundos en total. Esto respalda un problema ambiental/intermitente del compilador en este Windows; no se aisló el componente concreto responsable. No se modificaron la prueba ni sus límites de 10/30 segundos ni se omitieron casos.
- `npm test` queda en serie, igual que CI, para reducir la competencia entre compilaciones. Esta alineación no elimina por sí sola la intermitencia observada en Windows; la referencia de cierre es la ejecución completa Linux/Node 22 y la CI del SHA publicado.
- Ediciones HTTP/MySQL y navegador real: **11/11**, incluida la migración sobre un esquema anterior con datos, permisos, duplicados, escrituras simultáneas, calendario/capacidad, rollback del historial, estados terminales y archivo/restauración. Se verificó React ↔ NestJS ↔ MySQL en escritorio y móvil. Una ejecución quedó interrumpida durante el navegador al perderse la sesión/Docker; se repitió la suite completa de Ediciones y terminó con código 0.
- AccessGuard completo: **28/28**, con 356 solicitudes en el barrido (89 por perfil). Las ocho rutas nuevas mantienen JWT y el permiso correspondiente: gerente/coordinación acceden a las ocho; secretaría solo a las tres lecturas; la cuenta básica a ninguna. Esquema académico y backup/restauración: **20/20**. Integraciones adicionales en Linux/MySQL 8.4.11: Prisma/persistencia **19/19**, scripts administrativos **12/12**, preparación de cuentas **9/9** y backup/collation **6/6**. Todos los destinos fueron contenedores propios identificados por UUID y retirados al finalizar.
- Frontend: **113/113** pruebas unitarias, TypeScript, ESLint y build aprobados con Node 22. Backend: TypeScript y build aprobados también en Windows con Node 22. La suite de limpieza pasó **27/27**, incluido inicio/cierre de Edge real; no quedaron procesos Edge de estas pruebas.
- Ocho smokes en serie, con API simulada y sin servicios externos: navegación por permisos, Ediciones, Estudiantes, autenticación, contrato de sesión, operaciones por permisos, chatbot y UI pública. Todos terminaron con código 0. Se actualizaron únicamente las dos listas esperadas del smoke de navegación para incluir Ediciones: antes fallaban ocho comparaciones de menú, mientras las comprobaciones de permisos y sesión ya pasaban. ESLint del archivo actualizado también pasó. Las capturas con datos ficticios y los logs quedan fuera de Git.
- La migración sigue pendiente de activación en los destinos habituales: confirmar destino/UUID, respaldo y migraciones académicas previas, obtener autorización y aplicarla **antes** de desplegar el módulo. Esta verificación no ejecutó migraciones ni escrituras en `horus_db`, `horus_local` o `horus_group`, ni modificó Laravel, SQLite o `.env`. El workflow de CI solo comprueba; su resultado debe verificarse para el SHA publicado.
