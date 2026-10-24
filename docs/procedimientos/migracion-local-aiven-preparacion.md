# Copia completa de MySQL local a Aiven: preparación, sin ejecución

Fecha: **24/10/2026, America/Lima**. Rama inspeccionada: `anderson`.

## Estado y decisión operativa

Se preparó este procedimiento y un inventario agregado de imágenes. **No se generó un respaldo real,
no se conectó a Aiven y no se importó nada.** Tampoco se modificaron cuentas, privilegios, archivos
de imágenes, React, datos o estructuras. No hubo instalación, commit, push ni despliegue.

La estrategia para esta copia es **esquema completo + datos + horus_migrations sobre horus_db remota
vacía**. No ejecutar antes `init-database.cjs` ni `migrate.cjs`. Esta decisión sustituye, exclusivamente
para este traslado, la instalación vacía propuesta en [la guía general de Aiven](aiven-mysql-preparacion-segura.md).
No modifica el historial ni aplica la migración retirada de sesiones.

| Elemento | Referencia y estado |
| --- | --- |
| Origen | `127.0.0.1:3306/horus_db`, UUID privado cotejado con el JSON indicado por el responsable durante el inventario |
| Línea base declarada | MySQL 8.0.46; 30 tablas InnoDB con PK; 150 filas; 18 migraciones activas; 22 FK; 37 CHECK; 14 administradores; 1.797 MiB de tablas/índices |
| Alcance de la lectura ejecutada | Solo inventario de imágenes/localhost; la línea base completa anterior **no se recontó** en esta preparación |
| Destino declarado, sin conexión | Proyecto `horus-group-dev`, servicio `mysql-1b22a7e2`, `mysql-1b22a7e2-horus-group-dev.d.aivencloud.com:28816`, base `horus_db`, MySQL 8.4.11 Free |
| Identidad operativa remota | `horus_migrator`; SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES sobre la base, según el responsable; no revalidado aquí |
| CA / secreto remoto | `C:\Horus-Secure\Aiven\ca.pem` y `C:\Horus-Secure\Aiven\Secrets\horus_migrator.dpapi`; se comprobó existencia, no se descifró el secreto |

La autorización adicional recibida permitió usar **horus_migrator LOCAL exclusivamente para lectura**.
El JSON privado contiene `horus_app` y `horus_migrator`, no una tercera cuenta de respaldo.
El atributo `host` de una cuenta MySQL no debe interpretarse como dirección del servidor.
La lectura fijó loopback y puerto 3306 y exigió el UUID `servidor_uuid` del JSON antes del inventario.
No se reutilizará esa contraseña en Aiven.

## A. Respaldo cifrado: procedimiento para una autorización posterior

### Herramientas existentes y límites

Inspeccionados `backend/scripts/backup.cjs`, `restore.cjs`, `backup-lib.cjs`, `database.cjs` y
`connection-security.cjs`, además del esquema Prisma y los consumidores de imágenes.

- `backup.cjs` usa instantánea `REPEATABLE READ`, `READ ONLY`; copia todas las tablas base del esquema
  seleccionado, también `horus_migrations`. **Usar `--include-rate-limits`**: sin él omite filas de
  `rate_limit_buckets`, aunque conserva su estructura.
- Entrega `.sql.gz`, `.sql.gz.sha256` y `.sql.gz.manifest.json`. Gzip **no cifra**.
  `SHOW CREATE TABLE` conserva PK, índices, ENUM, CHECK, FK, colaciones de tabla/columna y AUTO_INCREMENT.
  El manifiesto registra charset/collation de la base y nombres de migraciones.
- Conserva valores de columnas normales, IDs, hashes bcrypt, fechas y JSON. Las columnas generadas,
  como `certificados.vigente_matricula_id`, se conservan en DDL y se recalculan al restaurar;
  no se insertan explícitamente. La igualdad exacta deberá comprobarse en el ensayo.
- No exporta `mysql.user`, grants ni cuentas internas del servidor. Los 14 administradores de
  `admin_users` sí son datos de la aplicación y deben conservarse con sus hashes intactos.
- El volcado no incluye uploads, vistas, rutinas, eventos o triggers. Antes de autorizar la copia,
  comprobar que el origen sigue teniendo solo las 30 tablas esperadas y ningún objeto adicional
  necesario. Si aparecen otros objetos, detenerse y adaptar el diseño; no llamarlo copia completa.
