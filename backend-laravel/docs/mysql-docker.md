# MySQL Docker dedicado de Laravel: preparación y activación futura

Estado: configuración preparada, **sin construir ni arrancar servicios nuevos**, sin crear
`horus_group`, cambiar `.env`, migrar ni trasladar datos. La activación de este documento
requiere autorización posterior y una ventana acordada; los comandos son instrucciones,
no evidencia de ejecución. Ejecutarlos desde `backend-laravel/` en PowerShell y comprobar
`$LASTEXITCODE` después de cada comando nativo; detenerse ante cualquier error.

## Arquitectura

Se combina `compose.yaml` con `compose.mysql.yaml`, conservando el proyecto
`horus-laravel`, PHP y Nginx. El Compose base queda disponible para recuperación.
No se usa el Compose ni el archivo de entorno de NestJS.

| Recurso efectivo (sin cambiar el proyecto) | Uso |
| --- | --- |
| `horus-laravel-mysql-laravel-1` | MySQL oficial `mysql:8.4`, sin puertos publicados |
| `horus-laravel_mysql_datos` | Volumen exclusivo en `/var/lib/mysql` |
| `horus-laravel_mysql_privada` | Bridge `internal: true`; solo `app` y `mysql-laravel` |
| `horus-laravel_laravel` | Red existente de `app` y `web`; MySQL no pertenece a ella |
| `127.0.0.1:8082` | Acceso HTTP local a Laravel, conservado |
| `horus_group` | Nombre futuro fijado en PHP; creación manual posterior |

No hay subred fija, redes externas ni `container_name`. Docker asignará una subred libre;
revisarla antes de activar, especialmente si cambian VPN o rutas. Nginx y NestJS no se unen
a la red de MySQL. El operador con acceso al daemon sigue teniendo acceso administrativo:
esta separación no protege frente al administrador de Docker.

MySQL limita memoria a 768 MiB, reserva orientativa 256 MiB, CPU a 1 y procesos a 256.
Buffer InnoDB de 128 MiB y 40 conexiones máximas. PHP conserva 768 MiB / 1 CPU y Nginx
64 MiB / 0,25 CPU: suma de límites Laravel 1600 MiB / 2,25 CPU. Son valores iniciales,
sin prueba de carga ni medición del arranque. Construir imágenes puede usar más memoria.
UTC, `utf8mb4_unicode_ci`, autenticación predeterminada de MySQL 8.4, sin habilitar
`mysql_native_password`; protocolo X deshabilitado. Reinicio `unless-stopped`, apagado
con margen de 60 s y logs rotados (10 MiB × 3). Un estado unhealthy no provoca por sí solo
un reinicio. El healthcheck autentica root por socket y consulta `SELECT 1`; no acredita
la existencia de `horus_group`, las tablas ni su integridad.

No se define `MYSQL_DATABASE`, `MYSQL_USER` ni scripts `initdb`, para separar el primer
arranque del servidor de la creación autorizada de la base y las cuentas. Tampoco hay
migraciones, seeders o traslado en el arranque de PHP.

## Archivos privados externos

Preparar posteriormente una carpeta privada **fuera del repositorio**, con ACL solo para
el operador y SYSTEM; permitir a Docker Desktop leer los archivos necesarios. No copiar
el `.env` completo ni claves de NestJS. No guardar secretos en argumentos, historial,
capturas, registros, Git o transcripciones. No mostrar `compose config` completo ni
`inspect .Config.Env` con archivos reales.

Crear tres archivos de interpolación independientes (sin extensión obligatoria):

- `laravel-app.env`: cuenta de ejecución `horus_group_app`.
- `laravel-operador.env`: cuenta de migración/traslado `horus_group_operador`.
- `laravel-ensayo.env`: cuenta temporal `horus_group_ensayo`, solo para la base de ensayo.

Cada uno debe contener estas variables, con los valores privados propios de su cuenta:

