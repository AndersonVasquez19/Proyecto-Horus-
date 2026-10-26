# Preparación de la activación académica en horus_db

Fecha: 19 de octubre de 2026, America/Lima. Alcance: Estudiantes, Ediciones, Matrículas e Importación CSV de NestJS/React. Este informe documenta un ensayo; **no autoriza ni ejecuta la activación real**.

## 1. Estado inicial y destino

Se leyeron `AGENTS.md`, `CLAUDE.md`, los contratos académicos y los ejecutores de migración, respaldo y restauración.

| Comprobación | Evidencia |
| --- | --- |
| Rama / HEAD | `anderson` / `6994691011d7e27fc11c0934d05094ab580f0b46` |
| Git inicial | Limpio, incluidos archivos sin seguimiento |
| Configuración efectiva de los scripts | `127.0.0.1:3306`, base `horus_db`; sin imprimir usuario, contraseña, claves ni tokens |
| Servidor | MySQL `8.0.46`, UUID `dc5bb32a-a7b2-11f1-913f-14b5cd19372a` |
| Cuenta 14 | Activa, `GERENTE_GENERAL` |
| Motor | Las 24 tablas son InnoDB |
| Migraciones registradas | 13, hasta `20261016-academico-solo-dni` |
| Pendientes | Exclusivamente `20261018-convocatorias-capacidad` y `20261019-importaciones-academicas` |

Las inspecciones de datos usaron transacciones `READ ONLY`. `npm run db:check` también se ejecutó: terminó con código 1 y 17 diferencias, todas correspondientes a las dos migraciones pendientes. No aparecieron discrepancias adicionales de cuentas, roles, auditoría ni del esquema anterior.

| Registros iniciales | Cantidad |
| --- | ---: |
| Cuentas / auditoría administrativa | 14 / 14 |
| Cursos / servicios | 5 / 20 |
| Galería / convenios / fotos de convenios | 61 / 4 / 2 |
| Ajustes institucionales | 10 |
| Estudiantes / ediciones / matrículas / certificados / historial académico | 0 / 0 / 0 / 0 / 0 |
| Historial de migraciones | 13 |

Las demás tablas persistentes estaban vacías. `rate_limit_buckets` tenía dos filas efímeras; el respaldo normal omite sus datos por diseño.

No se hicieron peticiones HTTP contra la aplicación habitual: el limitador público puede escribir cuotas incluso al consultar contenido. Las pruebas HTTP y de navegador se dirigieron a APIs temporales. No se verificó de nuevo ngrok ni la configuración interna de procesos web ya iniciados.

## 2. Respaldos y restauración

### Copia anterior

Archivo local: `backend/.backups/horus-horus_db-20261019-184100.sql.gz`.

SHA-256: `0d4ff4dc818dfffe4eab3837e309573adcd271b951b2d61dcc5d76b7a867a4e5`.

Se comprobó firma, lectura comprimida y sentencias admitidas; se restauró íntegramente en `horus_restore_old_136a2f56f9b04c26`: 24 tablas y 12 claves foráneas, una compuesta, sin huérfanos.

**Esta copia es anterior a la preparación de roles:** recupera la cuenta 14 con `rol=NULL` y cero filas de auditoría. Aunque restaura correctamente, no sirve como punto de recuperación del estado actual de permisos.

### Copia nueva del estado actual

Se creó mediante el ejecutor de respaldo, cuya transacción es de solo lectura:

- Base: `backend/.backups/horus-horus_db-20261019-195808.sql.gz`.
- SHA-256: `743f5669fb3f212fe6a67d663ee8c13e6a958a587036ac5b8bcec42a9b97475d`.
- Manifiesto y firma adyacentes: 24 tablas, 143 filas persistentes, MySQL 8.0.46, base `utf8mb4_0900_ai_ci`.
- Archivos: `backend/.backups/uploads-20261019-195809`, 35 archivos, 17 588 756 bytes; cero omitidos o desaparecidos.

