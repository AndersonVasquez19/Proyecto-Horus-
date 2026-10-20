# Importación académica desde CSV (fase 4)

Ruta: `/admin/dashboard?section=importacion-excel`. Implementación React/NestJS/Prisma; Laravel permanece congelado.

## Uso

1. En Excel, prepara una hoja con **solo estudiantes**, sin docentes ni ponentes. Exporta CSV conservando el DNI como texto; no completes documentos de siete dígitos con ceros supuestos.
2. Selecciona el archivo y una edición existente, abierta, sin archivar y con capacidad definida. El módulo no infiere destinos, crea cursos ni abre ediciones.
3. Revisa la fila de encabezados (hasta la 20), codificación y mapeo. DNI, nombres y apellidos son columnas separadas obligatorias. Un nombre completo ambiguo debe separarse manualmente antes de exportar.
4. Genera la vista previa. No crea estudiantes, matrículas, operaciones ni historial. Revisa errores, advertencias, cupos y resumen.
5. Gerencia abre la confirmación y marca que revisó las filas y excluyó docentes/ponentes. Se importan todas las filas aceptables en una sola transacción. Las rechazadas y omitidas permanecen fuera del lote.
6. Consulta el resumen final y el historial de cada matrícula. Ante pérdida de respuesta usa **Consultar resultado** antes de iniciar otra vista previa. No hay reintento automático.

## Formatos y límites reales

CSV separado por coma, punto y coma o tabulación; UTF-8 con/sin BOM, UTF-16LE con BOM o Windows-1252. Detección automática y selección manual de codificación. Admite comillas escapadas y saltos de línea en campos entrecomillados.

Máximo **48 KiB**, **200 filas de datos**, **40 columnas**, **1000 caracteres por celda** y hasta 20 filas anteriores/incluida la cabecera. El cuerpo JSON transporta el archivo en base64 (máximo 65536 caracteres), dentro del límite HTTP existente. No se amplía el parser global. Cada petición contiene un archivo y una edición.

**XLSX no está soportado:** no hay un lector XLSX instalado en los paquetes Node y no se autorizó instalar dependencias. Se rechazan XLSX/XLS/XLSM y firmas ZIP/OLE incluso con extensión CSV. No se descomprimen archivos; una bomba ZIP no entra al parser. Para añadir XLSX habrá que aprobar una dependencia, revisar sus límites ZIP/memoria y probar libros corruptos, fórmulas y macros.

No se encontró `CURSOS 2024.xlsx` en la búsqueda por nombre dentro de Documents. Se consultó únicamente la documentación Laravel como referencia funcional; no se ejecutó Laravel ni se importaron datos institucionales. Los fixtures son ficticios.

## Validación y decisiones

- DNI: exactamente ocho dígitos ASCII, sin recortar espacios ni completar ceros. Se conserva como cadena.
- Nombres, apellidos, correo y teléfono reutilizan `CreateEstudianteDto` y su normalización y límites. La vista previa nunca sobrescribe registros.
- Todos los DNI repetidos dentro del archivo se rechazan; no se elige silenciosamente una fila.
- Estudiante existente: conserva ID y todos sus datos; diferencias generan advertencia. Archivado: se rechaza.
- Matrícula existente activa o anulada: se omite; nunca se reactiva durante la importación.
- Si se mapea tipo de persona, solo acepta estudiante/alumno/participante. Se rechazan filas con indicadores docente/ponente/instructor/expositor. Un archivo sin indicadores no permite demostrar la función de cada persona: la revisión humana y el consentimiento son obligatorios.
- Columnas de notas, pagos, asistencia, estado, certificados y cumplimiento no pueden mapearse como datos de estudiante. No se interpretan ni crean esas entidades.
- Fórmulas en datos: se rechaza la fila; texto activo en encabezados, binarios, contenido HTML/PDF, comillas corruptas, archivos vacíos o límites excedidos: rechazo de la petición. Los valores se muestran como texto escapado por React.
- Cupos insuficientes bloquean todo el lote aceptable; no se seleccionan filas arbitrarias para llenar el cupo.

## API y permisos