| Variable | Valor |
| --- | --- |
| `HORUS_LARAVEL_APP_KEY` | APP_KEY privada estable; conservar la clave actual si protege datos existentes |
| `HORUS_LARAVEL_DB_USERNAME` | Cuenta correspondiente al archivo, nunca root ni la cuenta de NestJS |
| `HORUS_LARAVEL_DB_PASSWORD` | Contraseña aleatoria exclusiva de esa cuenta |
| `HORUS_LARAVEL_MYSQL_ROOT_PASSWORD_FILE` | Ruta absoluta con `/`, externa, al archivo `mysql-root.password` |
| `HORUS_LARAVEL_HTTP_PORT` | `8082` |
| `HORUS_LARAVEL_APP_URL` | `http://127.0.0.1:8082` |
| `HORUS_LARAVEL_SECURE_COOKIE` | `false` solo para este HTTP local |

No definir `HORUS_LARAVEL_DB_HOST`, `DB_PORT` ni `DB_DATABASE` para seleccionar otro
servidor: el complemento fija `mysql-laravel:3306/horus_group`. Los overrides de ensayo
se hacen explícitamente con `run -e DB_DATABASE=...`.

`mysql-root.password` contendrá solo una contraseña aleatoria fuerte, sin BOM ni espacios
finales. La clave root se monta mediante un secreto Compose, exclusivamente en MySQL,
y root solo se crea para `localhost`. PHP conserva el contrato del Compose base:
sus credenciales y APP_KEY proceden del archivo externo de interpolación. Quien administra
Docker puede ver esas variables. Los secretos Compose locales son montajes de archivos,
no una bóveda cifrada; proteger también los originales y sus copias.

## Activación posterior: inventario y primer arranque

1. Repetir el inventario y comprobar espacio real del disco anfitrión, RAM disponible y
   `8082`. Verificar que los nombres anteriores no existen; si aparece un recurso con el
   mismo nombre, **detenerse y verificar su propietario**, sin reutilizarlo ni borrarlo.
   Confirmar que NestJS mantiene sus tres contenedores saludables y anotar sus IDs,
   red y volumen. Registrar el estado HTTP de `http://127.0.0.1:8081/api/health`.

2. Crear y proteger los archivos privados. Preparar las rutas reales y los argumentos:

   ```powershell
   $privado = 'C:/ruta/privada/horus-laravel'
   $dcApp = @('--env-file', "$privado/laravel-app.env", '-p', 'horus-laravel', '-f', 'compose.yaml', '-f', 'compose.mysql.yaml')
   $dcOperador = @('--env-file', "$privado/laravel-operador.env", '-p', 'horus-laravel', '-f', 'compose.yaml', '-f', 'compose.mysql.yaml')
   $dcEnsayo = @('--env-file', "$privado/laravel-ensayo.env", '-p', 'horus-laravel', '-f', 'compose.yaml', '-f', 'compose.mysql.yaml')
   docker compose @dcApp config --quiet
   docker compose @dcOperador config --quiet
   docker compose @dcEnsayo config --quiet
   ```

   Revisar antes que ninguna variable `HORUS_LARAVEL_*` heredada en la sesión sustituya
   los archivos privados (las variables del proceso tienen prioridad). No imprimir sus valores.

3. Bajo autorización, construir solo las imágenes Laravel y crear únicamente su servidor
   MySQL. Registrar previamente el ID/digest de la imagen elegida: `mysql:8.4` puede cambiar
   de parche; no hacer actualizaciones implícitas de un servidor con datos.

   ```powershell
   docker compose @dcApp build app web
   docker image inspect mysql:8.4 --format '{{.Id}} {{json .RepoDigests}}'
   docker compose @dcApp up -d --no-deps --wait --wait-timeout 180 mysql-laravel
   docker compose @dcApp ps
   ```

   Esto inicializa el directorio de datos y las bases de sistema de un volumen nuevo,
   **todavía sin `horus_group`**. No montar ni reutilizar volúmenes previos. Si el arranque
   falla, revisar el motivo; nunca intentar corregirlo borrando el volumen.

4. Abrir una consola administrativa sin contraseña en argumentos ni historial SQL:

   ```powershell
   docker compose @dcApp exec -e MYSQL_HISTFILE=/dev/null mysql-laravel mysql --protocol=socket -uroot -p
   ```

   Introducir root solo en el prompt protegido. Consultar antes de cualquier escritura:

   ```sql
   SELECT @@server_uuid, @@version, @@hostname, @@port,
          @@global.time_zone, @@character_set_server, @@collation_server;
   SHOW DATABASES;
   SELECT User, Host FROM mysql.user;
   ```

   Registrar UUID junto al ID del contenedor, digest y nombre del volumen en el registro
   privado de operación. Verificar que corresponde al servidor nuevo y que no aparecen
   `horus_db`, `horus_local` ni una `horus_group` previa. Si aparecen, detenerse.
   El UUID se conserva en el volumen; recrear el contenedor no debe cambiarlo.