La nueva copia se restauró en `horus_restore_activation_136a2f56f9b04c26`. El ejecutor verificó los recuentos de las 24 tablas y las 12 claves foráneas. Se compararon además todos los registros de las 23 tablas persistentes mediante huellas SHA-256, DDL y metadatos de columnas: coincidieron con la base de origen. Las cuotas efímeras quedaron vacías, como indica el manifiesto.

`SHOW CREATE TABLE` puede explicitar `CHARACTER SET utf8mb4` al recrear columnas; se normalizó esa representación redundante y se contrastaron también tipo, nulabilidad, valor por defecto, charset, colación y expresión generada de cada columna. No se convirtió ninguna colación.

Se restauraron los 35 archivos en una carpeta temporal y se verificó su identidad. Los respaldos permanecen locales e ignorados por Git. Contienen datos personales y hashes de contraseñas: no adjuntarlos al informe ni publicarlos. No se ejecutó su cifrado ni su traslado a una custodia externa; aplicar el procedimiento de [respaldo y restauración](backup-restauracion.md) antes de transportarlos.

## 3. Ensayo de migraciones y recuperación

La descarga del contenedor `mysql:8.0.46` falló dos veces por timeout del registro. Se utilizó el ejecutable MySQL 8.0.46 ya instalado para crear **otra instancia**, sin instalar servicios ni leer la configuración habitual:

- `--no-defaults`, directorio de datos temporal exclusivo y escucha en `127.0.0.1:58789`.
- UUID `b94a764e-cbf7-11f1-9a59-00155de03e71`, distinto del servidor habitual.
- Puerto, UUID, versión, directorio y PID comprobados antes de operar o limpiar.
- Credenciales temporales generadas; configuración de los hijos por entorno explícito, sin heredar las credenciales de correo/IA del proyecto.

En el clon nuevo se ejecutó el **mismo** `scripts/migrate.cjs` de la activación prevista:

1. `20261018-convocatorias-capacidad`: añade `capacidad INT NULL` y un CHECK que admite NULL o enteros positivos. Conserva filas anteriores sin inventar cupos.
2. `20261019-importaciones-academicas`: crea la tabla de operaciones, PK, UNIQUE archivo/destino, dos FK restrictivas e integridad de conteos. No modifica cuentas ni roles.

Resultado: código 0, aproximadamente **0,553 s** para el ejecutor completo en este clon vacío de datos académicos. `db:check` aprobado; 15 migraciones registradas. Repetir el ejecutor completo terminó con 0 sin cambios porque ambas versiones ya estaban registradas.

Se conservaron todos los registros anteriores. Las cuentas, sus contraseñas almacenadas, roles y auditoría mantuvieron sus huellas; el DDL anterior se conservó salvo la ampliación prevista de `convocatorias`. La nueva tabla quedó vacía antes de las pruebas ficticias. Se comprobaron los 18 CHECK activos y los índices/FK mediante el validador.

En transacciones del clon se demostraron rechazos reales de MySQL para capacidad cero, conteos inválidos, actor inexistente, edición inexistente y archivo/destino repetidos. Las transacciones de esas sondas terminaron en rollback.

### Fallo parcial reproducido

En una cuarta copia temporal se aplicó solamente el ALTER de capacidad, sin registrar su versión. El posterior `db:migrate` terminó con código 1, conservando ese estado: el ALTER no admite repetirse si la columna ya existe. **No repetir una migración fallida a ciegas.** El DDL hace commit implícito; no existe rollback global de las dos migraciones. Hay que contrastar primero `horus_migrations`, columna, CHECK y tabla de importaciones. `CREATE TABLE IF NOT EXISTS` tampoco corrige una tabla con estructura incorrecta.

### Recuperación demostrada

Después del ensayo se volvió a restaurar el respaldo nuevo en `horus_restore_recovery_136a2f56f9b04c26`: 24 tablas, recuentos correctos, 12 FK sin huérfanos y coincidencia de datos y estructura con el clon **anterior** a migrar. Cuenta 14 activa con `GERENTE_GENERAL`.

Esto demuestra recuperación del estado respaldado en una base nueva. No se ensayó sobrescritura, intercambio ni promoción sobre `horus_db`. El ejecutor de restauración rechaza una base con tablas y no restaura sobre la base habitual.

