# Cierre técnico del backend consolidado

23 de octubre de 2026, America/Lima. Registro del cierre técnico previo, conservado como evidencia histórica.
La operación posterior de publicación está documentada en [Entrega final](entrega-backend-20261023.md), que actualiza
autorizaciones, validación y publicación. Las menciones de «sin commit/push» de este registro describen aquella revisión.

## Versión y conservación del trabajo

- Rama `anderson`, HEAD `8869e2c789e9b213d5c08a7e4c49a7c648360dd3`, sin cambios de rama ni HEAD.
- Consolidación previa sin commit: **106 rutas de archivo** modificadas, eliminadas o nuevas frente a HEAD.
  `status --porcelain` inicial muestra 101 entradas (agrupa carpetas nuevas), 13 con cambios preparados,
  75 con cambios no preparados y 14 entradas sin seguimiento; hay solapamientos entre estados, no se suman.
- Antes de editar se guardaron binarios exactos, parches de índice y árbol, inventario SHA-256 y estados de Git/Docker en
  `%USERPROFILE%\.codex\backups\horus-cierre-2026-10-23T19-40-32-716Z\`. Se verificó la copia de cada archivo existente.
- Respaldo independiente de la integración encontrado en
  `%USERPROFILE%\Documents\horus-respaldos\integracion-h01-h05-20261023-140446\`: 36 archivos, 2 065 476 bytes,
  con parches preparados/no preparados de `anderson`, copia de archivos nuevos y artefactos de Codex.
  Se inventariaron por SHA-256 sin aplicarlos. Su existencia y legibilidad se verificaron; no se restauró ese respaldo Git.
- Stashes conservados, coincidentes con los hashes del respaldo independiente y con objetos conectados (`git fsck`):
  `2599fb8558830d6d11f49a7ced757d89dd8f9116` y `cc173cc52d26611facaf85c58987142487428470`.
- No se modificó el worktree antiguo de Codex ni se reaplicó H-01 a H-05.

## Cambios de este cierre

Solo se modifica `backend/test/preinscripciones.integration.cjs` sobre la consolidación previa:

1. Prueba HTTP con AppModule/AccessGuard, Prisma y MySQL reales para H-04: 123 ediciones, las primeras 60 llenas,
   63 disponibles, fechas nulas e iguales, matrículas activas/anuladas, orden exacto, máximo 50 y respuesta pública completa.
   Verifica las dos instancias, una sola disponible después de las llenas y lista vacía únicamente al agotarlas.
   Limpia exclusivamente las filas ficticias que creó, dentro del servidor desechable.
2. Comprobación de versión del servidor permite 8.0.46 **solo cuando el runner selecciona explícitamente esa imagen**;
   por defecto sigue exigiendo 8.4. UUID, servidor recién creado y ausencia de bases ajenas siguen siendo obligatorios.

Se añaden este informe, la [guía para React](contrato-react-backend-consolidado.md) y la
[propuesta de privilegios](privilegios-mysql-propuesta.md). No se confirmó otro defecto de producción que justificara
cambiar servicios, configuración, timeouts, permisos, esquema o funcionalidades. H-06 y H-07 no se implementan.

## H-01 a H-05 y simplificación académica

| Elemento | Estado comprobado |
| --- | --- |
| H-01 | Autenticador Swagger exige cuenta activa y rol administrativo conocido; regresiones HTTP de UI/JSON/YAML. |
| H-02 | Cuota reservada antes de autenticar; ráfagas y respuestas tardías cubiertas, sin perder reservas ajenas. |
| H-03 | READ COMMITTED, bloqueo del curso y comparación completa de la instantánea antes de actualizar. No se modificó; su integración 4/4 anterior no se repitió. |
| H-04 | Búsqueda por cursor en lotes de 50, filtrado de ocupación antes del límite final; ahora comprobada con MySQL 8.4 y 8.0.46. |
| H-05 | CORS expone Content-Disposition al origen autorizado; regresión HTTP aprobada. |
| Horarios | Módulo independiente, GET/PUT por edición, revisión compartida, hora de Lima, historial y migración activa. |
| Sesiones y Docentes | Sin módulos/rutas/permisos activos. Se preservan las tablas históricas, datos, respaldo y migración de Docentes. La migración de Sesiones figura retirada. |
| Certificados | Sin administración, PDF, reportes ni herramienta de asistente. Se preservan tablas/modelos/bloqueo histórico de matrículas. GET público de verificación permanece. |

La retirada se contrasta con AppModule, controladores, catálogo del asistente, matriz e inventario de rutas y pruebas
unitarias de la suite general; Horarios ensaya además bases históricas con Sesiones y su respaldo/restauración.

## Pruebas ejecutadas

Node **22.23.3**, disponible previamente en la caché local; PATH cambiado solo para los procesos propios.
No se instalaron dependencias ni se cambiaron lockfiles. Se conservó `test/isolate-env.cjs`.
Los tests TS usan `TS_NODE_TRANSPILE_ONLY=true` después de comprobar tipos por separado.

| Comprobación | Resultado de esta ejecución |
| --- | --- |
| TypeScript, incluidos tests: `node node_modules/typescript/bin/tsc --noEmit --incremental false` | Salida 0. |
| `npm run build` | Salida 0; Prisma 6.19.3 generado, sin conexión/migración de MySQL. |
| Siete archivos de regresión H-01 a H-05 | **82/82**, 0 fallos/omisiones/cancelaciones. |
| Suite completa final: `npm test` | **803/803**, 0 fallos/omisiones/cancelaciones, 223,03 s. |
| Preinscripciones, MySQL 8.4 | **27/27**, incluye H-04; 98,75 s. |
| Preinscripciones, MySQL 8.0.46 | **27/27**, incluye H-04; 96,53 s. |
| Horarios, MySQL 8.4.11 | **14/14**, 51,01 s. |
| Horarios, MySQL 8.0.46 | **14/14**, 104,94 s. |
| E3.6 ciclo sin base, dos ejecuciones aisladas | **7/7** en cada una; caso de puerto cerrado 33,60 s y 39,14 s. |
| AccessGuard completo con MySQL 8.4 | **28/28**, 0 fallos/omisiones/cancelaciones; 204,59 s, incluido el ciclo E3.6. |
| Ensayo del respaldo real, únicamente en clon 8.0.46 | Restauración, migración, estructura, datos originales, idempotencia, nuevo backup y roundtrip aprobados. |
| Sintaxis del CJS modificado, `git diff --check` y `git diff --cached --check` | Sin errores. |

Las cifras no se suman: algunas suites incluyen pruebas contenedoras y las regresiones están también en la suite general.
No se reproduce el antiguo conjunto de 169 como una suite independiente; se identifica expresamente el conjunto ejecutado.
No se ejecutó CI remota. No se prueba navegador/React, correo, OpenAI, proxy real ni producción.

Los siete archivos de regresión son `security-headers`, `catalogo-concurrency`, `preinscripciones-editions`, `catalogo`,
`preinscripciones`, `institutional-fixes` y `original-content` (`backend/test/*.test.ts`).

## E3.6: diagnóstico y límite de la conclusión

Se conserva íntegro `access-guard-http.integration.cjs` y su espera de 60 segundos. En ambas repeticiones el hijo salió
con código 1, sin mensaje IPC ready y sin abrir el puerto HTTP; al perder IPC durante arranque salió con código 3,
en 26 ms y 50 ms respectivamente. Los centinelas ajenos al ensamblado siguieron vivos.

Diagnóstico adicional con `PrismaService` compilado y un puerto TCP propio que se cerró antes de conectar:
importaciones 1,318 s, `$connect()` 15,063 s, `SELECT 1` rechazado 15,026 s. Se desconectó el cliente al terminar.
En el adaptador **instalado** `@prisma/adapter-mariadb` 6.19.3, `connect()` consulta primero `SELECT VERSION()`;
`getCapabilities()` captura su fallo y devuelve capacidades conservadoras. La comprobación posterior `SELECT 1`
de `PrismaService.onModuleInit()` vuelve a esperar el pool. `acquireTimeout=15000` explica dos esperas consecutivas.
El conector MariaDB instalado reintenta conexiones con backoff durante la inicialización.

La ejecución completa posterior de AccessGuard volvió a aprobar el ciclo sin base (35,84 s para el ciclo entero);
esta tercera ejecución tampoco reprodujo el exceso de 60 segundos.

Esto explica la duración normal observada; **no demuestra la causa del timeout histórico de más de 60 s**.
Carga del host, importaciones y planificación pueden influir, pero no se atribuye el fallo a ellas sin evidencia.
No se reducen comprobaciones ni se sube el timeout, ni se parchean dependencias. Conservar el caso actual y,
si reaparece, capturar tiempos de importación, conexión, SELECT 1 y salida del hijo junto a la carga de ese momento.

## Origen MySQL y ensayo privado

Origen verificado mediante lecturas: loopback, `horus_db`, MySQL **8.0.46**, UUID
`dc5bb32a-a7b2-11f1-913f-14b5cd19372a`, **27 tablas y 16 migraciones** (hasta `20261020-docentes`).
Pendientes únicamente `20261020-preinscripciones` y `20261023-convocatoria-horarios`.
`20261020-sesiones-academicas` no está registrada ni se aplica en la secuencia activa.
`db:check` de origen sale 1 por las estructuras pendientes; esto no se oculta como un origen listo para el código actual.

Antes de acceder a filas se comprobó el directorio privado
`%USERPROFILE%\.horus-respaldos\cierre-backend-20261023-1940\`, fuera de Git/OneDrive,
con ACL exclusivamente para PCT40T y SYSTEM. Backup con los scripts existentes, credenciales solo en memoria/entorno
del proceso, sin argumentos secretos; los logs del arnés se comprobaron contra las contraseñas utilizadas.
El volcado permanece privado; no se publica su contenido. Las huellas de comparación guardan hashes y recuentos,
no filas. El respaldo contiene datos personales/hashes y debe conservarse bajo la política privada de cifrado/retención;
el script de backup no incorpora cifrado por sí mismo.

El ensayo final (`attempt3/`) hizo lo siguiente:

1. Verificó de nuevo identidad/UUID y capturó estructura, columnas, metadatos, recuentos y hashes de filas bajo lectura consistente.
2. Creó un backup nuevo y verificó SHA-256 y sentencias permitidas, sin conectar durante `--verify-only`.
3. Creó contenedor propio `mysql:8.0.46`, sin bind mounts ni volúmenes previos, puerto publicado solo en loopback;
   UUID TCP contrastado con `docker exec`, distinto del origen y servidor sin bases de usuario.
4. Restauró en un `horus_restore_cierre_*` nuevo. Verificó recuentos, claves foráneas y todas las columnas/datos originales;
   los cubos efímeros de cuota se omiten deliberadamente por el contrato del backup.
5. Ejecutó `db:migrate` **solo en ese clon**, llegó a 18 migraciones y obtuvo `db:check` salida 0.
6. Confirmó tres tablas nuevas: `preinscripciones`, `preinscripciones_historial`, `convocatoria_horarios`;
   cambios DDL solamente en `convocatorias` y `matriculas`; mismos hashes y recuentos en todas las columnas originales.
   Las ediciones anteriores conservan mínimo NULL, recepción cerrada y código público NULL.
7. Confirmó ausencia de tabla/registro de Sesiones; repitió la migración y comprobó idempotencia exacta.
8. Respaldó el clon actualizado, verificó firma/contenido, restauró en otro destino nuevo del mismo servidor aislado,
   comprobó identidad de estructura/datos y `db:check` salida 0.
9. Comparó el origen otra vez: huellas inicial/final idénticas. Cerró conexiones y retiró únicamente el contenedor/volumen propios.

**Dos detenciones previas del arnés, sin defecto del backup confirmado:** la comparación inicial exigía identidad textual de
SHOW CREATE TABLE. Tras restaurar, MySQL de Linux explicita `CHARACTER SET utf8mb4` junto a `COLLATE utf8mb4_*`,
que el origen de Windows no imprimía. El primer intento detectó las diferencias; el segundo archivó ambos DDL para
diagnóstico. Todos los recuentos/hashes de datos ya coincidían, salvo las cuotas efímeras omitidas por diseño.
Se corrigió únicamente el comparador privado: normaliza esa cláusula redundante, conserva la colación exacta y compara
también tipo/default/nullabilidad/extra/charset/collation/expresión generada de cada columna en information_schema.
El tercer intento completo pasó. Se conservaron logs y scripts de los tres intentos; se limpiaron sus recursos propios.
No se modificaron los scripts de backup/restauración para obtener un resultado verde.

## Riesgos y preparación de la activación real

- La credencial configurada tiene privilegios globales amplios; [propuesta de separación](privilegios-mysql-propuesta.md)
  preparada, sin crear/revocar usuarios. El mínimo efectivo por tabla todavía requiere ensayo específico.
- Swagger sigue con cuota por proceso. **Mantenerlo deshabilitado públicamente** hasta decidir réplicas, proxy y configuración
  de producción; no se añade infraestructura de cuota compartida.
- H-03 protege concurrencia durante la petición, no todo formulario antiguo; H-04 no es una instantánea entre lotes ni reserva cupos.
- La ruta pública histórica de certificados se conserva deliberadamente. Retirarla requiere comprobar documentos emitidos en
  cada entorno. No se conectó Railway/Vercel para afirmar que no existan allí.
- Backup con ACL privada no equivale a cifrado/exportación externa ni a política de recuperación operativa terminada.

El ensayo deja el procedimiento preparado, **no autoriza activar**:

1. Acordar autorización, ventana y ausencia de escritores en el servidor/UUID/base exactos. No bastan las huellas de hoy.
2. Confirmar versión de código, origen y credenciales de mantenimiento; conservar sesión/plan de recuperación y la configuración previa.
3. Tomar **en esa ventana** un respaldo nuevo en directorio privado autorizado; verificar firma/manifiesto y restauración aislada.
   Respaldar uploads por separado si se requiere una recuperación integral de contenido.
4. Revisar `versions`/`retired` y `horus_migrations`: solo deben faltar Preinscripciones y Horarios; si difiere, detener y conciliar.
5. Solo entonces, con autorización de escritura vigente, ejecutar desde backend `npm run db:migrate` y `npm run db:check`.
6. Comparar esquema, migraciones, recuentos y datos originales; comprobar ausencia de Sesiones y flujos con la cuenta de aplicación.
   Un healthcheck solo confirma disponibilidad; no demuestra toda la funcionalidad.
7. Ante DDL parcial, detener: no asumir rollback de MySQL ni reintentar sin inspección. Los ALTER de Preinscripciones tienen
   recuperación probada, pero deben contrastarse las estructuras reales; usar una nueva restauración aislada para diagnosticar.
   No aplicar DROP ni una restauración encima de datos reales. La recuperación/promoción de una base exige decisión explícita.

## Publicación y autorizaciones pendientes en la revisión anterior

Propuesta histórica, **en aquella revisión no se ejecutó stage/commit/push**. La solicitud posterior autoriza estas
operaciones en `origin/anderson`; su resultado se documenta en [Entrega final](entrega-backend-20261023.md).

1. `refactor(backend): simplificar módulos académicos y añadir horarios recurrentes` — grupo A del inventario.
2. `fix(backend): consolidar seguridad y estabilidad H-01 a H-05` — grupo B, incluido el ajuste LF/CRLF de la prueba PDF.
3. `test(backend): validar H-04 en MySQL y documentar el cierre` — grupo C.

El índice inicial ya contiene borrados y un renombrado del grupo A. Preservarlo; antes de cualquier commit futuro comprobar
`git diff --cached --name-status` y revisar **ambas** diferencias (`HEAD → índice` e `índice → árbol`).
`backend/test/preinscripciones.integration.cjs` mezcla A previo y C de este cierre: el bloque H-04 y la selección de versión
pertenecen a C; los ajustes de simplificación existentes, a A. Usar selección de hunks revisados cuando se autorice stage,
sin `git add .`, y comprobar cada diff preparado antes de `git commit -m '<mensaje>'`.
No convertir el índice actual en un commit automático ni aplicar el parche antiguo.

Necesitan autorización posterior:

- Migraciones/escrituras en `horus_db`, bajo la ventana y comprobaciones anteriores.
- Crear usuarios reales, conceder/revocar privilegios, rotar/incrustar secretos o cambiar la credencial de ejecución.
- Preparar el índice y ejecutar los commits propuestos; push requiere autorización aparte.
- Reactivar CI o lanzar GitHub Actions; despliegues y configuración real de Railway/Vercel corresponden a una tarea posterior.
- Cualquier retirada de la verificación pública histórica de certificados requiere además comprobar su dependencia en todos los entornos.

Frontend, `.env`, CI, datos reales y permisos MySQL no se modificaron. Los ensayos autorizados ya terminaron;
no se necesita otra autorización para leer esta documentación o revisar el diff.

## Evidencia y conservación final

Evidencia privada en `%USERPROFILE%\.horus-respaldos\cierre-backend-20261023-1940\`:

- `backend-final-suite.log`, `regresiones-h01-h05.log`, `preinscripciones-84.log`, `preinscripciones-8046.log`,
  `horarios-84.log`, `horarios-8046.log`, `access-84.log`, `e36-ciclo-1.log`, `e36-ciclo-2.log`, `e36-adapter-timing.log`.
- `rehearsal-attempt3.log`, `attempt3/rehearsal-result.json`, `attempt3/source-before.json`, `attempt3/source-after.json`,
  `attempt3/clone-before.json`, `attempt3/clone-after.json`, logs de cada script y respaldos privados de origen/clon.
- Scripts de los intentos, inventario SHA-256 del respaldo independiente, `source-final-verification.json`
  y `final-preservation.json`. `evidence-index.json` registra tamaños y SHA-256 de los artefactos.

Comprobación final del origen: 27 tablas con los mismos recuentos, hashes de datos, DDL y metadatos de columnas que antes del ensayo.
Comprobación final de Git: rama/HEAD/stashes y **parche del índice exacto sin cambios**;
de las 106 rutas previas solo cambió el CJS de Preinscripciones autorizado. Se añadieron los tres documentos de este cierre.
El inventario comprende **109 rutas**, con 92 de A, 13 de B, una mixta A+C y tres de C.
Docker conserva exactamente los **11 IDs de contenedor y 117 volúmenes** iniciales, sin recursos propios sobrantes.

## Inventario de archivos frente a HEAD

El inventario siguiente separa el estado previo de los cambios de esta sesión. A = simplificación académica/Horarios;
B = H-01 a H-05; C = cierre actual. Es una asignación de revisión, no un stage ejecutado.

| Archivo | Grupo | Procedencia |
| --- | --- | --- |
| `AGENTS.md` | A | Cambio previo conservado |
| `backend/migrations/20261023-convocatoria-horarios.sql` | A | Cambio previo conservado |
| `backend/PRISMA.md` | A | Cambio previo conservado |
| `backend/prisma/schema.prisma` | A | Cambio previo conservado |
| `backend/scripts/check-database.cjs` | A | Cambio previo conservado |
| `backend/scripts/migrate.cjs` | A | Cambio previo conservado |
| `backend/src/admin/stats/stats.academic.ts` | A | Cambio previo conservado |
| `backend/src/admin/stats/stats.service.ts` | A | Cambio previo conservado |
| `backend/src/app.module.ts` | A | Cambio previo conservado |
| `backend/src/asistente/asistente.catalogo.ts` | A | Cambio previo conservado |
| `backend/src/asistente/asistente.consulta.service.ts` | A | Cambio previo conservado |
| `backend/src/asistente/asistente.consulta.ts` | A | Cambio previo conservado |
| `backend/src/asistente/asistente.data.ts` | A | Cambio previo conservado |
| `backend/src/asistente/asistente.rules.ts` | A | Cambio previo conservado |
| `backend/src/asistente/asistente.service.ts` | A | Cambio previo conservado |
| `backend/src/asistente/asistente.time.ts` | A | Cambio previo conservado |
| `backend/src/catalogo/catalogo.service.ts` | B | Cambio previo conservado |
| `backend/src/certificados/certificados.config.ts` | A | Eliminado antes de esta sesión |
| `backend/src/certificados/certificados.controller.ts` | A | Cambio previo conservado |
| `backend/src/certificados/certificados.dto.ts` | A | Eliminado antes de esta sesión |
| `backend/src/certificados/certificados.module.ts` | A | Cambio previo conservado |
| `backend/src/certificados/certificados.pdf.ts` | A | Eliminado antes de esta sesión |
| `backend/src/certificados/certificados.qr.ts` | A | Eliminado antes de esta sesión |
| `backend/src/certificados/certificados.rules.ts` | A | Cambio previo conservado |
| `backend/src/certificados/certificados.service.ts` | A | Cambio previo conservado |
| `backend/src/common/lima-time.ts` | A | Cambio previo conservado |
| `backend/src/common/pdf-format.ts` | A | Cambio previo conservado |
| `backend/src/common/security.ts` | B | Cambio previo conservado |
| `backend/src/cotizaciones/cotizaciones.pdf.ts` | A | Cambio previo conservado |
| `backend/src/docentes/asignaciones.service.ts` | A | Eliminado antes de esta sesión |
| `backend/src/docentes/docentes.controller.ts` | A | Eliminado antes de esta sesión |
| `backend/src/docentes/docentes.dto.ts` | A | Eliminado antes de esta sesión |
| `backend/src/docentes/docentes.history.ts` | A | Eliminado antes de esta sesión |
| `backend/src/docentes/docentes.module.ts` | A | Eliminado antes de esta sesión |
| `backend/src/docentes/docentes.rules.ts` | A | Eliminado antes de esta sesión |
| `backend/src/docentes/docentes.service.ts` | A | Eliminado antes de esta sesión |
| `backend/src/horarios/horarios.controller.ts` | A | Cambio previo conservado |
| `backend/src/horarios/horarios.dto.ts` | A | Cambio previo conservado |
| `backend/src/horarios/horarios.module.ts` | A | Cambio previo conservado |
| `backend/src/horarios/horarios.rules.ts` | A | Cambio previo conservado |
| `backend/src/horarios/horarios.service.ts` | A | Cambio previo conservado |
| `backend/src/permissions/permissions.ts` | A | Cambio previo conservado |
| `backend/src/permissions/policy.ts` | A | Cambio previo conservado |
| `backend/src/permissions/route-inventory.ts` | A | Cambio previo conservado |
| `backend/src/preinscripciones/preinscripciones-public.service.ts` | B | Cambio previo conservado |
| `backend/src/reportes/reportes.catalogo.ts` | A | Cambio previo conservado |
| `backend/src/reportes/reportes.dto.ts` | A | Cambio previo conservado |
| `backend/src/reportes/reportes.service.ts` | A | Cambio previo conservado |
| `backend/src/reportes/reportes.types.ts` | A | Cambio previo conservado |
| `backend/src/sesiones/sesiones.controller.ts` | A | Eliminado antes de esta sesión |
| `backend/src/sesiones/sesiones.dto.ts` | A | Eliminado antes de esta sesión |
| `backend/src/sesiones/sesiones.history.ts` | A | Eliminado antes de esta sesión |
| `backend/src/sesiones/sesiones.module.ts` | A | Eliminado antes de esta sesión |
| `backend/src/sesiones/sesiones.rules.ts` | A | Eliminado antes de esta sesión |
| `backend/src/sesiones/sesiones.service.ts` | A | Eliminado antes de esta sesión |
| `backend/src/sesiones/sesiones.time.ts` | A | Eliminado antes de esta sesión |
| `backend/test/academico-schema.integration.cjs` | A | Cambio previo conservado |
| `backend/test/access-guard-http.integration.cjs` | A | Cambio previo conservado |
| `backend/test/asistente-consulta.test.ts` | A | Cambio previo conservado |
| `backend/test/asistente-fidelidad.test.ts` | A | Cambio previo conservado |
| `backend/test/asistente-resumen-cierre.test.ts` | A | Cambio previo conservado |
| `backend/test/asistente.test.ts` | A | Cambio previo conservado |
| `backend/test/catalogo-concurrency.integration.cjs` | B | Cambio previo conservado |
| `backend/test/catalogo-concurrency.test.ts` | B | Cambio previo conservado |
| `backend/test/certificados-pdf.test.ts` | A | Eliminado antes de esta sesión |
| `backend/test/certificados-verificacion.test.ts` | A | Cambio previo conservado |
| `backend/test/certificados.test.ts` | A | Cambio previo conservado |
| `backend/test/cotizaciones-pdf.test.ts` | B | Cambio previo conservado |
| `backend/test/docentes.integration.cjs` | A | Cambio previo conservado |
| `backend/test/docentes.test.ts` | A | Eliminado antes de esta sesión |
| `backend/test/horarios.integration.cjs` | A | Cambio previo conservado |
| `backend/test/horarios.test.ts` | A | Cambio previo conservado |
| `backend/test/institutional-fixes.test.ts` | B | Cambio previo conservado |
| `backend/test/lima-time.test.ts` | A | Cambio previo conservado |
| `backend/test/migrations.test.ts` | A | Cambio previo conservado |
| `backend/test/original-content.test.ts` | B | Cambio previo conservado |
| `backend/test/permissions.test.ts` | A | Cambio previo conservado |
| `backend/test/preinscripciones-editions.test.ts` | B | Cambio previo conservado |
| `backend/test/preinscripciones.integration.cjs` | A + C | Simplificación previa más prueba H-04 y versión MySQL |
| `backend/test/reportes-comerciales.test.ts` | A | Cambio previo conservado |
| `backend/test/reportes.integration.cjs` | A | Cambio previo conservado |
| `backend/test/reportes.test.ts` | A | Cambio previo conservado |
| `backend/test/run-academic-isolated.cjs` | A | Cambio previo conservado |
| `backend/test/run-catalogo-isolated.cjs` | B | Cambio previo conservado |
| `backend/test/security-headers.test.ts` | B | Cambio previo conservado |
| `backend/test/sesiones.integration.cjs` | A | Eliminado antes de esta sesión |
| `backend/test/sesiones.test.ts` | A | Eliminado antes de esta sesión |
| `backend/test/stats-academic.test.ts` | A | Cambio previo conservado |
| `docs/procedimientos/activacion-docentes-mysql-real.md` | A | Cambio previo conservado |
| `docs/procedimientos/activacion-sesiones-preinscripciones-ensayo.md` | A | Cambio previo conservado |
| `docs/procedimientos/certificados.md` | A | Cambio previo conservado |
| `docs/procedimientos/ci.md` | A | Cambio previo conservado |
| `docs/procedimientos/cierre-backend-20261023.md` | C | Nuevo en esta sesión |
| `docs/procedimientos/contrato-react-backend-consolidado.md` | C | Nuevo en esta sesión |
| `docs/procedimientos/estabilizacion-backend-h01-h07.md` | B | Cambio previo conservado |
| `docs/procedimientos/gestion-docentes.md` | A | Cambio previo conservado |
| `docs/procedimientos/gestion-ediciones.md` | A | Cambio previo conservado |
| `docs/procedimientos/gestion-preinscripciones.md` | A | Cambio previo conservado |
| `docs/procedimientos/guia-demostracion-sustentacion.md` | A | Cambio previo conservado |
| `docs/procedimientos/guia-frontend-verificacion-certificados.md` | A | Cambio previo conservado |
| `docs/procedimientos/horarios-ediciones.md` | A | Cambio previo conservado |
| `docs/procedimientos/horarios-sesiones-academicas.md` | A | Cambio previo conservado |
| `docs/procedimientos/horus-assistant.md` | A | Cambio previo conservado |
| `docs/procedimientos/privilegios-mysql-propuesta.md` | C | Nuevo en esta sesión |
| `docs/procedimientos/reportes-academicos.md` | A | Cambio previo conservado |
| `docs/procedimientos/reportes-certificacion.md` | A | Cambio previo conservado |
| `docs/procedimientos/resumen-operativo-academico.md` | A | Cambio previo conservado |
| `docs/procedimientos/validacion-final-h01-h05.md` | B | Cambio previo conservado |
| `RAILWAY.md` | A | Cambio previo conservado |
