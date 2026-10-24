# Aiven MySQL: preparación de seguridad y activación futura

Preparado el **23/10/2026, America/Lima** para el proyecto `horus-group-dev`, servicio
`mysql-1b22a7e2`, base remota declarada `horus_db`, MySQL **8.4.11 Free**.
Los identificadores de proyecto y servicio proceden de la preparación anterior y deben reconfirmarse;
la solicitud actual confirma el nombre de base y la versión, no esos identificadores.
**No se conectó ni se modificó el servicio Aiven**.
No se trasladaron cuentas, contraseñas ni datos de MySQL local. Los comandos de activación de esta guía
son una propuesta para una ventana posterior autorizada.

La continuación del **24/10/2026** revalidó las referencias oficiales sobre `mysql_grants` y el plan Free,
sin consultar el servicio remoto ni crear, cambiar o rotar credenciales. La imagen candidata y las pruebas
se identifican en [la entrega local](seguridad-docker-aiven-20261023.md); los
[ocho avisos altos de Debian](debian-imagen-backend-20261024.md) permanecen clasificados, sin aceptación
implícita de riesgo. El procedimiento de publicación futura está en [GHCR](imagen-backend-azure-ghcr.md).

## Siguiente procedimiento: privilegios disponibles, solo lectura

Preparado el **24/10/2026**, sin ejecución remota. La autorización de los cuatro commits locales
no autoriza conectar con Aiven. Una ventana posterior de lectura debe limitarse a lo siguiente:

1. Reconfirmar proyecto, servicio, plan Free, versión, DNS, puerto, CA y UUID esperado por una vía
   independiente de la conexión que se va a comprobar. Consultar solo los metadatos necesarios y
   mantenimiento pendiente, sin exportar respuestas completas que puedan contener credenciales.
2. Usar una cuenta **ya existente y autorizada**, con contraseña interactiva, cliente MySQL 8.4,
   `--ssl-mode=VERIFY_IDENTITY` y CA del proyecto. Conectar inicialmente **sin seleccionar una base**.
   No crear `horus_app` ni `horus_migrator` para esta comprobación ni reutilizar credenciales locales.
3. Ejecutar únicamente estas consultas de identidad, TLS y permisos de la sesión:

```sql
SELECT @@server_uuid, VERSION(), CURRENT_USER(), DATABASE(), CURRENT_ROLE();
SHOW SESSION STATUS LIKE 'Ssl_cipher';
SHOW SESSION STATUS LIKE 'Ssl_version';
SHOW GRANTS;
SELECT ROLE_NAME, ROLE_HOST, IS_DEFAULT, IS_MANDATORY
  FROM information_schema.ENABLED_ROLES;
SELECT @@GLOBAL.partial_revokes, @@GLOBAL.mandatory_roles,
       @@GLOBAL.activate_all_roles_on_login;
```