## 4. Pruebas académicas

### API real sobre el clon de los datos actuales, MySQL 8.0.46

El AppModule compilado arrancó en un proceso temporal con `PublicRateLimitGuard → AccessGuard`. Se añadieron exclusivamente cuentas y datos ficticios al clon; no se cambió la cuenta 14.

Se comprobaron:

- Login de gerencia, coordinación, secretaría y cuenta básica ficticias; rol y contrato de sesión.
- Alta y búsqueda de estudiantes, conservando DNI con ceros iniciales.
- Creación/apertura de edición, edición de capacidad y cierre.
- Matrícula, cupo lleno con 409, anulación, reactivación y tres entradas de historial.
- Capacidad NULL: alta y confirmación de CSV bloqueadas con 409.
- Vista previa CSV: mismos recuentos de estudiantes, matrículas, operaciones e historial antes y después.
- Confirmación atómica, consulta del resultado, vínculo al historial y repetición rechazada con 409.
- 401 sin sesión; 403 de cuenta básica y restricciones de secretaría/coordinación.
- Preservación de cuentas originales, auditoría y contenido previo después de las pruebas.

No se usó la contraseña real de la cuenta 14; su rol se verificó por SQL y se comparó el registro íntegro por huella. El login se ejerció con cuentas ficticias del clon.

### Regresión desechable y navegador

Las suites versionadas se ejecutaron en servidores MySQL 8.4 propios, con UUID verificado, nombres temporales y retirada de sus contenedores. Esta evidencia complementa el clon de MySQL 8.0.46; sus fixtures no representan datos institucionales.

| Comprobación | Resultado |
| --- | --- |
| Backend: TypeScript, `npm test`, build | Aprobados; **436/436** pruebas, sin omitidas |
| Frontend: `check`, ESLint, build, pruebas puras | Aprobados; **119/119** pruebas, sin omitidas |
| Importaciones, HTTP y navegador real escritorio/móvil | **16/16**, incluida vista previa con usuario MySQL SELECT, concurrencia, rollback y lote de 200 |
| Matrículas, HTTP MySQL 8.4 | **15/15** |
| Ediciones, HTTP MySQL 8.4 | **10/10**, incluida conservación de una edición previa con capacidad NULL |
| Estudiantes, HTTP MySQL 8.4 | **8/8** |
| Estudiantes con React ↔ API ↔ MySQL y Edge | **8/8**, incluye escritorio y móvil |
| Ediciones con React ↔ API ↔ MySQL y Edge | **11/11**, incluye escritorio y móvil |
| Matrículas con React ↔ API ↔ MySQL y Edge | **16/16**, incluye escritorio y móvil |
| AccessGuard, barrido HTTP de roles | **28/28**; 404 solicitudes, 101 por rol, más comprobaciones de login y ciclo de vida |