## Ensayo previo en una base temporal

5. Crear un respaldo nuevo y verificado sin modificar la SQLite habitual. PHP del anfitrión
   debe tener las extensiones ya instaladas; no instalar nada por rutina:

   ```powershell
   $copias = "$privado/copias" # carpeta privada existente, separada de las credenciales
   php scripts/backup-sqlite.php --origen=database/database.sqlite "--directorio=$copias"
   ```

   Conservar el archivo nuevo y su manifiesto; usar la ruta exacta que devuelve el script.
   Este respaldo nativo incluye WAL confirmado y comprueba restauración, firmas y relaciones.
   No copiar a ciegas una SQLite abierta. Proteger el respaldo (contiene hashes y datos
   personales). Leer [mysql-traslado.md](mysql-traslado.md) antes del ensayo.

6. Elegir un identificador temporal nuevo, admitido por `DestinoMysqlLaravel`:
   `horus_laravel_it_` seguido de 16 caracteres hexadecimales. En los ejemplos siguientes
   se usa `horus_laravel_it_0123456789abcdef`: comprobar que no existe y sustituirlo por
   uno nuevo en **todos** los comandos. En la consola root verificada del paso 4:

   ```sql
   CREATE DATABASE `horus_laravel_it_0123456789abcdef` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'horus_group_ensayo'@'%' IDENTIFIED BY '<clave privada del archivo de ensayo>';
   GRANT ALL PRIVILEGES ON `horus\_laravel\_it\_0123456789abcdef`.* TO 'horus_group_ensayo'@'%';
   ```

   Los textos entre `<...>` se sustituyen solo en la sesión privada, nunca en Git.
   Escapar las contraseñas como literales SQL si contienen comillas o barras. El patrón
   del GRANT escapa `_` para no conceder acceso a otros nombres. `%` permite las IP
   dinámicas de PHP en la red dedicada; no publica el servicio. No otorgar privilegios
   globales ni acceso a otras bases.

7. Migrar y ensayar usando la cuenta temporal, sin arrancar `app` ni `web`:

   ```powershell
   $ensayo = 'horus_laravel_it_0123456789abcdef'
   $copia = "$copias/sqlite-<identificador-del-respaldo>.sqlite"
   $nombreCopia = Split-Path -Leaf $copia
   $origenContenedor = "--origen=/operacion/$nombreCopia"
   $montaje = "$($copias):/operacion:ro"
   docker compose @dcEnsayo run --rm --no-deps -e "DB_DATABASE=$ensayo" app php artisan migrate --force
   docker compose @dcEnsayo run --rm --no-deps -e "DB_DATABASE=$ensayo" --volume $montaje app php artisan horus:trasladar-sqlite-mysql $origenContenedor
   docker compose @dcEnsayo run --rm --no-deps -e "DB_DATABASE=$ensayo" --volume $montaje app php artisan horus:trasladar-sqlite-mysql $origenContenedor --aplicar --yes
   ```

   Montar una carpeta que contenga **solo las copias**, nunca la carpeta con contraseñas.
   El montaje es de solo lectura; comprobar que PHP pueda leer la copia.
   Exigir salida 0, firmas y recuentos coincidentes y ausencia de avisos no resueltos.
   El primer traslado simula con rollback; el segundo confirma únicamente en la base
   temporal. El comando conserva IDs y relaciones y valida las claves foráneas.
   No ejecutar la suite `phpunit.mysql.xml` sobre el servidor definitivo: su bootstrap
   exige loopback y ausencia de `horus_group`, y crea/elimina bases de pruebas.

## Crear y activar `horus_group`

8. Acordar y autorizar una ventana sin escrituras **solo de Laravel**, incluyendo panel,
   API y trabajadores que lo usen. NestJS continúa funcionando. Repetir el respaldo nativo
   del paso 5 durante esa ventana y usar esa nueva copia estable para el traslado final.
   Conservar `.env`, SQLite, APP_KEY y configuración anterior para recuperación.