- La instantánea no protege frente a DDL concurrente. Exigir ventana sin escritores ni cambios
  de esquema para capturar y comparar una línea base estable. No matar conexiones automáticamente.
- El SHA-256 detecta alteración; no demuestra cifrado ni autenticidad si un atacante reemplaza también
  el hash. Custodiar un hash del paquete cifrado en un registro independiente protegido.

### Almacenamiento y recuperación

Propuesta concreta, **sin carpetas ni volúmenes creados durante esta preparación**:

1. Área temporal: `X:\Horus-Migration-Staging\<ejecucion>`, siendo `X:` un volumen **ya cifrado y
   verificado** con BitLocker o un contenedor cifrado aprobado. No usar una carpeta ordinaria como
   sustituto; una ACL o el sufijo `.gz` no cifran los datos. Verificar también el volumen del ensayo.
2. Copia cifrada local final: `C:\Horus-Secure\Aiven\Migration\<ejecucion>\horus-db.7z`.
   Incluir solo los tres archivos de la base y el inventario técnico privado de comparación;
   **excluir backend/uploads y cualquier secreto de conexión**.
3. Segunda copia: `E:\Horus-Backups\<ejecucion>\horus-db.7z`, donde `E:` sea un disco externo
   identificado y aprobado, desconectado después de verificar. Las letras son ejemplos que deben
   cotejarse físicamente; otra partición de la misma computadora no es copia independiente.
   También sirve almacenamiento corporativo externo aprobado, transfiriendo solo el paquete cifrado.
4. Crear una clave aleatoria exclusiva en un gestor de contraseñas aprobado, con al menos 32 caracteres
   aleatorios. No reutilizar la contraseña MySQL. Guardar clave y referencia de recuperación en el
   gestor con acceso de dos responsables; ninguna clave junto al paquete. Conservar recuperación
   BitLocker por separado y ensayar su acceso antes del respaldo.
5. DPAPI protege la contraseña remota en el contexto Windows de quien la creó. **No es la clave del
   respaldo ni una solución portátil de recuperación.** Exportar su blob a otra máquina no acredita
   que se pueda descifrar. La recuperación de esa contraseña debe estar prevista en el gestor
   corporativo o en el proceso autorizado del proveedor; no se restablece ni rota aquí.
6. Ensayar descifrado en otro equipo autorizado usando la clave del gestor, no la sesión Windows
   original. Comparar los hashes de los tres archivos recuperados y ejecutar `--verify-only`.
   Una clave perdida del archivo cifrado no se recupera mediante la contraseña de MySQL.

Retención propuesta: conservar las dos copias verificadas y la línea base hasta aceptación de la
migración y aprobación expresa de su retiro. Responsable, ubicación externa definitiva y retención
deben quedar registrados antes de generar datos. No borrar respaldos ni temporales con datos reales
como parte de este trabajo; después requerir un procedimiento de retiro autorizado, sin prometer
borrado seguro de SSD por eliminar un archivo.

### Comandos de PowerShell 5.1, no ejecutados con datos reales

Requisitos: Node **22.x**, dependencias existentes del backend, volumen temporal cifrado y 7-Zip
aprobado. En esta sesión `node` resolvió a **24.19.0** y no se encontró 7-Zip en PATH ni en su ruta
habitual. No se instalaron herramientas. Los comandos siguientes requieren resolver esos requisitos.

Preparar directorios **nuevos** después de aprobar las ubicaciones. Las ACL limitan acceso, pero no
sustituyen el cifrado. En sistemas corporativos revisar las ACL efectivas y políticas de administradores.

```powershell
$ErrorActionPreference = 'Stop'
$RunId = Get-Date -Format 'yyyyMMdd-HHmmss'
$Stage = Join-Path 'X:\Horus-Migration-Staging' $RunId
$ArchiveDir = Join-Path 'C:\Horus-Secure\Aiven\Migration' $RunId
$ExternalDir = Join-Path 'E:\Horus-Backups' $RunId

# Comprobar primero que las letras corresponden a los dispositivos autorizados.
Get-BitLockerVolume -MountPoint 'X:' | Select-Object MountPoint,VolumeStatus,ProtectionStatus,EncryptionPercentage
# Exigir FullyEncrypted, ProtectionStatus On, 100%; no habilitar cifrado automáticamente.
foreach ($dir in @($Stage, $ArchiveDir, $ExternalDir)) {
    if (Test-Path -LiteralPath $dir) { throw 'El directorio de ejecución ya existe.' }
    New-Item -ItemType Directory -Path $dir -ErrorAction Stop | Out-Null
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $dir '/inheritance:r' '/grant:r' ('*' + $sid + ':(OI)(CI)F') '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo limitar la ACL.' }
    Get-Acl -LiteralPath $dir | Select-Object Owner,AccessToString
}
```