Todas las rutas llevan JWT y un decorador comprobado por AccessGuard e inventario manual. Se reutilizan permisos existentes, sin cambiar roles ni matriz.

| Método y ruta bajo `/api/admin/importaciones` | Permiso | Efecto |
| --- | --- | --- |
| `GET /ediciones?page=1&limit=20&search=…` | `importaciones:previsualizar` | Selector paginado con cupos |
| `POST /archivo` | `importaciones:previsualizar` | Lee CSV, detecta cabecera/columnas y devuelve muestra |
| `POST /vista-previa` | `importaciones:previsualizar` | Valida mapeo, filas, duplicados y cupos; firma comprobante |
| `POST /confirmacion` | `importaciones:aplicar` | Exige `confirmar: true`, archivo/configuración original y comprobante |
| `GET /resultado/:id` | `importaciones:previsualizar` | Recupera recuentos de operación confirmada tras resultado incierto |

Gerencia puede previsualizar y aplicar; Coordinación solo previsualiza; Secretaría y cuenta básica reciben 403; sin sesión, 401. La confirmación vuelve a comprobar cuenta activa y permisos de crear estudiantes/matrículas.

`POST /archivo`: `{ nombre, mime, contenido }` (base64). Vista previa añade `convocatoria_id`, `encabezado` (base 1), `codificacion` y `mapeo` (índices base 0: `doc_numero`, `nombres`, `apellidos`, opcionalmente `email`, `telefono`, `tipo_persona`). Confirmación añade `confirmar` y `comprobante`. Se rechazan campos no declarados y valores nulos del mapeo.

## Integridad y trazabilidad

La vista previa usa una transacción REPEATABLE READ exclusivamente de lectura. El comprobante HMAC-SHA256 usa `JWT_SECRET` con separación de propósito, vence en 15 minutos y vincula actor, archivo, configuración, destino y hash del estado académico. No contiene datos personales; no se persiste la previsualización.

La confirmación reenvía y revalida el archivo. Ejecuta una transacción READ COMMITTED, máximo 30 s (espera de conexión 5 s), con bloqueo curso → edición → estudiantes existentes ordenados por ID → matrículas. Reutiliza `EstudiantesService.createInTransaction` y `MatriculasService.createInTransaction`; este último es también el camino del alta manual, con las mismas reglas de capacidad e historial. No hay transacciones anidadas. UNIQUE resuelve las carreras por DNI ausente en otros destinos; cualquier conflicto revierte estudiantes, matrículas, historial y operación.

El estado se compara después de adquirir bloqueos; cambios de edición, estudiante, matrícula o cupos desde la vista previa responden 409. La unicidad persistente `(archivo_sha256, convocatoria_id)` impide repetir accidentalmente el mismo archivo y destino, aunque cambie mapeo o usuario. El identificador UUID de operación también es único. Cambiar el archivo evita esa barrera pero sigue sujeto a los duplicados DNI/matrícula.

La operación guarda UUID, hash de bytes, destino, actor, estado `confirmada`, fecha y recuentos. No almacena archivo, nombre, DNI, correo ni contenidos de filas. El historial de cada matrícula referencia la operación en `motivo`, junto con actor y rol en la misma transacción. Los resultados detallados por fila se devuelven en la confirmación y viven solo en la pantalla; la recuperación posterior devuelve recuentos. No hay historial persistente de intentos fallidos ni de previsualizaciones.

No se escriben archivos temporales: procesamiento privado en memoria, con los límites anteriores; ningún CSV va a uploads públicos. No se registran contenidos ni excepciones Prisma con parámetros personales. El archivo y la vista previa se liberan al salir del componente, sin storage del navegador.

## Migraciones y activación pendiente

Requiere `20261018-convocatorias-capacidad` y la nueva `20261019-importaciones-academicas`, registrada al final de `backend/scripts/migrate.cjs`. Esta última solo crea `importaciones_academicas`, con claves foráneas RESTRICT hacia edición y actor, unicidad y CHECK de recuentos. Es aditiva e idempotente. `db:check` exige su estructura. **No se ejecutaron en horus_db, horus_local ni horus_group.**