9. Volver a consultar `@@server_uuid` por la consola root y compararlo con el registro.
   Comprobar que `horus_group` sigue sin existir. Solo entonces:

   ```sql
   CREATE DATABASE `horus_group` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'horus_group_operador'@'%' IDENTIFIED BY '<clave privada del operador>';
   CREATE USER 'horus_group_app'@'%' IDENTIFIED BY '<clave privada de ejecución>';
   GRANT ALL PRIVILEGES ON `horus\_group`.* TO 'horus_group_operador'@'%';
   GRANT SELECT, INSERT, UPDATE, DELETE ON `horus\_group`.* TO 'horus_group_app'@'%';
   SHOW GRANTS FOR 'horus_group_operador'@'%';
   SHOW GRANTS FOR 'horus_group_app'@'%';
   ```

   El operador no tiene `GRANT OPTION` ni privilegios globales; no se usa para servir PHP.
   La cuenta de ejecución no puede migrar ni ajustar `AUTO_INCREMENT`.

10. Aplicar migraciones y trasladar con el operador exclusivo. Montar la carpeta de la
    **nueva copia final** en `/operacion`, solo lectura, como en el paso 7. Actualizar
    `$copia`, `$nombreCopia` y `$origenContenedor` para no usar el respaldo del ensayo:

    ```powershell
    docker compose @dcOperador run --rm --no-deps app php artisan migrate --force
    docker compose @dcOperador run --rm --no-deps app php artisan migrate:status
    docker compose @dcOperador run --rm --no-deps --volume $montaje app php artisan horus:trasladar-sqlite-mysql $origenContenedor --aplicar --yes --informe=storage/app/private/traslado-mysql.json
    ```

    El informe persiste en `horus-laravel_archivos`; copiarlo después a la carpeta privada.
    El comando exige tablas migradas vacías, rechaza tablas ajenas, valida datos, firmas,
    recuentos y relaciones antes de confirmar. No repetir sobre una base ya poblada ni
    vaciarla para reintentar. MySQL DDL no se revierte como una transacción: si falla una
    migración, revisar el estado antes de actuar.

11. Exigir salida 0, firmas normalizadas coincidentes, claves foráneas válidas y ausencia
    de avisos de ajuste de `AUTO_INCREMENT`. Comparar `origen_sha256` del informe con
    `archivo_sha256` del manifiesto SQLite y los recuentos de las tablas trasladadas.
    Los hashes por tabla del respaldo usan otra representación y no se comparan con las
    firmas normalizadas del traslado. Las tablas efímeras y `migrations` no se trasladan.
    Para comprobar además la conexión de **la cuenta de ejecución**, crear posteriormente
    `verificar.php` en la
    carpeta privada de copias con este contenido (solo lectura):

    ```php
    <?php
    require '/var/www/html/vendor/autoload.php';
    try {
        $app = require '/var/www/html/bootstrap/app.php';
        $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
        $db = Illuminate\Support\Facades\DB::connection();
        $r = $db->selectOne('SELECT DATABASE() AS db, @@server_uuid AS uuid, @@session.time_zone AS tz');
        $ajenas = $db->selectOne("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND ENGINE <> 'InnoDB'");
        if ($r->db !== 'horus_group' || $r->tz !== '+00:00'
            || strtolower($r->uuid) !== strtolower($argv[1] ?? '') || (int) $ajenas->n !== 0) {
            throw new RuntimeException('Destino incorrecto.');
        }
        echo "Conexión, UUID, UTC e InnoDB verificados.\n";
    } catch (Throwable) {
        fwrite(STDERR, "Verificación fallida; no abrir escrituras.\n");
        exit(1);
    }
    ```

    ```powershell
    $uuidEsperado = '<UUID registrado y comprobado en el paso 4>'
    docker compose @dcApp run --rm --no-deps --volume $montaje app php /operacion/verificar.php $uuidEsperado
    ```

    Este archivo no muestra contraseñas. Exigir salida 0 y revisar también las
    migraciones aplicadas. No abrir web hasta resolver cualquier diferencia.

12. Arrancar con **el archivo de ejecución**, nunca con el de operador:

    ```powershell
    docker compose @dcApp up -d --no-deps --wait app
    docker compose @dcApp up -d --no-deps --wait web
    docker compose @dcApp ps
    Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8082/up
    ```

    La activación usa variables de contenedor; no requiere editar el `.env` habitual.
    Mantener apagados contenido público y autenticación pública como en el Compose base.
    No generar claves ni ejecutar `config:cache` con credenciales de operador.