Las comprobaciones locales usaron Node **24.19.0**. El proyecto exige Node 22: se verificó por separado la [CI del mismo commit](https://github.com/Castope/Proyecto-Horus-/actions/runs/39298645624), con jobs Backend, Frontend e Integración aprobados y configuración Node 22. El job manual de smokes de CI está omitido; los navegadores aquí descritos son evidencia local.

Los primeros intentos del arnés temporal requirieron corregir la comparación de metadatos y seleccionar un puerto válido mayor que cero. La limpieza comprobó además el proceso hijo de `mysqld` en Windows, cuyo PID difiere del proceso lanzador. No se modificaron pruebas versionadas, validadores ni código de aplicación para obtener los resultados.

## 5. Contenido público

En la API del clon migrado, antes de insertar cursos ficticios, se contrastó cada lista pública con los registros visibles de MySQL:

| Recurso | HTTP / registros visibles |
| --- | --- |
| Cursos | 200 / 5 |
| Servicios | 200 / 19; el servicio restante sigue fuera del listado publicado |
| Galería | 200 / 61 |
| Convenios | 200 / 4 |
| Preguntas frecuentes | 200 / 0 |
| Ajustes institucionales | 200 |
| Imágenes de uploads referenciadas por esas respuestas | 24/24: HTTP 200, tipo imagen y hash idéntico al archivo restaurado |
| Chatbot | 200, modo catálogo, cinco fuentes; IA externa desactivada |

Se cargó React con esa API real y el contenido restaurado en Edge, 1365 y 390 px: Home adaptable, catálogo consultado, ajustes institucionales, página Quiénes somos e imágenes locales cargadas. Sin excepciones JavaScript ni solicitudes externas enviadas.

El primer arnés de imágenes marcó un fallo porque inspeccionaba un retrato `loading="lazy"` situado fuera de pantalla. Se reprodujo y diagnosticó; tras recorrer la página y esperar cada imagen, pasó en ambos tamaños. No se cambió el frontend ni se ocultó un recurso roto.

No se probaron correo real, IA externa ni publicación por ngrok. Ninguna prueba envió correo.

## 6. Plan exacto para una activación posterior

**Esta sección no se ejecutó contra horus_db. Hace falta la orden posterior de activación.**

### Condiciones previas y comprobación del servidor

1. Acordar una ventana de mantenimiento y detener escrituras: panel, formularios públicos, chatbot y cualquier otro escritor de esta base. No basta con cerrar una pestaña del panel.
2. Comprobar rama, HEAD y estado Git; si cambia el código o el esquema/destino respecto a este ensayo, revisar las diferencias antes de continuar.
3. Usar el runtime Node 22 previsto. No instalar herramientas ni modificar `.env` como parte de esta secuencia.
4. Desde `backend/`, verificar configuración efectiva y UUID con esta sonda de lectura. No imprimir el entorno completo:

```powershell
Set-Location 'C:\Users\PCT40T\Documents\Proyecto-Horus-\backend'
$academicPreflight = @'
const assert = require('node:assert/strict');
const { connect, options } = require('./scripts/database.cjs');
const { versions } = require('./scripts/migrate.cjs');
(async () => {
  const o = options();
  assert.equal(o.host, '127.0.0.1');
  assert.equal(o.port, 3306);
  assert.equal(o.database, 'horus_db');
  const c = await connect();
  try {
    await c.query('START TRANSACTION READ ONLY');
    const [[s]] = await c.query('SELECT DATABASE() db, @@server_uuid uuid, VERSION() version');
    assert.equal(s.db, 'horus_db');
    assert.equal(s.uuid, 'dc5bb32a-a7b2-11f1-913f-14b5cd19372a');
    assert.equal(s.version, '8.0.46');
    const [[a]] = await c.query('SELECT activo, rol FROM admin_users WHERE id=14');
    assert.equal(a.activo, 1);
    assert.equal(a.rol, 'GERENTE_GENERAL');
    const [applied] = await c.query('SELECT name FROM horus_migrations');
    const names = new Set(applied.map(r => r.name));
    const pending = versions.filter(v => !names.has(v));
    assert.deepEqual(pending, ['20261018-convocatorias-capacidad', '20261019-importaciones-academicas']);
    const [[shape]] = await c.query("SELECT (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='convocatorias' AND COLUMN_NAME='capacidad') capacityColumns, (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='importaciones_academicas') importTables");
    assert.equal(Number(shape.capacityColumns), 0);
    assert.equal(Number(shape.importTables), 0);
    console.log(JSON.stringify({ ...s, cuenta14: 'activa/GERENTE_GENERAL', pendientes: pending }));
    await c.rollback();
  } finally { await c.end(); }
})().catch(() => { console.error('Preflight falló; detener la activación.'); process.exitCode = 1; });
'@
$academicPreflight | node
if ($LASTEXITCODE -ne 0) { throw 'Destino, cuenta, versiones o estado parcial inesperados.' }
npm run db:check
# Antes de migrar, se espera únicamente el conjunto de 17 diferencias descrito arriba.
# Cualquier diferencia adicional obliga a detenerse y revisarla.
```

`DB_RSA_PUBLIC_KEY` se valida y utiliza desde la configuración existente: no copiarla al informe ni sustituirla. Si cambia la identidad del servidor, la sonda debe detener la operación; no cambiar el UUID esperado para sortear ese control.

### Respaldo inmediatamente anterior

Con los escritores detenidos, y tras aprobar la sonda:

```powershell
npm run db:backup
if ($LASTEXITCODE -ne 0) { throw 'Fallo de respaldo: no migrar.' }
# Resolver UPLOAD_DIR igual que la API; el ejemplo siguiente solo vale si sigue siendo backend/uploads.
npm run uploads:backup -- --source=./uploads
if ($LASTEXITCODE -ne 0) { throw 'Fallo de respaldo de imágenes: no migrar.' }
$academicBackup = (Get-ChildItem .backups -File -Filter 'horus-horus_db-*.sql.gz' | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
$academicUploads = (Get-ChildItem .backups -Directory -Filter 'uploads-*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
npm run db:restore -- "--file=$academicBackup" --verify-only
if ($LASTEXITCODE -ne 0) { throw 'Respaldo de base inválido.' }
npm run uploads:restore -- "--from=$academicUploads" --verify-only
if ($LASTEXITCODE -ne 0) { throw 'Respaldo de archivos inválido.' }
```

Registrar nombres, hash y recuentos. No usar automáticamente la copia antigua sin rol. Restaurar también la copia recién creada en una instancia temporal identificada, siguiendo el ensayo de este informe, y comprobar recuentos, FK y cuenta 14 antes de dar la recuperación por disponible. No ejecutar la API actual contra un respaldo premigración para probar login: primero migrar su clon.

### Migración y verificación posterior

Solo con autorización real, destino verificado, respaldo nuevo restaurado y escritores aún detenidos:

```powershell
npm run db:migrate
if ($LASTEXITCODE -ne 0) { throw 'Migración fallida: mantener mantenimiento y revisar DDL/historial.' }
npm run db:check
if ($LASTEXITCODE -ne 0) { throw 'Esquema incompatible: no abrir el servicio.' }
```

El ejecutor debe registrar en orden capacidad → importaciones y terminar con 15 versiones si no se incorporaron otras. Verificar `SHOW CREATE TABLE convocatorias`, `SHOW CREATE TABLE importaciones_academicas`, CHECK activo, UNIQUE completo sin prefijos y ambas FK restrictivas. Comparar cuentas, roles, auditoría y contenido con la instantánea previa; para datos académicos, mismos recuentos y filas, permitiendo únicamente la nueva columna NULL y la nueva tabla vacía. No tocar `session_version`, contraseñas ni roles.

Reabrir la API de manera controlada, validar `/api/health`, login de la cuenta autorizada, navegación y listas académicas vacías o existentes, catálogo, ajustes, imágenes y chatbot. Estas peticiones pueden escribir cuotas/métricas, por lo que corresponden a la activación autorizada, después de la comparación de preservación. No usar registros ficticios en la base habitual: creación, importación y concurrencia ya se ensayaron en aislado. La primera operación institucional debe ser un registro real revisado por el responsable.

Si hubiera ediciones heredadas con capacidad NULL, configurar sus cupos por el panel mediante una operación explícita y revisada. No rellenarlos por SQL ni interpretar NULL como ilimitado. Actualmente el origen no tiene ediciones.

### Recuperación ante fallos

1. Mantener el mantenimiento y conservar la base afectada; anotar salida, versiones aplicadas y DDL efectivo. No borrar tablas ni editar el historial para forzar un reintento.
2. Si `db:migrate` terminó parcialmente, identificar si el primer ALTER ya hizo commit. No hay reversión transaccional. Cuando una versión conste como aplicada, el ejecutor la omite; si existe capacidad pero falta su marca, la repetición falla, como se demostró.
3. Verificar el respaldo inmediatamente anterior y restaurarlo en **otra base nueva** `horus_restore_<nombre>` con `db:restore --file=... --target=... --yes`, exclusivamente en el servidor temporal identificado. Restaurar uploads a otra carpeta nueva con `uploads:restore --from=... --target=... --yes`. Comparar recuentos, FK, datos, columnas y cuenta 14 antes de utilizar la copia.
4. Priorizar completar hacia delante el esquema aditivo tras diagnosticar el fallo y autorizar la corrección concreta. Si se restaura un clon premigración para usarlo con el código actual, aplicar en él las dos migraciones y `db:check` antes de iniciar la API.
5. Si se necesita sustituir el destino operativo o restaurar **sobre** `horus_db`, detenerse: el ejecutor deliberadamente no lo permite. La promoción es una intervención separada con destino, permisos y plan propios; no quedó autorizada ni ensayada aquí. No realizar renombrados entre esquemas o DROP improvisados, especialmente por las FK. La recuperación probada en base nueva no equivale a haber validado esa promoción.
6. Evitar pérdida de operaciones posteriores: no reabrir escritores hasta decidir si se recupera o se completa la activación. La recuperación devuelve el estado de la copia, no operaciones recibidas después de ella.

### Tiempo y riesgos

Reservar **10–20 minutos** de mantenimiento para identificación, respaldo nuevo, restauración de ensayo, migración y verificaciones manuales. Es una estimación de planificación: el ejecutor de migraciones tardó 0,553 s en el clon, pero bloqueos o tráfico concurrente pueden alargar la ventana. Una recuperación o promoción requiere tiempo adicional y no tiene duración garantizada.

Riesgos restantes: cambios desde esta instantánea, escritores externos, fallos entre DDL y registro de versión, bloqueo de metadatos, custodia de las copias y promoción operativa de una restauración. No se verificaron un despliegue nuevo, correo, IA externa ni acceso ngrok. La CI Node 22 y la validación local Node 24 son evidencias distintas.

## 7. Cierre y estado Git

La lectura final del mismo UUID confirmó identidad de todos los datos y estructura de las 23 tablas persistentes respecto al inicio: siguen las 13 versiones originales, sin capacidad ni tabla de importaciones en `horus_db`. La cuenta 14 conserva `GERENTE_GENERAL`. La huella del `.env` y las de los 35 archivos de uploads originales coinciden con el inicio. Las cuotas efímeras no se incluyen en la comparación de datos, como en el respaldo normal.

La instancia nativa se apagó mediante SQL después de comprobar UUID, directorio y relación entre PID lanzador/PID servidor. Se eliminó su directorio de datos, incluidas las cuatro bases clonadas. Todos los contenedores de estas pruebas fueron retirados; los tres contenedores habituales permanecen activos. Sin procesos Edge de perfiles `horus-*` sobrantes al cierre.

Las salidas de las comprobaciones se conservaron localmente en `backend/.backups/activacion-academica-20261019-ensayo/`, ignorada por Git. Los respaldos nuevos de base y uploads se conservan aparte en `.backups/`; no se incorporaron al índice. La sonda de lectura incluida en el plan también se ejecutó literalmente y terminó con código 0.

El directorio de arneses y la copia temporal de imágenes permanecen en `%TEMP%/horus-activation-97062655dc404065bb148501c800e432/`. La revisión automática rechazó la orden combinada que incluía retirar esa copia; solo informó bloqueo por política, sin detalle adicional. Se conservó la carpeta y se copió la evidencia mediante una orden separada sin borrados. No queda allí el directorio de datos MySQL ni un servidor activo.

Git final: rama `anderson`, HEAD `6994691011d7e27fc11c0934d05094ab580f0b46`; único archivo nuevo `docs/procedimientos/activacion-academica-mysql-ensayo.md`. `git diff --check` aprobado.

Solo se añade este informe. No se modifican Laravel/SQLite, `.env`, `docs/diagramas`, Docker Compose, frontend, Login/Register, ramas ajenas ni código de los cuatro módulos. Sin commits ni pushes.

La preparación técnica está aprobada para el estado inspeccionado. Antes de la ejecución real siguen siendo obligatorias la autorización posterior, comprobación del destino, ventana sin escritores y copia inmediatamente anterior restaurada y verificada. La promoción de una base restaurada queda fuera de este ensayo.

VEREDICTO: LISTO PARA ACTIVAR.