Fijar explícitamente todos los `DB_*` en **un proceso nuevo privado**, con cuenta local autorizada,
host loopback, puerto 3306 y UUID local cotejado. No heredar variables de Aiven. La contraseña se lee
del JSON privado **en memoria**, nunca se imprime. Antes de la copia ejecutar un preflight de identidad,
versión, objetos, conteos y ausencia de escritores, y registrar solo agregados en el área cifrada.
No utilizar el inventario de imágenes como sustituto de ese preflight completo.

Ejemplo del volcado, después del preflight autorizado y con `DB_*` ya inyectadas por el operador:

```powershell
$Backend = 'C:\Users\PCT40T\Documents\Proyecto-Horus-\backend'
$Node = (Get-Command node.exe -CommandType Application).Source
if (-not ([string](& $Node --version)).StartsWith('v22.')) { throw 'Se requiere Node 22.' }
if ($env:DB_HOST -ne '127.0.0.1' -or $env:DB_PORT -ne '3306' -or $env:DB_NAME -ne 'horus_db') { throw 'Origen inesperado.' }
foreach ($key in @('DB_USER','DB_PASS','DB_EXPECTED_SERVER_UUID')) {
    if (-not [Environment]::GetEnvironmentVariable($key, 'Process')) { throw 'Falta configuración privada.' }
}
# El área cifrada debe existir y no contener .env. El proceso se cierra al terminar la operación.
Push-Location $Stage
try {
    & $Node '-r' (Join-Path $Backend 'test\isolate-env.cjs') (Join-Path $Backend 'scripts\backup.cjs') ('--dir=' + $Stage) '--include-rate-limits'
    if ($LASTEXITCODE -ne 0) { throw 'Respaldo incompleto; detenerse.' }
    $dumps = @(Get-ChildItem -LiteralPath $Stage -Filter '*.sql.gz' -File)
    if ($dumps.Count -ne 1) { throw 'Se esperaba un solo volcado.' }
    $Dump = $dumps[0].FullName
    & $Node (Join-Path $Backend 'scripts\restore.cjs') ('--file=' + $Dump) '--verify-only'
    if ($LASTEXITCODE -ne 0) { throw 'Verificación fallida.' }
} finally {
    Pop-Location
    Remove-Item Env:DB_PASS -ErrorAction SilentlyContinue
}
```

El directorio de trabajo fuera del repo evita que `dotenv.config()` lea el `.env` habitual;
la precarga aísla la carga indirecta de Prisma. Deben haberse inyectado también TLS/RSA y todas las
opciones públicas del origen explícitamente, sin conservar valores remotos. No hay contraseña en
argumentos, pero el entorno del proceso puede ser accesible a otro proceso con privilegios suficientes;
usar sesión privada, sin depuración ni transcripción. No convertir este ejemplo en una tarea automática.

Para cifrar, seleccionar exactamente el volcado y sus dos acompañantes. La contraseña se introduce
en el prompt de 7-Zip o en su interfaz gráfica; **no usar `-pCONTRASEÑA` ni una variable interpolada**.
Crear un archivo nuevo, no actualizar uno existente. AES-256 y cabeceras cifradas; probar después.

```powershell
$SevenZip = 'C:\Program Files\7-Zip\7z.exe'
if (-not (Test-Path -LiteralPath $SevenZip)) { throw 'Falta 7-Zip aprobado; no instalar automáticamente.' }
$Archive = Join-Path $ArchiveDir 'horus-db.7z'
if (Test-Path -LiteralPath $Archive) { throw 'El paquete ya existe.' }
& $SevenZip a '-t7z' '-mhe=on' '-p' $Archive $Dump ($Dump + '.sha256') ($Dump + '.manifest.json')
if ($LASTEXITCODE -ne 0) { throw 'Cifrado fallido.' }
& $SevenZip t '-p' $Archive
if ($LASTEXITCODE -ne 0) { throw 'Paquete no recuperable.' }
$CipherHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Archive).Hash
$Second = Join-Path $ExternalDir 'horus-db.7z'
if (Test-Path -LiteralPath $Second) { throw 'La segunda copia ya existe.' }
[IO.File]::Copy($Archive, $Second, $false)
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $Second).Hash -ne $CipherHash) { throw 'Segunda copia distinta.' }
```