13. Verificar manualmente `http://127.0.0.1:8082/gestion`: login con una cuenta existente,
    listas y detalles académicos, relaciones, navegación y peticiones Livewire sin 419/500.
    Las sesiones no se trasladan: se requiere volver a iniciar sesión. No crear cuentas,
    cambiar roles ni guardar registros de prueba reales para verificar la interfaz.
    `/up` y el healthcheck de MySQL por sí solos no validan este flujo.

## Respaldo MySQL y restauración

14. Generar un respaldo lógico con root local, sin exponer la clave ni transportar SQL
    por una redirección PowerShell que pueda cambiar su codificación:

    ```powershell
    docker compose @dcApp exec -T mysql-laravel sh -c 'umask 077; export MYSQL_PWD=$(cat /run/secrets/mysql_root_password); exec mysqldump --protocol=socket -uroot --single-transaction --quick --no-tablespaces --set-gtid-purged=OFF --default-character-set=utf8mb4 --hex-blob --routines --events --triggers --result-file=/tmp/horus-group-respaldo.sql horus_group'
    docker compose @dcApp cp mysql-laravel:/tmp/horus-group-respaldo.sql "$privado/horus-group-<fecha-unica>.sql"
    Get-FileHash -Algorithm SHA256 "$privado/horus-group-<fecha-unica>.sql"
    docker compose @dcApp exec -T mysql-laravel rm /tmp/horus-group-respaldo.sql
    ```

    Usar un nombre externo nuevo, comprobar tamaño no cero y código 0 de dump/copia antes
    de retirar el temporal. No ejecutar DDL mientras dura `--single-transaction`.
    Registrar UUID, digest, migraciones, hash y fecha UTC en un manifiesto privado.
    Respaldar también `horus-laravel_archivos`, APP_KEY y archivos privados; no incluirlos
    en imágenes ni Git. El dump no contiene las cuentas del servidor: conservar sus
    instrucciones/credenciales separadas y protegidas. Cifrar copias externas.

15. Un dump y un hash no demuestran restauración. Ensayarla bajo autorización en **otro
    servidor MySQL 8.4 desechable**, con UUID diferente y volumen nuevo, sin apuntar nunca
    al contenedor definitivo o a NestJS. Crear allí una base vacía; cargar el dump mediante
    `mysql --default-character-set=utf8mb4 < archivo.sql` dentro del contenedor, usando
    credenciales privadas. Comparar esquema, recuentos, firmas y cada relación con el
    manifiesto original antes de considerar verificado el respaldo. No restaurar sobre
    `horus_group` existente ni reutilizar el volumen definitivo.

16. Confirmar que los tres contenedores `horus-local-*` conservan IDs, red y montajes,
    siguen saludables y que `http://127.0.0.1:8081/api/health` y el sitio público responden.
    Registrar una muestra nueva de `docker stats --no-stream`; investigar presión de RAM,
    swap, reinicios u OOM antes de abrir la ventana de escrituras Laravel.

## Recuperación

Ante un fallo de activación, mantener cerradas las escrituras Laravel y conservar evidencia.
No tocar NestJS, borrar volúmenes, usar `down -v`, `prune`, seeders o migraciones destructivas.
Mantener `compose.yaml`, `.env` y SQLite anteriores; el complemento es optativo.
Volver al proceso local SQLite con la configuración anterior solo tras confirmar que MySQL
no recibió nuevas escrituras que se perderían: si las hubo, acordar reconciliación primero.
El Compose base usa MySQL externo y **no es un retorno automático a SQLite**.
Después de la activación, rotar o bloquear el operador cuando no se use, bajo autorización;
quitar el archivo secreto no cambia la contraseña persistida en MySQL. Cambios de clave,
actualizaciones y eliminación del ensayo requieren procedimientos y autorización propios.

Referencias oficiales: [imagen MySQL](https://hub.docker.com/_/mysql/),
[secretos Compose](https://docs.docker.com/compose/how-tos/use-secrets/),
[redes Compose](https://docs.docker.com/reference/compose-file/networks/) y
[mysqldump 8.4](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html).