Siguiente paso operativo: autorizar un destino concreto, verificarlo y preparar respaldo; aplicar las migraciones pendientes antes de habilitar el módulo. No usar el Excel real hasta aprobar su limpieza, separar estudiantes/docentes y seleccionar explícitamente sus ediciones.

## Verificación reproducible

Desde `backend/`:

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm test
npm run build
node test/run-importaciones-disposable.cjs
```

El último comando crea un MySQL 8.4 **nuevo por suite**, verifica versión y UUID, usa datos ficticios, ejecuta importación, Matrículas, Ediciones, Estudiantes y AccessGuard y retira únicamente cada contenedor/volumen propio. No usa Compose ni contenedores existentes. Requiere Docker y la imagen local `mysql:8.4`. Para incluir navegador real:

```powershell
$env:IMPORTACIONES_BROWSER = 'true'
node test/run-importaciones-disposable.cjs importaciones.integration.cjs
Remove-Item Env:IMPORTACIONES_BROWSER
```

Desde `frontend/`, con backend compilado y frontend recién compilado:

```powershell
npm run check
npm run lint
npm run build
node --experimental-strip-types --test tests/*.test.mjs
node scripts/smoke-importaciones.cjs
```

El smoke normal usa API simulada; el smoke real solo acepta destino/credenciales por IPC del test desechable. Se bloquean peticiones externas antes de enviarlas y se limpia el perfil propio de Edge. Capturas ficticias en `frontend/.artifacts/importaciones/` (ignoradas por Git): escritorio y móvil, con prefijo `real-` para React ↔ NestJS ↔ MySQL. No equivalen a despliegue ni validación de datos reales.

## Evidencia inicial del 19 de octubre de 2026 (Node 24)

| Comprobación ejecutada | Resultado |
| --- | --- |
| Suite backend, con aislamiento de entorno | 436/436 |
| Suite frontend, incluidos permisos/importación | 119/119 |
| Importación HTTP/MySQL + Edge real | 15/15 |
| Regresión real Matrículas | 15/15 |
| Regresión real Ediciones | 10/10 |
| Regresión real Estudiantes | 8/8 |
| AccessGuard real y ciclo de vida | 28/28 |
| Esquema académico, migraciones parciales, restricciones y backup/restauración | 20/20 |
| TypeScript backend/frontend, ESLint frontend y ambos builds | Correctos |
| Smokes Home, chatbot y autenticación, con API simulada y peticiones externas bloqueadas | Correctos |

La integración de importación prueba un usuario MySQL con **solo SELECT** (además demuestra que INSERT está denegado), confirmación obligatoria, rechazo de comprobantes/archivos alterados, doble confirmación, reimportación, cupos concurrentes, omisión de matrículas anuladas, rollback tras el fallo del historial de la **segunda** fila y un lote completo de **200** filas. No se crean temporales; se comprueba que la carpeta de trabajo sigue vacía.

Se corrigieron durante la validación: puerto 0 inválido del montaje HTTP, configuración heredada que interfería con el usuario SELECT del test, escape de texto y selector del smoke, documentación obligatoria de la migración y expectativas históricas del test estructural ante la nueva tabla. No se desactivaron pruebas ni se redujeron permisos.

Entorno local: **Node 24.19.0**. Los paquetes exigen Node 22.x; esta evidencia no sustituye una ejecución en Node 22/CI. No hubo commit, push, despliegue ni importación de datos institucionales. Los contenedores/volúmenes desechables propios fueron retirados; los contenedores existentes no se reiniciaron ni modificaron.

## Archivos del cambio

15 archivos nuevos y 19 modificados al cerrar la entrega, incluidas las pruebas de importación en CI y la actualización del menú esperado en el smoke de permisos. Rama `anderson`, base revisada `60270be2c745c0b795969b2c1387ef74b35c1c7c`. Se excluyen diagramas, capturas y artefactos locales.

| Zona | Nuevos | Modificados |
| --- | --- | --- |
| Backend: importación | `src/importaciones/csv.ts`, `importaciones.dto.ts`, `importaciones.controller.ts`, `importaciones.service.ts`, `importaciones.module.ts` | `src/app.module.ts` |
| Backend: persistencia | `migrations/20261019-importaciones-academicas.sql` | `prisma/schema.prisma`, `scripts/migrate.cjs`, `scripts/check-database.cjs`, `src/estudiantes/estudiantes.service.ts`, `src/matriculas/matriculas.service.ts` |
| Backend: acceso y pruebas | `test/importaciones.test.ts`, `test/importaciones.integration.cjs`, `test/run-importaciones-disposable.cjs` | `src/permissions/permissions.ts`, `src/permissions/route-inventory.ts`, `test/permissions.test.ts`, `test/access-guard-http.integration.cjs`, `test/academico-schema.integration.cjs` |
| Frontend | `src/panel/components/PanelImportations.tsx`, `src/panel/components/importations.css`, `src/panel/services/importations.ts`, `tests/importations.test.mjs`, `scripts/smoke-importaciones.cjs` | `.gitignore`, `src/panel/context/panelAccess.ts`, `src/panel/pages/AdminDashboard.tsx`, `tests/panel-access.test.mjs`, `scripts/smoke-panel-access.cjs` |
| Documentación | Este procedimiento | `RAILWAY.md`, `backend/PRISMA.md` |
| CI | — | `.github/workflows/ci.yml` (pruebas de importación frontend e integración HTTP/MySQL) |

El ejecutor desechable exige una imagen `mysql:8.4` ya disponible, contrasta el UUID conectado con `docker exec` y verifica nombre, imagen y etiqueta antes de retirar cada contenedor propio. No modifica Compose ni los contenedores habituales. Para ejecutar además la integración general de Prisma y el esquema académico:

```powershell
node test/run-importaciones-disposable.cjs academico-schema.integration.cjs prisma.integration.cjs
```

## Revalidación de cierre con Node 22

El 19 de octubre de 2026 se repitieron las comprobaciones con **Node 22.23.3**, ya disponible localmente, sin instalar dependencias:

| Comprobación | Resultado |
| --- | --- |
| Backend completo y frontend completo | 436/436 y 119/119 |
| Importación HTTP/MySQL y Edge real | 16/16 |
| Matrículas, Ediciones y Estudiantes sobre MySQL desechable | 15/15, 10/10 y 8/8 |
| AccessGuard HTTP y ciclo de vida | 28/28 |
| Esquema, migraciones parciales y backup/restauración | 20/20 |
| Integración general Prisma/HTTP/MySQL | 19/19 |
| TypeScript de ambos paquetes, ESLint frontend y ambos builds | Correctos |
| Smokes simulados: importación, web pública, chatbot, autenticación y navegación por permisos | Correctos |
| Sintaxis de scripts, YAML de CI y `git diff --check` | Correctos |

La nueva comprobación de migración carga datos académicos ficticios con capacidad ya aplicada y demuestra que aplicar importaciones dos veces conserva íntegramente esos registros y deja el registro de operaciones vacío. Los siete contenedores propios de las siete suites se retiraron al finalizar.

El smoke de navegación falló inicialmente en seis comparaciones de menú y volvió a fallar al repetirlo solo: su lista esperada no incluía la nueva sección. Se actualizó esa lista y el permiso de lectura de importaciones en su control de solicitudes; la repetición completa pasó. No se cambió la matriz de roles, AccessGuard ni las comprobaciones de acceso denegado.

CI incorpora las pruebas nuevas de importación frontend y HTTP/MySQL. El navegador real se verificó localmente; no se añade al job automático. Los resultados remotos se informan con el SHA publicado. Esta publicación de código no activa las migraciones ni valida datos institucionales.

Pendiente para la activación: autorización y verificación del destino definitivo, respaldo y aplicación ordenada de `20261018-convocatorias-capacidad` → `20261019-importaciones-academicas`. Durante el cierre no se conectó a `horus_db`, `horus_local` ni `horus_group`, ni se modificaron Laravel, SQLite, Docker o archivos de entorno. La preservación de datos se comprobó con fixtures desechables; no se realizó una comparación de las bases habituales.