Guardar `$CipherHash` por canal independiente protegido, no junto a la contraseña. En el segundo
equipo autorizado, extraer con `7z x -p` hacia un directorio **nuevo en volumen cifrado**, verificar
los hashes internos, el manifiesto y `restore.cjs --verify-only`. Ejecutar además una prueba con clave
incorrecta sobre un paquete ficticio: debe fallar sin extraer contenido utilizable. Inspeccionar que
el listado sin clave no exponga los nombres. `7z t` por sí solo no sustituye el ensayo de restauración.
7z admite [AES-256](https://7-zip.org/7z.html); el hash protegido fuera del paquete sigue siendo necesario.

## B. Ensayo futuro: MySQL 8.4.11 desechable y aislado

No se ejecutó este ensayo con datos reales. El [ensayo previo del migrador](ensayo-horus-migrator-20261024.md)
probó instalación y permisos con datos ficticios; **no demuestra una copia exacta de estos 150 registros**.

1. Primero probar el importador nuevo con fixtures ficticios y pruebas negativas. Después, solo con
   autorización para tratar la copia real, recuperar el paquete en el área cifrada.
2. Usar imagen MySQL cuyo `VERSION()` sea **8.4.11**, fijada por digest verificado y compatible con amd64.
   Contenedor, red y almacenamiento nuevos con nombres exclusivos, puerto en `127.0.0.1`, sin montar
   carpetas de datos del MySQL local ni recursos Docker preexistentes. Persistencia efímera cifrada
   o tmpfs; comprobar si Docker puede volcar memoria a disco y proteger su almacenamiento.
3. Crear solo en ese servidor de ensayo una base vacía y credenciales ficticias. Cotejar UUID por
   `docker exec` y por SQL antes de escribir. Nunca reutilizar el secreto de Aiven ni el local.
   El operador del ensayo aprovisiona; la cuenta operativa usa los ocho privilegios del migrador,
   sin DROP ni GRANT OPTION. Exigir PK, TLS y las variables de sesión previstas para Aiven.
4. Para verificar el respaldo con la herramienta actual, usar `restore.cjs` con destino
   `horus_restore_aiven_<id>`, servidor de ensayo y `DB_NAME` distinto. No cambiar su validador para
   aceptar `horus_db`. Tras preparar el importador específico, ensayar también su lógica contra
   `horus_db` vacía en otro destino del mismo servidor desechable, usando un modo local separado
   que nunca acepte hosts remotos ni comparta configuración con el modo Aiven.
5. No ejecutar init ni migraciones antes de importar. Ejecutar `db:check` después de la carga,
   apuntando exclusivamente al servidor de ensayo. No cambiar el `.env` habitual.
6. Aceptar solo si pasa toda la matriz de integridad siguiente. Si falla, conservar el destino como
   incompleto, sin conectar aplicaciones y sin corregir registros ni reanudar el volcado a ciegas.
7. Smoke con Prisma y NestJS compilado del código fijado: sin salida a Internet, correo/WhatsApp/OpenAI
   bloqueados y proveedores sustituidos antes de arrancar. Consultar catálogo y comparar con el
   subconjunto publicado esperado. Comprobar JWT/AccessGuard con una cuenta autorizada y contraseña
   introducida en memoria; no intentar recuperar contraseñas desde bcrypt. Conservar las 14 cuentas.
   Si no existe una contraseña disponible, el login real queda pendiente; usar una base separada
   de fixtures para probar el flujo de autenticación sin alterar la copia real.
8. Registrar digest, versión, UUID de ensayo, SHA del código, hash del paquete y resultados agregados.
   No adjuntar filas, correos, tokens ni hashes bcrypt. No retirar recursos preexistentes ni borrar
   el origen; el cierre de recursos propios y temporales reales requiere el alcance autorizado.

## C. Diseño del importador específico de Aiven

**Diseño pendiente de implementación y ensayo; no existe aquí un comando de importación habilitado.**
No usar `ALLOW_RESTORE_DB=true` para eludir el prefijo del restaurador actual ni importaciones genéricas
por consola. Reutilizar utilidades puras de `backup-lib.cjs`, sin relajar sus validaciones globales.

Contrato requerido antes de permitir una ejecución real:

1. Modo predeterminado offline: validar los tres archivos, SHA obligatorio, formato y manifiesto
   obligatorio, charset/collation registrados, tabla exacta por nombre, nombres únicos, recuentos,
   historial exacto de migraciones y conjunto completo de sentencias. El manifiesto y el SQL deben
   coincidir en tablas/INSERT/columnas, sin duplicados ni referencias entre esquemas.
   La validación actual del manifiesto es insuficiente como contrato estricto para una importación real.
2. Separar `preflight` remoto de solo lectura y `apply`. Ambos exigen autorización explícita,
   UUID esperado obtenido por vía independiente y perfil de destino fijo. `apply` exige además
   el hash del paquete aprobado y un token de aprobación operativo fuera del repo. No se crea un token aquí.
3. Aiven: fijar DNS y puerto de la tabla inicial, `database=horus_db`, usuario `horus_migrator`.
   Rechazar IP, alias, host alternativo y cualquier intento de usar credenciales de aplicación o administrador.
   Recibir la contraseña DPAPI mediante **stdin redirigido**, desde PowerShell 5.1 del usuario Windows
   autorizado; nunca argumentos, texto interpolado o archivo plano. No imprimir errores del conector.
   El script previo `verificar-horus-migrator-aiven.ps1` muestra ese transporte, pero no es un importador
   ni verifica todas estas condiciones; no se ejecutó ni modificó durante esta preparación.
4. TLS obligatorio, CA del proyecto leída del archivo privado, `rejectUnauthorized=true`, verificación
   explícita de hostname/SNI y TLS 1.2 o superior; comprobar cipher y versión de sesión. Con mysql2
   usar `verifyIdentity=true`. Rechazar `NODE_TLS_REJECT_UNAUTHORIZED=0`. Fallar con CA/hostname/UUID
   incorrectos, sin alternativa insegura. [Requisitos de Aiven](https://aiven.io/docs/platform/concepts/tls-ssl-certificates).
5. En la **misma conexión que escribirá**, cotejar `@@server_uuid`, `VERSION()`, `DATABASE()`,
   `CURRENT_USER()`, roles y grants efectivos. La versión debe coincidir con la ensayada; si hubo
   mantenimiento o cambia UUID, detenerse y volver a verificar por vía independiente. No aceptar
   automáticamente un UUID aprendido de la primera conexión.
6. Exigir que la base ya exista y esté vacía: cero tablas/vistas, triggers, rutinas y eventos.
   No ejecutar `CREATE DATABASE`. Comprobar charset/collation de la base y todas las colaciones del
   volcado; si difieren o no existen, detenerse sin convertirlas. No cambiar grants o configuración
   para conseguir acceso a metadatos: visibilidad insuficiente impide acreditar que está vacía.
7. Obtener del panel de Aiven el uso y espacio disponible actual. `information_schema.TABLES`
   solo estima tablas, no todo el disco disponible. Propuesta de margen: espacio libre mayor que
   `max(10 × tamaño descomprimido estimado, 100 MiB)` y uso total previsto inferior al 80% de la cuota;
   registrar ambos números y revisar crecimiento/binlogs. Son umbrales operativos propuestos,
   no una garantía de capacidad. [Free publica 1 GB de disco y carece de fork](https://aiven.io/docs/products/mysql/concepts/mysql-free-tier);
   no crear un servicio de pago como alternativa automática.
8. Ventana sin escritores acreditada por el responsable. No conectar todavía NestJS de Azure.
   Serializar operadores y volver a comprobar vacío inmediatamente antes del primer CREATE; una
   consulta de conexiones por sí sola no prueba que no aparecerán nuevos escritores.
9. `multipleStatements=false`, `localInfile` deshabilitado y lista de sentencias más estricta por
   objeto. Solo CREATE TABLE del manifiesto e INSERT de literales en esas tablas. Prohibir DROP,
   TRUNCATE, REPLACE, INSERT IGNORE, ON DUPLICATE KEY UPDATE, UPDATE/DELETE operativos, CREATE IF NOT EXISTS,
   USE, DEFINER, SQL externo y cualquier modificación de cuentas o privilegios. Una cadena de datos
   que contenga esas palabras es un literal, no SQL que deba alterarse.
10. Crear esquema con FK deshabilitadas **solo en la sesión**, nunca GLOBAL. No ejecutar los SET del
    archivo sin control: restaurar FOREIGN_KEY_CHECKS y UNIQUE_CHECKS en `finally`, verificar `=1`
    y cerrar la conexión ante fallo. Mantener CHECK activos. Usar UTC de sesión para TIMESTAMP,
    preservar DATE/DATETIME y decimales, conservar modos estrictos; retirar NO_BACKSLASH_ESCAPES solo
    en esa sesión si el formato lo requiere. El ensayo debe detectar cualquier conversión silenciosa.
11. Fallar en el primer error o warning de truncamiento/conversión. DDL tiene commits implícitos;
    no prometer rollback global. No reintentar INSERT automáticamente tras desconexión, porque
    el resultado podría ser incierto. Registrar solo fase/tabla/índice de sentencia y código permitido,
    nunca SQL, valores, contraseñas o trazas.
12. Validar completamente el resultado antes de marcarlo listo; salida no cero ante discrepancia.
    Conservar el destino parcial y no habilitar escritores. Este importador no corrige ni elimina nada.

Pruebas negativas obligatorias: destino equivocado/no vacío, CA/hostname/UUID incorrectos, cuenta
incorrecta, manifiesto ausente/alterado/duplicado, SQL ajeno, colación no compatible, disco insuficiente,
tablas adicionales, fila distinta con mismo recuento, bcrypt alterado, FK huérfana, fallo entre DDL e
INSERT y pérdida de conexión durante INSERT. Verificar ausencia de secretos en stdout/stderr.

## Matriz de integridad para ensayo e importación posterior

Capturar la línea base en la misma ventana consistente del respaldo, dentro del área cifrada. No
comparar una copia antigua con el origen ya modificado. La referencia de aceptación es el manifiesto
aprobado y su inventario complementario, **no ajustar el destino para que coincidan cifras prefijadas**.

| Comprobación | Criterio de aceptación |
| --- | --- |
| Tablas y filas | Nombres exactos de las 30 tablas y COUNT real por cada tabla; total 150 salvo variación del origen documentada y aprobada antes de copiar. `dumped=rows`, también para rate_limit_buckets |
| Historial | Las 18 migraciones activas por nombre, sin aplicar otra vez; conservar también cualquier entrada histórica existente y todas las columnas de horus_migrations. Discrepancias se investigan |
| Estructura | SHOW CREATE TABLE normalizado solo por diferencias de representación de versión verificadas; metadatos de columnas, tipos, defaults, nulabilidad, precisión, generación, motor, PK, índices/orden y AUTO_INCREMENT iguales |
| Colaciones | Charset/collation de base, tablas y columnas idénticos; conservar utf8mb4_0900_ai_ci y utf8mb4_unicode_ci donde correspondan |
| FK | 22 restricciones por identidad, columnas y acciones; consulta explícita de huérfanos por cada FK, incluidas compuestas, cero resultados. Rehabilitar FK no comprueba filas previas |
| CHECK | 37 restricciones por expresión y ENFORCED; comparar metadatos y validar cero violaciones por expresión con la semántica SQL de NULL. Probar rechazo de fixtures inválidos en una base de pruebas separada |
| Valores | Orden por PK compuesta; serialización canónica con tipo/longitud/null, binarios exactos, decimales como texto, dateStrings, UTC para TIMESTAMP y JSON con claves normalizadas. Comparar SHA-256 por fila y tabla sin imprimir valores; las columnas generadas también deben coincidir en valor |
| Administradores | 14 cuentas o variación aprobada; igualdad byte a byte de id, password bcrypt, rol, activo y session_version, fechas y demás columnas. No regenerar hashes ni asignar roles |
| Relaciones lógicas | Comprobar también vínculos de historial sin FK según contratos del proyecto; no confundirlos con las 22 FK declaradas |
| Aplicación | db:check correcto, Prisma sobre el destino aislado, catálogo publicado correcto, login/AccessGuard según el ensayo descrito. Un health 200 no valida los datos |

Los hashes por fila pueden revelar igualdad o facilitar ataques sobre datos de baja entropía: guardar
el inventario complementario solo dentro del paquete cifrado. La consola y el informe público deben
mostrar únicamente cantidades comparadas y aprobación/fallo. El restaurador actual verifica SHA del
volcado, recuentos y FK, **no toda esta matriz**. Debe prepararse y probarse el comparador completo antes
de pedir autorización de importación; en esta entrega queda especificado, no implementado.
MySQL documenta que [reactivar FOREIGN_KEY_CHECKS no revisa lo insertado previamente](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html).

## D. Informe verificado de referencias a imágenes

Lectura local autorizada realizada el 24/10/2026; 178 columnas de texto/JSON/ENUM/SET inspeccionadas
mediante agregados en instantánea READ ONLY. No se exportaron filas ni datos personales. Una segunda
clasificación leyó únicamente los cuatro campos de imagen afectados en memoria, sin imprimir rutas.

| Tabla | Campo | Referencias a uploads | URL localhost | Archivos distintos referenciados |
| --- | --- | ---: | ---: | ---: |
| servicios | imagen_url | 16 | 0 | 16 |
| cursos | imagen_url | 5 | 0 | 5 |
| convenios | logo_url | 4 | 4 | 4 |
| convenio_fotos | imagen_url | 2 | 2 | 2 |
| **Total** | | **27** | **6** | **27** |

Todas las referencias clasificadas tienen path `/api/uploads/<uuid>.png|jpg|webp`; las seis URL
localhost tienen ese mismo formato, sin query ni fragmento. No hubo coincidencias en los otros
campos inspeccionados, ni menciones a `127.0.0.1`, `[::1]` o `backend/uploads/`.
Los agregados del script cuentan celdas por columna; sus categorías se solapan y no deben sumarse
como si fueran referencias independientes. No es una búsqueda de imágenes externas de terceros.

**Discrepancia de archivos:** `backend/uploads` no existe actualmente en este checkout y no aparece
una asignación `UPLOAD_DIR` en el `.env` inspeccionado mediante filtro que ocultó el valor. Por tanto,
los 35 archivos y 16.774 MiB proceden del contexto del responsable; no se verificó su ubicación,
existencia ni correspondencia con estas 27 referencias. No se buscó ni modificó una carpeta alternativa.
Esto no impide copiar la base; sí impide asegurar que los archivos están hoy en esa ruta local.

Efectos previstos por inspección de código, **sin prueba de navegador desplegado**:

- Cursos y servicios perderán sus imágenes donde dependan de estos uploads. `ServiceMedia` ofrece
  el logo genérico ya existente cuando la carga falla; otras vistas que usan un img directo pueden
  mostrar imagen rota o texto alternativo.
- Convenios perderán cuatro logos y dos fotos. `PublicImage` muestra «Sin imagen disponible» tras
  el fallo; la galería de convenio usa img directo y puede mostrar huecos o imagen rota.
- `frontend/src/contentImages.ts` adapta estas seis URL localhost a la API configurada cuando pasan
  por ese normalizador. **No copia ni recupera archivos**: cambiar el host no resolvería la omisión.
  Consumidores que lean la URL cruda intentarían acceder al localhost del visitante.
- `galeria_items.imagen_url` existe en el esquema, pero el inventario no encontró uploads allí;
  no atribuirle imágenes perdidas sin evidencia. Los recursos estáticos del frontend se conservan.

Propuesta posterior al despliegue: conservar primero **todos los registros y referencias originales**
en la copia aceptada; preparar una lista privada por ID y valor anterior cuando se autorice intervenir.
Subir imágenes nuevas aprobadas al almacenamiento definitivo y actualizar solo esos campos usando
el panel/API autenticados. No reutilizar ni copiar los uploads locales descartados. Las fotos de
convenio tienen URL obligatoria: reemplazarlas, no poner NULL ni borrar sus filas. Para campos
opcionales podría aprobarse limpiar mediante el contrato `limpiar` del catálogo, pero eso también
es un cambio de datos independiente; no se hace aquí. Mantener una bitácora privada de valores
anteriores/nuevos y verificar las 27 referencias y seis URL después de cada intervención aprobada.
No proponer un UPDATE global que reemplace localhost por otro dominio sin disponer de las imágenes.

### Repetición del inventario local

`backend/scripts/inventory-migration-images.cjs` no importa dotenv ni Prisma, exige loopback,
horus_db, UUID explícito y `--read-only-local`; devuelve solo agregados. El llamador debe inyectar
DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS, DB_SSL y DB_EXPECTED_SERVER_UUID en un proceso privado;
DB_RSA_PUBLIC_KEY o CA explícitos si el servidor los necesita. No lee el JSON ni DPAPI automáticamente.

```powershell
# Solo después de autorizar la lectura local y cargar las variables en memoria.
Set-Location 'C:\Users\PCT40T\Documents\Proyecto-Horus-\backend'
node scripts/inventory-migration-images.cjs --read-only-local
```

Una cuenta SELECT-only sería preferible, pero crearla no forma parte de este trabajo. En esta sesión
se utilizó la cuenta local migradora existente por autorización expresa, dentro de una transacción
READ ONLY. No se ejecutaron pruebas de escritura para comprobar sus permisos.

## Recuperación parcial, riesgos y próximas autorizaciones

| Situación | Respuesta |
| --- | --- |
| Error antes del primer CREATE | Abortar sin cambios; corregir la preparación fuera de la base y repetir solo con autorización vigente |
| Importación parcialmente aplicada | Conservar destino y registros sanitizados, sin API ni escritores; no repetir sobre tablas existentes, no borrar, no completar manualmente sin diagnóstico/aprobación |
| Se necesita empezar de nuevo | Elegir un destino vacío nuevo y autorizado; si exige un servicio de pago o vaciar la base remota, pedir autorización separada. El migrador sin DROP no debe recibirlo para desbloquear el proceso |
| Falla la aceptación de datos | Mantener MySQL local intacto como origen; no promover Aiven ni cambiar conexión de Azure |
| Falla después de aceptar escrituras remotas | Conservarlas y reconciliar; volver al respaldo local perdería cambios. RPO/RTO y ventana de transición se acuerdan antes de habilitar escritores |
| Clave perdida o segunda copia no verificable | No declarar recuperabilidad ni comenzar la importación |

Riesgos pendientes: archivo sin cifrar durante staging si no se verifica el volumen, memoria/entorno
de procesos, recuperación de claves fuera del equipo, cambios del origen, conversiones MySQL 8.0 → 8.4,
DDL no transaccional, restricciones gestionadas no ensayadas en Aiven, capacidad y conectividad
de Free, imágenes ausentes y riesgos de la imagen backend documentados en
[la preparación de GHCR/Azure](imagen-backend-azure-ghcr.md). Este procedimiento no aprueba exposición pública.

Autorizaciones y trabajos pendientes, separados:

1. Aprobar ubicación temporal cifrada, custodia de claves, segunda copia externa y retención; resolver
   Node 22/7-Zip aprobados y realizar prueba de cifrado/recuperación con archivos ficticios.
2. Implementar y ensayar el importador y comparador completos con fixtures, sin datos reales ni Aiven.
3. Autorizar una ventana local sin escritores, preflight completo, respaldo cifrado real y su copia
   externa; no basta la autorización de lectura limitada recibida para imágenes.
4. Autorizar tratamiento de esa copia en MySQL 8.4.11 desechable y ejecutar toda la matriz.
5. Autorizar por separado conexión de preflight Aiven (solo lectura); obtener UUID por vía independiente,
   verificar vacío, TLS, permisos y capacidad. **Ninguna conexión Aiven está autorizada ahora.**
6. Solo después del ensayo aprobado, autorizar importación real con identidad/UUID/hash fijados y
   ventana sin escritores. No activar init/migrate previamente.
7. En trabajos posteriores: cuenta/secretos de aplicación, conexión Azure, despliegue y sustitución
   de referencias de imágenes requieren sus propias autorizaciones; no se deducen de la migración.

## Verificación de esta entrega

- Inventario local real: 27 referencias, seis localhost, clasificación sin exportar valores;
  `backend/uploads` ausente. No se verificó la línea base completa ni Aiven.
- `node --test -r ./test/isolate-env.cjs test/migration-images.test.cjs`: **5/5**, dobles sin MySQL.
  Comprueba destino/configuración, TLS, bloqueo por UUID, agregados/escapado y cierre tras fallo.
  Node usado: 24.19.0; no equivale a validar el runtime 22 del proyecto.
- Regresión `test/backup-lib.test.ts`, con precarga aislada y ts-node: **16/16** sin base real.
  `node --check` correcto; cuatro bloques PowerShell analizados con el parser de **PowerShell 5.1**,
  sin errores de sintaxis. Enlaces relativos existentes, sin espacios finales; `git diff --check` correcto.
- No se ejecutaron respaldo, descifrado DPAPI, cifrado real, restauración, importador, db:check,
  Docker, NestJS, pruebas de navegador ni servicios externos reales.

Guías relacionadas: [backup/restore existentes](backup-restauracion.md),
[preparación general Aiven](aiven-mysql-preparacion-segura.md),
[ensayo histórico de permisos](ensayo-horus-migrator-20261024.md).
