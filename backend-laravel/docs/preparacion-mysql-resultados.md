# Preparación de MySQL — evidencia local del 17/10/2026 (Lima)

La activación definitiva sigue pendiente. No se creó base ni usuario definitivo, no
se modificaron entornos habituales, no se importó contenido real y no se activaron
React/Laravel público, Sanctum ni el chatbot. Sin commits, push ni instalaciones.

## Estado inicial y CI publicada

- Rama `anderson`, HEAD `f1736c2db22499c29001718f544b4b8f5e49c78f`, árbol inicialmente
  limpio. `git ls-remote` confirmó el mismo SHA en `origin/anderson`.
- [Laravel CI](https://github.com/Castope/Proyecto-Horus-/actions/runs/39090604940): success.
- [CI general](https://github.com/Castope/Proyecto-Horus-/actions/runs/39090604935):
  estaba en ejecución al empezar y terminó success. Frontend, backend e integración
  MySQL aprobados; smoke manual de navegador omitido por ese workflow.
- Esas ejecuciones cubren el commit publicado, **no los cambios locales de esta sesión**.
- PHP 8.4.26 con PDO MySQL/SQLite y SQLite3; MySQL disponible en Docker 8.4.11.
  Node instalado 24.19.0, distinto del 22.x declarado por los paquetes vecinos. No
  se instalaron dependencias ni se compilaron React/NestJS.

## Base habitual, procesos y respaldo

Laravel usa `database/database.sqlite`, sin `DB_URL` ni caché de configuración.
Contenido del panel/API y autenticación pública siguen apagados por defecto.
Se identificaron procesos PHP de servicio activos; no se detuvo ni reinició ninguno.
La inspección de procesos no demuestra qué conexiones SQLite mantienen abiertas.

Se creó un respaldo privado fuera del repositorio con ACL limitada al usuario actual
y SYSTEM, usando `scripts/backup-sqlite.php`. La ruta concreta se entrega al responsable
en el chat, no se versiona. El manifiesto privado registra fecha UTC, SHA-256 del archivo,
firma del esquema, recuentos y firmas de cada tabla, sin valores de filas.

Resultados: `integrity_check=ok`, ninguna FK huérfana, esquema y contenido coincidentes
en la instantánea de origen y respaldo; restauración temporal abierta y comparada con
éxito. La prueba automatizada adicional demuestra conservación de datos confirmados en
WAL sin alterar origen ni WAL. El respaldo incluye sesiones y hashes: mantenerlo privado
y cifrarlo antes de transportarlo; la copia local está protegida por ACL, no cifrada por
el script. No sustituye un respaldo nuevo durante la ventana de activación.

El SHA-256 de la SQLite habitual y los de `backend/.env` y `backend-laravel/.env`
coincidieron con los iniciales en la comprobación posterior. No se enviaron escrituras
a ninguna base habitual.

## Destino MySQL: diferencia detectada

El contenedor existente `horus-local-mysql-1` usa MySQL 8.4.11. Consultas de lectura
mostraron `horus_local`, no `horus_db` ni `horus_laravel`. El backend de ese Compose
declara `DB_HOST=mysql`, `DB_NAME=horus_local` y no publica MySQL en el host.
Por separado, `backend/.env` declara `127.0.0.1:3306/horus_db`; no se observó ese puerto
escuchando en el host. **No se confirmó conectividad ni contenido de esa horus_db.**
No crear ni cambiar ninguna base para resolver esta discrepancia: antes de activar,
el responsable debe elegir el servidor efectivo y confirmar su UUID y los consumidores.
Los tres contenedores previos se conservaron; los ensayos usaron otros contenedores
propios con puerto loopback aleatorio y datos desechables.

## Ensayo y cobertura

Una copia privada ya verificada se usó como origen con su SHA-256 esperado. El destino
fue exclusivamente la base `horus_laravel_it_<hex>` creada por el bootstrap en un servidor
desechable con UUID comprobado y sin `horus_db`. Se ejecutaron:

1. Migraciones Laravel en el destino vacío.
2. Simulacro del traslado, con rollback y comprobación de tablas de datos vacías.
3. Aplicación entre copia SQLite y MySQL temporales: recuentos y firmas normalizadas
   de todas las tablas transferidas, comprobación referencial e informe sin avisos.
4. Firma del origen intacta y segunda aplicación rechazada por destino poblado.
5. Casos ficticios de colisiones por colación, fechas con hora y textos largos;
   rollback sin filas parciales. Se preservan IDs, hashes, roles, matrículas e historial
   en fixtures con esos datos (el respaldo habitual no contiene movimientos históricos).

La suite también cubre CHECK, UNIQUE, FK, migraciones, curso/edición, creación y reactivación
de matrículas, cupos, cancelación, historial y diez carreras reales entre dos procesos
con bloqueo InnoDB. Se añadieron comprobaciones MySQL de cuenta básica sin acceso a
`/gestion`, exclusión de secretaría/coordinación del contenido, publicación/despublicación
y revocación de autorización con una acción abierta en Livewire.

Limitación explícita: rollback revierte filas; InnoDB puede avanzar AUTO_INCREMENT.
No se probaron carga grande, producción, MariaDB ni navegador real contra MySQL.
Las pruebas HTTP/Livewire ejercitan Laravel con datos ficticios, sin sesión real de usuario.

## Cambios y correcciones

Archivos existentes modificados:

- `app/Support/Traslado/TrasladoSqliteMysql.php`: rechaza nombres ajenos antes de consultar.
- `tests/MySql/TrasladoSqliteMysqlTest.php`: ensayo opcional privado y regresión de destino.
- `docs/mysql-traslado.md`, `docs/activacion-contenido-laravel.md`,
  `docs/contenido-publico.md`, `README.md`: respaldo nativo, comandos, privilegios y activación pendientes.

Archivos nuevos:

- `app/Support/Traslado/RespaldoSqlite.php`, `scripts/backup-sqlite.php`.
- `app/Support/Contenido/ImportarContenido.php`, `app/Console/Commands/ImportarContenidoNestjs.php`.
- `tests/Unit/RespaldoSqliteTest.php`, `tests/Feature/Contenido/ImportarContenidoTest.php`,
  `tests/MySql/ImportacionContenidoMysqlTest.php`.
- `docs/importacion-contenido.md`, `docs/preparacion-mysql-plan.md` y este informe.

Se reprodujo el intento de consultar una base ajena antes de rechazarla y se corrigió
con regresión RED→GREEN. En el importador nuevo se corrigieron una factory que creaba
un convenio al preparar fixtures, la longitud del bloqueo asesor y el manejo neutro
de fallos de conexión (regresión RED→GREEN). No se redujeron validaciones ni permisos.
Se reprodujo además que el importador admitía una sesión MySQL distinta de UTC y se
añadió el rechazo previo, con prueba RED→GREEN, para evitar desplazar TIMESTAMP.

Revisión independiente estática sin hallazgos bloqueantes; la mejora del manejo neutro
de conexión quedó implementada y probada. Se mantuvieron fuera del contrato la inspección
MIME de imágenes y su descarga HTTP; el importador solo valida URL y archivo local.

## Importación y contratos

El importador offline está implementado y probado con fixtures; no accede a NestJS.
Acepta las siete tablas de intercambio, valida campos e imágenes locales y compara todas
las filas en una transacción. La repetición idéntica no duplica; contenido editado detiene
la importación. Las URL remotas se rechazan hasta su verificación independiente.
El exportador real y la extracción de contenido **no se ejecutaron ni implementaron**.

Se revisaron estáticamente las once rutas públicas Laravel y los seis recursos de
`frontend/src/contentSource.ts`, sus envoltorios, publicación, paginación y fechas.
Las suites de contrato usan fixtures; no se compararon respuestas de dos bases reales.
Las cinco pruebas del selector React aprobaron y confirman NestJS por defecto; no se
editó ni compiló React. Formularios, sesión y chatbot siguen en NestJS. Las respuestas
libres del chatbot mantienen Prisma; no se activará otra fuente sin aprobar esa integración.

## Pruebas finales

| Comprobación ejecutada | Resultado |
| --- | --- |
| PHPUnit Laravel completo, `--display-all-issues` | 360 pruebas, 2.446 aserciones; salida 0, sin avisos |
| Suite MySQL completa, con ensayo de copia privada habilitado | 48 pruebas, 442 aserciones; salida 0, sin avisos ni omisiones |
| Regresión final de respaldo e importador SQLite tras exigir UTC solo en MySQL | 8 pruebas, 43 aserciones; salida 0 |
| `php vendor/bin/pint --test` | Aprobado, salida 0 |
| `node --test tests/content-source.test.mjs` en frontend | 5 pruebas aprobadas, sin omisiones |
| `git diff --check` | Sin errores |
| Búsqueda de patrones de secretos en archivos nuevos y revisión manual | Sin secretos detectados |

PHPUnit se ejecutó sin `CLAUDECODE`/`AI_AGENT` y con `PAO_DISABLE=true`, ya que el
formateador detectaba también el entorno Codex y resumía la salida inicial. Las cifras
de la tabla corresponden a salida completa; no se suman suites repetidas. La suite
SQLite completa precedió al último guard exclusivo de MySQL; después se repitieron
sus módulos afectados y toda la suite MySQL. No se ocultaron fallos: las pruebas RED
de las salvaguardas nuevas se reprodujeron antes de corregirlas.

Estado final: misma rama/HEAD/remoto; 6 archivos existentes modificados y 10 nuevos,
todos bajo `backend-laravel/`, sin cambios preparados en el índice. Inventario arriba.
Los contenedores temporales de las pruebas, incluidas ejecuciones fallidas de regresión,
fueron eliminados por sus scripts; se conservan los tres contenedores originales y
los cuatro procesos PHP de servicio identificados al inicio. El respaldo privado y su
manifiesto se conservan deliberadamente; la restauración temporal fue eliminada.

## Autorizaciones concretas que faltan

1. Elegir host, puerto y UUID del MySQL definitivo; confirmar la diferencia `horus_local` /
   `horus_db` y aprobar crear **solo** `horus_group` y sus cuentas separadas.
2. Aprobar la ventana sin escrituras y la parada de procesos Laravel identificados.
3. Autorizar migraciones de esa base vacía, traslado de registros reales, modificación
   privada de `backend-laravel/.env` y cambio habitual SQLite → MySQL.
4. Verificar el login real de una cuenta autorizada en `/gestion`, totales, ficha de
   estudiante, matrícula e historial, antes de reabrir escrituras. No crear cuentas nuevas
   ni modificar roles como parte de esa comprobación sin autorización adicional.
5. Acordar observación y recuperación: conservar SQLite y configuración anterior;
   si hay nuevas escrituras MySQL, volver exige decidir cómo conservarlas. No copiar a
   ciegas el respaldo viejo sobre la SQLite habitual ni vaciar bases como recuperación.
6. Para contenido: autorizar extracción SELECT, imágenes y ejecución real del importador;
   después, por separado, panel/API de contenido, alineación del chatbot, preview y
   activación de React. Sanctum público continúa apagado y requiere otra autorización.

Secuencia definitiva y comprobaciones en
[activacion-contenido-laravel.md](activacion-contenido-laravel.md). No queda programada
ninguna activación automática y no se ejecutaron cambios en producción.

## Adaptación final a `horus_group` (17/10/2026)

Esta sección corresponde a la adaptación posterior a la preparación registrada arriba;
los recuentos y observaciones históricos se conservan. El árbol ya tenía cambios pendientes,
incluidos el importador y sus pruebas: no se sustituyeron ni se atribuyen como trabajo nuevo.

`horus_group` queda preparado **como destino propuesto a nivel de código**, sin crearlo ni
conectarlo. Traslado, servicio de contenido y comando de importación usan la misma regla:
solo `horus_group` o `horus_laravel_it_<16 hex>`; `horus_laravel` deja de ser destino válido.
Se mantienen los nombres temporales e históricos. `horus_db`, `horus_local`, bases del
sistema, sufijos no autorizados, mayúsculas y saltos de línea se rechazan antes de consultar
el destino. El importador mantiene además la coincidencia de base y `server_uuid`.

Se reprodujo con dos pruebas fallidas que una tabla externa vacía no se detectaba en
traslado ni importación. Ambos flujos rechazan ahora cualquier tabla fuera del inventario
cerrado de las migraciones Laravel, incluso vacía. El traslado también inspecciona vistas.
Se conservan InnoDB, validación de valores, migraciones, destino vacío, claves foráneas,
firmas, transacciones, bloqueo asesor y exigencia UTC del importador.

Archivos nuevos de esta adaptación:

- `app/Support/Traslado/DestinoMysqlLaravel.php`.
- `tests/Feature/Contenido/DestinoImportacionTest.php`.
- `tests/Unit/DestinoTrasladoTest.php`.

Archivos previos adaptados en esta tarea (varios ya estaban modificados o sin seguimiento):

- `app/Support/Traslado/TrasladoSqliteMysql.php`.
- `app/Support/Contenido/ImportarContenido.php`.
- `app/Console/Commands/ImportarContenidoNestjs.php`.
- `tests/MySql/TrasladoSqliteMysqlTest.php`.
- `tests/MySql/ImportacionContenidoMysqlTest.php`.
- `tests/MySql/bootstrap.php`.
- `docs/mysql-traslado.md`.
- `docs/importacion-contenido.md`.
- `docs/activacion-contenido-laravel.md`.
- `docs/preparacion-mysql-plan.md`.
- Este informe, `docs/preparacion-mysql-resultados.md`.

El ensayo actual usó exclusivamente fixtures: SQLite temporal y MySQL **8.4.11** en un
contenedor propio con UUID comprobado. Se ejecutaron migraciones, simulacro con rollback,
aplicación temporal, comparación de recuentos y firmas, conservación de IDs, hashes de
contraseña, relaciones, matrículas y movimientos. La segunda aplicación del traslado se
rechaza por destino poblado; la segunda importación idéntica de contenido se reutiliza sin
duplicados y una edición diferente se conserva al rechazar la importación.

Pasaron las diez carreras académicas entre procesos y una prueba nueva con dos conexiones
MySQL que mantiene el bloqueo asesor, rechaza otro importador sin escrituras y permite
continuar al liberarlo. Las pruebas HTTP/Livewire existentes de autorización también pasaron;
no se cambiaron roles ni sus reglas. El nombre `horus_group` se verificó con conexiones
simuladas; no se creó una base con ese nombre para probarlo.

La suite MySQL completa terminó con código 0: **51 casos, 435 aserciones, 50 aprobados y
1 omitido**. La omisión es el ensayo opcional de una copia privada real, no utilizado en esta
adaptación. No confundirlo con el ensayo completo ficticio, que sí pasó. El contenedor y la
base desechables fueron eliminados. No se validaron producción, datos reales, MariaDB ni
volúmenes grandes. Rollback sigue sin garantizar identidad de contadores AUTO_INCREMENT.

Comprobaciones finales de esta adaptación, todas con código de salida 0:

| Comprobación | Resultado |
| --- | --- |
| `php vendor/phpunit/phpunit/phpunit --colors=never --display-all-issues` (salida sin buffering) | 382 pruebas, 2.538 aserciones, sin omisiones ni avisos |
| `./scripts/test-mysql.ps1` | 51 casos, 435 aserciones; 50 aprobados y 1 omisión opcional descrita arriba |
| `php vendor/bin/pint --test` | Aprobado |
| `git diff --check` | Sin errores |

PHPUnit se ejecutó sin `CLAUDECODE`/`AI_AGENT` y con `PAO_DISABLE=true`. Las 22 pruebas
específicas de selección de destino (92 aserciones) están incluidas en la suite de 382;
no se suman por separado. Estos resultados son locales y no corresponden a una ejecución CI.

Los hashes de `backend-laravel/.env`, `backend/.env` y la SQLite habitual coincidieron con
los iniciales. No se accedió a las bases `horus_db` ni `horus_local`, no se creó `horus_group`,
no se activaron APIs públicas ni React, no se instalaron dependencias y no hubo commit ni push.
Los cambios previos en README, contenido público y respaldo SQLite se conservaron.

La activación real sigue requiriendo las autorizaciones enumeradas arriba: confirmar servidor
y UUID, crear solo `horus_group` y sus cuentas, acordar ventana y respaldo nuevo, migrar,
ensayar y aplicar los datos reales, configurar privadamente Laravel y verificar conexión y
acceso antes de reabrir escrituras. Extracción/importación real de contenido y activación
pública son pasos separados. **La base definitiva no está declarada conectada.**