4. Detenerse si identidad o TLS no coinciden. Revisar en privado los grants directos, roles asignados
   y activos, restricciones `REVOKE`, alcance de esquema/tabla y `GRANT OPTION`. Si hay roles,
   preparar manualmente `SHOW GRANTS FOR CURRENT_USER() USING <ROLES_ASIGNADOS_VERIFICADOS>` con los
   nombres/hosts exactos devueltos; es una plantilla, no SQL ejecutable con el marcador. No cambiar
   roles con `SET ROLE`. Si una consulta está denegada, registrar esa limitación y detener la evaluación
   dependiente; no conceder permisos para continuar. Consultar el comportamiento de
   [SHOW GRANTS](https://dev.mysql.com/doc/refman/8.4/en/show-grants.html) y los
   [roles activos](https://dev.mysql.com/doc/refman/8.4/en/information-schema-enabled-roles-table.html).
5. Comparar los permisos delegables de la cuenta operadora con la matriz de esta guía. Registrar
   por separado: permisos observados, capacidad de delegación y soporte gestionado de `mysql_grants`.
   Los grants SQL no acreditan que el servicio admita crear usuarios con `mysql_grants: []`.
   La [documentación Aiven](https://aiven.io/docs/products/mysql/howto/manage-service-users) exige
   soporte del servicio; si sus metadatos no lo confirman, conservarlo como **pendiente de confirmar
   con el proveedor**, sin probar un POST de creación ni aplicar mantenimiento.
6. Entregar un informe privado con identidad cotejada, TLS, grants/roles, diferencias frente a la
   matriz y capacidades confirmadas o pendientes. No incluir contraseñas, tokens, hashes de
   autenticación ni datos de negocio. No consultar `mysql.user` ni ejecutar pruebas negativas de
   escritura: un permiso inesperado podría hacerlas efectivas.

El procedimiento termina con el informe. No ejecuta `CREATE USER`, `ALTER USER`, `GRANT`, `REVOKE`,
`FLUSH PRIVILEGES`, DDL/DML, migraciones ni cambios de configuración. Una concesión existente no
demuestra que puedan aprovisionarse las cuentas propuestas; esa activación requiere otra autorización.

## Cuentas y límites de mysql_grants

La [documentación oficial de usuarios](https://aiven.io/docs/products/mysql/howto/manage-service-users)
permite restringir los privilegios al crear un usuario mediante la API:

- Omitir `mysql_grants` concede los privilegios administrativos predeterminados: evitarlo.
- `mysql_grants: []` crea una identidad que puede conectar, sin concesiones de datos iniciales.
- Es una lista de tipos de privilegio; no contiene selectores de esquema o tabla.
- `CREATE USER` y `ROLE_ADMIN` permiten delegar las concesiones: excluirlos de ambas cuentas.
- Requiere soporte de granular grants en el servicio; si falta, la petición responde HTTP 400.
  No repetir omitiendo el campo. Revisar mantenimiento en otra operación autorizada.

La guía no establece una exclusión por plan Free, pero tampoco acredita la capacidad de este servicio concreto.
**Compatibilidad documental condicionada; soporte efectivo pendiente de verificar.**
Consultar versión y mantenimiento del servicio antes de autorizar altas; no usar una creación de prueba
como comprobación de solo lectura.

Propuesta de cuerpos de creación, **no ejecutados**, para el endpoint
`POST /v1/project/horus-group-dev/service/mysql-1b22a7e2/user`:

```json
{"username":"horus_app","mysql_grants":[]}
```

```json
{"username":"horus_migrator","mysql_grants":[]}
```

El token administrativo Aiven pertenece al proceso de aprovisionamiento, nunca a NestJS ni al contenedor.
Guardar la respuesta que contiene la contraseña en el gestor privado; no imprimirla ni versionarla.
Obtener el host SQL efectivo de cada identidad mediante `CURRENT_USER()` en una conexión sin base seleccionada.
No suponer `localhost`: la identidad gestionada puede usar `%`. Limitar el acceso de red por separado,
con las opciones disponibles del servicio y la salida efectiva de Azure.

Después de crear las identidades vacías, un administrador autorizado otorgaría **por SQL** los permisos exactos.
Los privilegios globales de MySQL se acumulan con los de tabla: no conceder primero DML global para luego intentar
restringirlo añadiendo concesiones por tabla. Revisar `SHOW GRANTS`, roles asignados y roles activos.
Si la plataforma no permite conservar esta matriz, detener la preparación y documentar la diferencia;
no sustituirla por `ALL PRIVILEGES` ni usar `avnadmin` en la API.

## Matriz recomendada

Reutilizar la [matriz local documentada](privilegios-mysql-propuesta.md), después de comprobar el esquema remoto.
La cuenta, su host, su contraseña y su servidor serán nuevos; la matriz es la única referencia que se reutiliza.

| Cuenta | Concesiones propuestas |
| --- | --- |
| `horus_app` | Los 27 GRANT por tabla indicados abajo. Sin DDL, administración, delegación ni acceso al registro de migraciones. |
| `horus_migrator` | `SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES` exclusivamente en `horus_db`.*. Sin DROP ni privilegios globales. |
| Respaldo opcional | SELECT en `horus_db`.*; solo crear una tercera cuenta si se autoriza automatizar las copias. Para copias manuales puede utilizarse el migrador. |
| Recuperación | Operador separado en un servidor de ensayo; crear un destino `horus_restore_*` requiere permisos que no se conceden a la API ni preventivamente al migrador. |

| Operaciones de horus_app | Tablas |
| --- | --- |
| SELECT, INSERT, UPDATE, DELETE | `admin_items`, `servicios`, `contactos`, `galeria_items`, `rate_limit_buckets`, `convenios`, `convenio_fotos`, `chatbot_preguntas_sin_respuesta` |
| SELECT, INSERT, UPDATE | `admin_users`, `cursos`, `preguntas_frecuentes`, `cotizaciones`, `newsletter_subscribers`, `empresa_settings`, `attention_records`, `estudiantes`, `convocatorias`, `matriculas`, `preinscripciones` |
| SELECT, INSERT | `admin_auditoria`, `reclamaciones`, `importaciones_academicas`, `academico_historial`, `preinscripciones_historial` |
| SELECT, INSERT, DELETE | `convocatoria_horarios`, `chatbot_interacciones` |
| SELECT | `certificados` |

No conceder a la API acceso a `horus_migrations`, `docentes` ni `docente_asignaciones`.
No necesita `FILE`, `SUPER`, `SYSTEM_VARIABLES_ADMIN`, `PROCESS`, `CREATE USER`, `ROLE_ADMIN`, `GRANT OPTION`,
`CREATE DATABASE`, `DROP` o `LOCK TABLES`. El bloqueo transaccional `SELECT ... FOR UPDATE` no equivale a `LOCK TABLES`.

Ejemplo de alcance del migrador, **solo después de autorización y comprobación del host SQL real**:

```sql
-- Primero: SELECT @@GLOBAL.partial_revokes;
-- Solo con partial_revokes=OFF: escapar el guion bajo del nombre de esquema.
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON `horus\_db`.* TO 'horus_migrator'@'<HOST_SQL_EFECTIVO>';
-- Con partial_revokes=ON usar `horus_db`.* en su lugar, sin barra invertida.
```

Las 27 concesiones de aplicación se incluyen completas al final, para revisar una por una después de existir las tablas.
Comparar concesiones efectivas con la lista; comprobar denegaciones de DDL, administración, historiales y tablas excluidas
mediante un arnés desechable antes de activar la cuenta real. No probar una denegación destructiva en producción:
si el permiso estuviera mal concedido, la sentencia podría ejecutarse.

## TLS y pruebas de conexión preparadas

[Aiven exige su CA de proyecto para VERIFY_CA/VERIFY_IDENTITY](https://aiven.io/docs/platform/concepts/tls-ssl-certificates).
Usar el hostname DNS de Connection information, su puerto real y la CA descargada del proyecto correcto.
No usar una IP, un alias arbitrario, una CA local ni una URL con contraseña.

El backend ya consume `DB_SSL=true` y `DB_SSL_CA` como **contenido PEM**, con saltos reales o `\n` literales.
`PrismaService` usa el conector MariaDB actualizado con `rejectUnauthorized: true`; conserva su verificación de identidad.
Los scripts `mysql2` incorporan además `verifyIdentity: true`, necesario para comprobar el hostname en ese conector.
No configurar `NODE_TLS_REJECT_UNAUTHORIZED=0` ni `rejectUnauthorized: false`.

La sonda nueva `backend/scripts/check-mysql-tls.cjs` no carga `.env` ni Prisma y solo ejecuta SELECT y SHOW SESSION STATUS.
Prueba `mysql2` y el mismo conector MariaDB que resuelve el adaptador Prisma. Exige UUID esperado, base y CA explícitos;
comprueba identidad y cipher de ambas sesiones, sin mostrar secretos. Requiere Node 22 y las dependencias corregidas.

```powershell
# En una sesión nueva, con configuración Aiven inyectada por el gestor privado:
# DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS, DB_SSL=true, DB_SSL_CA,
# DB_EXPECTED_SERVER_UUID obtenido previamente del servicio correcto.
node scripts/check-mysql-tls.cjs
```

Alternativa de comprobación SQL manual, con contraseña solicitada de forma interactiva:

```powershell
mysql --host=<DNS_AIVEN> --port=<PUERTO_AIVEN> --user=horus_app --password `
  --ssl-mode=VERIFY_IDENTITY --ssl-ca=<RUTA_PRIVADA_CA> horus_db
```

```sql
SELECT @@server_uuid, VERSION(), DATABASE(), CURRENT_USER();
SHOW SESSION STATUS LIKE 'Ssl_cipher';
SHOW SESSION STATUS LIKE 'Ssl_version';
SHOW GRANTS;
```

**Ejecutado exclusivamente en un MySQL 8.4.11 propio:** CA correcta aceptada por ambos conectores;
CA incorrecta, hostname incorrecto y UUID incorrecto rechazados. El ensayo usa certificados ficticios de corta duración,
una red interna y ninguna credencial real. La verificación real de Aiven permanece pendiente.
La rotación de CA exige actualizar el bundle en los clientes antes del cambio del servicio; no se resuelve desactivando TLS.

## Las 18 migraciones y la activación futura

`scripts/migrate.cjs` registra **18 migraciones activas**, además del SQL inicial `00000000-initial`.
La migración de sesiones está retirada y no debe aplicarse. Docentes conserva sus tablas históricas.
El SQL actual usa InnoDB, PK, FK, CHECK, ENUM, columnas generadas e índices compatibles con MySQL 8.4.
No necesita SUPER, DEFINER, FILE, tablas del sistema ni cambiar variables globales.

[Aiven exige PK por defecto](https://aiven.io/docs/products/mysql/howto/create-tables-without-primary-keys).
El ensayo de esta entrega impuso `sql_require_primary_key=ON` y transporte TLS obligatorio: inicialización y las
18 migraciones con un migrador sin DROP, segunda ejecución idempotente y `db:check` correctos; 30 tablas, todas con PK.
Esto acredita MySQL **8.4.11 desechable**, no el servicio gestionado ni sus permisos efectivos.
Revalidar en Aiven versión, `sql_mode`, charset/collation, zona horaria, PK, permisos, capacidad y restricciones del servicio.

Secuencia propuesta, pendiente de autorización de activación:

1. Revisar la imagen y sus riesgos residuales. Fijar digest, código, lockfile y copias de recuperación.
2. Confirmar proyecto, servicio, DNS, puerto, versión, UUID y `DATABASE()`. Distinguir expresamente este `horus_db` del local.
3. Preparar usuarios vacíos y concesiones de mantenimiento según el procedimiento anterior, con secretos separados.
4. Comprobar TLS. Pausar todos los escritores y confirmar que la base remota sigue vacía; si contiene tablas, detenerse.
5. Crear un respaldo remoto previo, verificar firma/contenido y ensayar recuperación en otro servidor propio.
   Guardar también configuración de concesiones y referencias de secretos en el gestor; no exportar `mysql.user`.
6. En un proceso de mantenimiento con configuración explícita y sin `.env` local: `node scripts/init-database.cjs`,
   seguido de `node scripts/migrate.cjs` y `node scripts/check-database.cjs`. No ejecutar Prisma Migrate.
7. Confirmar 18 registros activos, 30 tablas, restricciones y cero contenido inventado; revisar cada concesión de aplicación.
8. Comprobar la cuenta de aplicación y programar un respaldo posterior. La primera cuenta administrativa de Horus requiere
   autorización separada; no copiar `admin_users` ni ejecutar `admin:create` implícitamente.
9. Solo en una operación de despliegue autorizada: configurar Azure con `horus_app`, probar el arranque y los flujos convenidos.

MySQL confirma cada DDL de forma independiente. Un error exige inspección del estado parcial y del registro;
no borrar tablas, marcar migraciones como aplicadas ni restaurar encima del destino automáticamente.

## Respaldo y recuperación en Free

El [plan Free](https://aiven.io/docs/products/mysql/concepts/mysql-free-tier) documenta un nodo, 1 GB de disco,
1 GB de RAM, máximo 76 conexiones, respaldos y ausencia de SLA, VPC y forking.
No presuponer PITR operativo ni retención de varios días: la [retención depende del plan](https://aiven.io/docs/products/mysql/concepts/mysql-backups)
y debe comprobarse en el servicio. No diseñar la recuperación alrededor de un fork que Free no permite.

Mantener copias lógicas externas al servicio, antes y después de cada migración y con periodicidad acorde al RPO aprobado.
El script existente `node scripts/backup.cjs --dir=<DIRECTORIO_PRIVADO>` usa una instantánea REPEATABLE READ, no mysqldump;
incluye datos e historial de migraciones, omite las métricas efímeras de cuota por defecto y no exporta usuarios MySQL.
Requiere SELECT sobre todas las tablas respaldadas, incluidas las históricas; la cuenta de aplicación no basta.
TLS debe seguir verificado. Evitar DDL simultáneo durante el respaldo y vigilar espacio, memoria y duración en Free.

1. Verificar con `node scripts/restore.cjs --file=<COPIA> --verify-only`, sin conexión.
2. Cifrar el archivo, la firma y el manifiesto; guardar una copia externa con acceso limitado y retención aprobada.
   SHA-256 detecta corrupción, pero no sustituye cifrado ni autenticación frente a una sustitución maliciosa.
3. En un MySQL desechable independiente: restaurar en una base nueva `horus_restore_*` y comprobar filas, FK y esquema.
   La herramienta nunca restaura sobre `DB_NAME`. Para un host no local exige `ALLOW_RESTORE_DB=true` además de autorización.
4. Medir RTO y registrar el resultado. Se ensayó backup/verificación/restore con la imagen corregida, TLS y 30 tablas sin datos de negocio;
   no acredita volumen real de datos, recuperación Aiven ni un objetivo temporal.
5. Recuperar un servicio real implica una operación posterior autorizada: destino nuevo, prueba de integridad,
   preparación separada de usuarios/secrets y cambio controlado de conexión. No volcar automáticamente sobre Aiven.

Los uploads requieren su propia copia después del respaldo SQL: viven fuera de MySQL.
El [procedimiento oficial de exportación Aiven](https://aiven.io/docs/products/mysql/howto/migrate-database-mysqldump)
es una alternativa; no mezclar un dump genérico con el formato firmado que espera `restore.cjs`.

## Secuencia operativa revisada el 24/10: no ejecutada en Aiven

### 1. Destino y capacidad, antes de aprovisionar

Autorizar por separado las lecturas remotas, las dos altas/grants y la ventana de migración.
Conectar mediante cliente MySQL 8.4 con `--ssl-mode=VERIFY_IDENTITY`, contraseña interactiva y CA del proyecto.
La primera conexión administrativa puede omitir la base para identificar el servicio. Guardar la salida en
un expediente privado, nunca en Git. Comparar el UUID con el inventario aprobado; un UUID obtenido de la misma
conexión no constituye por sí solo una identidad previamente aprobada.

```sql
SELECT @@server_uuid, VERSION(), CURRENT_USER(), DATABASE();
SELECT @@GLOBAL.partial_revokes, @@GLOBAL.sql_require_primary_key,
       @@GLOBAL.max_connections, @@SESSION.sql_mode,
       @@character_set_server, @@collation_server, @@SESSION.time_zone;
SHOW SESSION STATUS LIKE 'Ssl_cipher';
SHOW SESSION STATUS LIKE 'Ssl_version';
SHOW GRANTS;
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
  FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'horus_db';
SELECT COALESCE(SUM(DATA_LENGTH + INDEX_LENGTH), 0) AS bytes_estimados
  FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'horus_db';
```

Comprobar disco y conexiones también en las métricas Aiven: information_schema no mide todo el consumo
del servicio. No cambiar variables globales. Consultar mantenimiento pendiente; si granular grants no está
disponible, detenerse y planificar su habilitación autorizada. No probarlo creando una cuenta ni omitir el campo
`mysql_grants` para sortear el error. Free no ofrece un fork para el ensayo; usar MySQL desechable independiente.

### 2. Creación sin privilegios y concesión separada

Usar los dos POST y cuerpos JSON de la primera sección, con proyecto/servicio reconfirmados y
`mysql_grants: []` obligatorio. Si el usuario ya existe, detenerse: no reutilizarlo, recrearlo ni resetear
su contraseña. El operador recibe cada respuesta en el gestor privado, sin salida de consola ni transcripción.
No registrar cabecera Authorization, respuesta de creación ni SQL con contraseñas. La API de Aiven genera
las contraseñas: no hay valores que sustituir en este documento.

Abrir una conexión TLS de cada usuario **sin base seleccionada**, consultar `CURRENT_USER()` y `SHOW GRANTS`.
Debe mostrar solo USAGE, sin privilegios heredados ni roles. Volver a la sesión administrativa para otorgar
el único GRANT del migrador, escogiendo la variante de `partial_revokes` anterior. La documentación de
[MySQL GRANT](https://dev.mysql.com/doc/refman/8.4/en/grant.html) explica que los backticks por sí solos
no neutralizan `_` en concesiones por base con partial_revokes desactivado. No ejecutar ambas variantes.

En el ensayo propio del cierre se verifica la concesión escapada y la denegación sobre otro esquema que
coincidiría con el comodín. Este resultado no acredita los permisos administrativos del servicio Aiven.
Si no puede conservarse el alcance exacto, detenerse; no ampliar a `*.*` ni añadir GRANT OPTION.

Después de inicializar/migrar y comprobar las tablas, sustituir **solo** `<HOST_SQL_APP>` por el host
devuelto por CURRENT_USER() de la identidad gestionada. No interpolar entradas no verificadas ni ejecutar
con el marcador pendiente. Los GRANT por tabla usan nombres literales; no requieren el escape de la concesión
por esquema. Ejecutarlos en la sesión administrativa autorizada:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON `horus_db`.`admin_items` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `horus_db`.`servicios` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `horus_db`.`contactos` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `horus_db`.`galeria_items` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `horus_db`.`rate_limit_buckets` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `horus_db`.`convenios` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `horus_db`.`convenio_fotos` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT, UPDATE, DELETE ON `horus_db`.`chatbot_preguntas_sin_respuesta` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT, UPDATE ON `horus_db`.`admin_users` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT, UPDATE ON `horus_db`.`cursos` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT, UPDATE ON `horus_db`.`preguntas_frecuentes` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT, UPDATE ON `horus_db`.`cotizaciones` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT, UPDATE ON `horus_db`.`newsletter_subscribers` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT, UPDATE ON `horus_db`.`empresa_settings` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT, UPDATE ON `horus_db`.`attention_records` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT, UPDATE ON `horus_db`.`estudiantes` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT, UPDATE ON `horus_db`.`convocatorias` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT, UPDATE ON `horus_db`.`matriculas` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT, UPDATE ON `horus_db`.`preinscripciones` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT ON `horus_db`.`admin_auditoria` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT ON `horus_db`.`reclamaciones` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT ON `horus_db`.`importaciones_academicas` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT ON `horus_db`.`academico_historial` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT ON `horus_db`.`preinscripciones_historial` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT, DELETE ON `horus_db`.`convocatoria_horarios` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT, INSERT, DELETE ON `horus_db`.`chatbot_interacciones` TO 'horus_app'@'<HOST_SQL_APP>';
GRANT SELECT ON `horus_db`.`certificados` TO 'horus_app'@'<HOST_SQL_APP>';
```

Verificar SHOW GRANTS desde las dos cuentas y compararlo con esta matriz, incluidos roles y privilegios
globales. No probar CREATE/DROP/DELETE para verificar denegaciones en Aiven. Las pruebas negativas de
escritura pertenecen al ensayo desechable. No hace falta FLUSH PRIVILEGES tras GRANT.

### 3. Respaldo, migración y validación

Usar una copia aprobada de la candidata o del paquete, fuera del workspace y **sin .env**: los scripts de
mantenimiento cargan dotenv. Inyectar DB_* del migrador en una sesión nueva desde el gestor privado,
incluidos TLS y UUID esperado, sin reutilizar variables locales ni mostrar sus valores. La sonda exige
UUID pero migrate.cjs no lo comprueba por sí mismo: volver a comprobar la identidad inmediatamente antes
de ejecutar y conservar la misma configuración durante toda la ventana. Detener escritores, otras
revisiones y jobs; confirmar la pausa con el responsable y un respaldo nuevo verificado.

Desde `backend/` de esa copia, con comprobación de salida después de cada paso:

```powershell
node scripts/check-mysql-tls.cjs
if ($LASTEXITCODE -ne 0) { throw 'Detener: TLS o destino no verificado.' }
node scripts/backup.cjs --dir=<DIRECTORIO_PRIVADO_NUEVO>
if ($LASTEXITCODE -ne 0) { throw 'Detener: respaldo previo fallido.' }
node scripts/restore.cjs --file=<COPIA_PREVIA.sql.gz> --verify-only
if ($LASTEXITCODE -ne 0) { throw 'Detener: copia previa inválida.' }
# Antes del DDL: ensayo de restauración en otro servidor, autorización y destino reconfirmados.
# SOLO si SHOW TABLES no devuelve tablas: node scripts/init-database.cjs
# Comprobar su salida y detenerse si no es 0; nunca repetir init sobre una base parcial.
node scripts/migrate.cjs
if ($LASTEXITCODE -ne 0) { throw 'Detener: migración parcial; requiere revisión.' }
node scripts/check-database.cjs
if ($LASTEXITCODE -ne 0) { throw 'Detener: esquema incompatible.' }
node scripts/migrate.cjs
if ($LASTEXITCODE -ne 0) { throw 'Detener: idempotencia fallida.' }
node scripts/backup.cjs --dir=<DIRECTORIO_PRIVADO_POSTERIOR_NUEVO>
if ($LASTEXITCODE -ne 0) { throw 'Detener: respaldo posterior fallido.' }
```

Los marcadores hacen este bloque una plantilla, no un script listo para pegar. Si hay tablas previas,
inventariar migraciones/datos y ensayar **su respaldo** antes de autorizar migrate; no asumir que bastan
las pruebas de instalación vacía. Una instalación nueva espera 18 filas activas y 30 tablas; una base
histórica puede conservar sesiones y registros retirados, por lo que no se debe imponerle ese recuento.
Verificar columnas, índices, CHECK, FK sin huérfanos, charset/collation, recuentos por tabla y ausencia de
datos de ejemplo. No basta contar filas de horus_migrations ni obtener un health 200.

Firmar/verificar y cifrar ambas copias con la herramienta del responsable; copiar fuera del servicio,
comprobar descifrado y restauración, y acordar RPO/RTO/retención antes de abrir escritores. Con pocos
datos se propone copia diaria y siempre antes/después de mantenimiento, sujeto al RPO aprobado.
Conservar los uploads en copia independiente coordinada. No afirmar que Free ofrece recuperación probada
o retención determinada hasta comprobar el servicio y un ensayo.

### 4. Reversión y detención

| Momento del fallo | Respuesta prevista |
| --- | --- |
| Antes de escribir | Abortar la ventana; conservar cuentas creadas sin ampliar permisos. No borrar ni revocar automáticamente. |
| DDL parcialmente aplicado | Mantener escritores parados, guardar error sanitizado e inventario. Revisar y completar hacia delante solo tras diagnóstico/autorización; DDL no se revierte con ROLLBACK. |
| Nueva API falla con esquema compatible | Volver al digest/configuración anterior verificados y comprobar lecturas; no deshacer el esquema aditivo por comodidad. |
| Se necesita recuperar datos/esquema | Restaurar la copia en un destino nuevo aislado, verificarla, preparar usuarios/secretos nuevos y autorizar el cambio de conexión. Mantener el servicio original intacto para investigar. |

No hay downgrade SQL automático. restore.cjs rechaza `horus_db` como destino y no es una herramienta
para sobreescribir producción. Free no permite fork y limita a un servicio MySQL Free por organización:
si hace falta otro servicio gestionado, aprobar su costo o elegir otro servidor autorizado. Si se aceptan
escrituras tras la copia, el retorno a ella pierde esas escrituras; acordar reconciliación/RPO antes
de cambiar conexiones. Mantener las referencias anteriores de secretos durante la ventana de reversión;
no rotarlas ni retirarlas como parte de esta preparación.
