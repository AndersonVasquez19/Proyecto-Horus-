# Ensayo de permisos reducidos de horus_migrator

Ejecutado el **24/10/2026, America/Lima**, sobre el código
`1d7adc35e7e6633edf7acd2476732328c689bb37`, rama `anderson`.
Referencia: [preparación segura de Aiven](aiven-mysql-preparacion-segura.md).

**Resultado del ensayo del migrador: aprobado en MySQL 8.4.11 desechable.**
Los ocho privilegios propuestos bastaron para el SQL inicial y las 18 migraciones activas,
sin DROP, privilegios globales operativos, roles ni GRANT OPTION. No hubo fallos por permisos
insuficientes ni se amplió la concesión. Esta aprobación técnica no ejecuta ni autoriza
el aprovisionamiento o la migración de Aiven.

## Destino y aislamiento

| Dato | Valor comprobado |
| --- | --- |
| Imagen local, fijada por digest | `mysql@sha256:0744ee5ef89ce6ccfa13de3e579fe6b9e27f93dd70da9c06d2c908b1b193fb8d` |
| Versión consultada por SQL | `8.4.11` |
| Arquitectura | `amd64` |
| Node empleado | `v22.23.3` (binario existente; sin instalar dependencias) |
| Contenedor propio | `horus-migrator-1e391e80fbdc9d32` |
| UUID cotejado: conexión y docker exec | `a61c40f6-cfc9-11f1-b3aa-e62086e19868` |
| Destino del ensayo | `127.0.0.1:55856/horus_db`, exclusivamente en ese contenedor |
| Persistencia | `/var/lib/mysql` en tmpfs; sin datos ni volúmenes preexistentes |
| Red | Puente nuevo exclusivo, IP masquerading desactivado y publicación solo en loopback |
| `sql_require_primary_key` | `ON`; las 30 tablas tienen PK |
| Charset/collation del esquema | `utf8mb4` / `utf8mb4_unicode_ci`, fijados al crear la base |
| Charset/collation del servidor | `utf8mb4` / `utf8mb4_0900_ai_ci` |

`sql_mode` observado:
`IGNORE_SPACE,ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION`.

Se comprobó que el servidor no tenía tablas fuera de los esquemas del sistema antes de comenzar.
La cuenta migradora se creó con contraseña aleatoria exclusiva del ensayo. El operador del contenedor
creó las bases, concedió los ocho permisos y efectuó la limpieza; **init, migrate y check se ejecutaron
como horus_migrator**. Se usaron procesos hijos con variables DB explícitas, directorio temporal sin
`.env` y precarga `test/isolate-env.cjs`; no se heredó la configuración de conexión habitual.

Se completaron dos instalaciones vacías independientes en el mismo servidor propio: una con
`partial_revokes=OFF` y otra con `ON`. Entre ambas, el operador retiró exclusivamente la cuenta y
los dos esquemas ficticios del ensayo. La segunda base no reutilizó tablas ni historial de la primera.

## Privilegios efectivos

Salida de `SHOW GRANTS` con `partial_revokes=OFF`:

```sql
GRANT USAGE ON *.* TO `horus_migrator`@`%`;
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, REFERENCES, INDEX, ALTER
  ON `horus\_db`.* TO `horus_migrator`@`%`;
```

Salida con `partial_revokes=ON`:

```sql
GRANT USAGE ON *.* TO `horus_migrator`@`%`;
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, REFERENCES, INDEX, ALTER
  ON `horus_db`.* TO `horus_migrator`@`%`;
```

En ambos casos, `information_schema.SCHEMA_PRIVILEGES` devolvió exactamente ocho entradas,
todas con `IS_GRANTABLE=NO`. `USER_PRIVILEGES` devolvió únicamente `USAGE`, con
`IS_GRANTABLE=NO`: USAGE expresa ausencia de privilegios globales operativos.
`CURRENT_ROLE()` devolvió `NONE`; el operador confirmó cero roles asignados en `mysql.role_edges`
y cero privilegios dinámicos en `mysql.global_grants`, sin consultar hashes ni contraseñas.

El escape de `_` se comprobó mediante denegaciones sobre `horusXdb`, nombre que coincidiría con
el patrón sin escapar cuando `partial_revokes=OFF`. No se concedió acceso a `*.*`.
El host `%` corresponde solo a la identidad ficticia en la red del ensayo; el host real se debe
obtener de `CURRENT_USER()` durante una operación autorizada.

## Ejecución e idempotencia

| Comprobación | OFF | ON |
| --- | --- | --- |
| `node scripts/init-database.cjs` sobre base vacía | código 0 | código 0 |
| Primera ejecución de `node scripts/migrate.cjs` | código 0 | código 0 |
| Tablas finales | 30 | 30 |
| Registros en `horus_migrations` | 18, exactamente la lista activa | 18, exactamente la lista activa |
| Filas fuera de `horus_migrations` | 0 | 0 |
| `node scripts/check-database.cjs` | código 0 | código 0 |
| Segunda y tercera ejecución de migrate | ambas código 0 | ambas código 0 |
| Check después de cada repetición | ambos código 0 | ambos código 0 |
| Repetir init sobre la base ya creada | código 1, rechazo esperado, sin cambios | código 1, rechazo esperado, sin cambios |
| Pruebas negativas de permisos | 10/10 denegadas | 10/10 denegadas |

Salida exacta de check en las seis ejecuciones:

```text
Esquema compatible: tablas, columnas, tipos, nulabilidad e indices unicos. No se modificaron datos.
```

Salida esperada al intentar repetir init:

```text
La base no está vacía. Usa db:migrate para una base existente.
```

La idempotencia se comprobó comparando `SHOW CREATE TABLE` de las 30 tablas y todas sus filas,
incluidos los nombres y `applied_at` originales de las 18 migraciones. El SHA-256 de esa representación
JSON se mantuvo idéntico dentro de cada variante después de las repeticiones y del rechazo de init:

| Variante | SHA-256 |
| --- | --- |
| OFF | `5cd6c095cbfb3556df9f1dd13a15ac0ace00da516b55cb6d62a28068415c2c45` |
| ON | `cf225cda1c37c2fe611675d7f821dd559f98409660d7f556d17063cafd3cddae` |

Los hashes entre variantes difieren porque son instalaciones nuevas con otros tiempos de aplicación.
No son hashes de un respaldo SQL.

Las 18 migraciones aplicadas, en orden:

```text
20260909-create-catalogo
20260921-create-cotizaciones
20261002-complete-institutional
20261002-original-design
20261002-create-convenios
20261003-remove-otros-category
20261009-chatbot-metrics
20261010-newsletter-default-novedades
20261011-cotizaciones-idempotencia
20261014-admin-rol
20261014-admin-auditoria
20261015-academico-estructura
20261016-academico-solo-dni
20261018-convocatorias-capacidad
20261019-importaciones-academicas
20261020-docentes
20261020-preinscripciones
20261023-convocatoria-horarios
```

`00000000-initial.sql` se ejecutó antes de esa lista. La retirada
`20261020-sesiones-academicas` no se registró ni creó `sesiones`.

Las 30 tablas comprobadas:

```text
academico_historial, admin_auditoria, admin_items, admin_users, attention_records,
certificados, chatbot_interacciones, chatbot_preguntas_sin_respuesta, contactos,
convenio_fotos, convenios, convocatoria_horarios, convocatorias, cotizaciones,
cursos, docente_asignaciones, docentes, empresa_settings, estudiantes,
galeria_items, horus_migrations, importaciones_academicas, matriculas,
newsletter_subscribers, preguntas_frecuentes, preinscripciones,
preinscripciones_historial, rate_limit_buckets, reclamaciones, servicios.
```

## Denegaciones efectivas

Cada sentencia se intentó como migrador en ambas variantes, exclusivamente en el servidor propio.
Los dos resultados coincidieron; SQLSTATE `42000` en todos los casos.
`permission_probe` era una tabla ficticia creada por el operador para estas pruebas y retirada después;
la instantánea final volvió a coincidir con las 30 tablas y sus datos originales.

| Sentencia | errno | Código MySQL |
| --- | --- | --- |
| `DROP TABLE horus_db.permission_probe` | 1142 | `ER_TABLEACCESS_DENIED_ERROR` |
| `TRUNCATE TABLE horus_db.permission_probe` | 1142 | `ER_TABLEACCESS_DENIED_ERROR` |
| `DROP DATABASE horus_db` | 1044 | `ER_DBACCESS_DENIED_ERROR` |
| `SELECT * FROM horusXdb.scope_probe` | 1142 | `ER_TABLEACCESS_DENIED_ERROR` |
| `CREATE TABLE horusXdb.nope (id INT PRIMARY KEY)` | 1142 | `ER_TABLEACCESS_DENIED_ERROR` |
| `CREATE DATABASE forbidden_probe` | 1044 | `ER_DBACCESS_DENIED_ERROR` |
| `SELECT User FROM mysql.user` | 1142 | `ER_TABLEACCESS_DENIED_ERROR` |
| `CREATE USER 'forbidden_probe'@'%'` | 1227 | `ER_SPECIFIC_ACCESS_DENIED_ERROR` |
| `SET GLOBAL max_connections = 151` | 1227 | `ER_SPECIFIC_ACCESS_DENIED_ERROR` |
| `GRANT SELECT ON horus_db.* TO 'horus_migrator'@'%'` | 1044 | `ER_DBACCESS_DENIED_ERROR` |

Ninguna sentencia de las migraciones falló por permisos. No hay una sentencia fallida que corregir
ni necesidad demostrada de añadir DROP u otro privilegio. En particular, los `ALTER TABLE ... DROP CHECK`
de `20261016-academico-solo-dni` se ejecutaron con la concesión propuesta, sin privilegio DROP.

## Pruebas complementarias

- `node --test -r ./test/isolate-env.cjs -r ts-node/register test/migrations.test.ts`:
  **15/15**, cero fallos, cero omitidas; código 0, Node 22.23.3.
- Integración `node test/run-academic-isolated.cjs academico`: **20/20** según el resumen TAP
  (19 subpruebas y su prueba contenedora), cero fallos, cero omitidas; código 0, Node 22.23.3;
  duración TAP `210985.5136 ms`. Contenedor propio `horus-fase3-fe3a91ee86cfe513`,
  imagen `mysql:8.4` local con el mismo digest anterior; `mysqld --version` confirmó **8.4.11**.
  Cubrió instalación, actualización con datos ficticios, recuperación parcial, restricciones reales,
  Prisma 6.19.3, detección de estructuras incorrectas y respaldo/restauración. La restauración válida
  conservó 30 tablas idénticas y verificó 22 FK, tres compuestas, sin filas huérfanas; las copias con
  referencias inválidas fueron rechazadas. El ejecutor retiró su propio contenedor y volumen anónimo.

La integración usa su propio contenedor separado del ensayo de concesiones. Sus operaciones de
preparación, alteración de fixtures y recuperación usan el operador del contenedor; no se atribuyen
a la cuenta migradora reducida. La demostración de permisos de esa cuenta es la matriz anterior.

## Incidencias, evidencias y límites

El primer arranque del arnés intentó una red Docker `--internal`: Docker no publicó el puerto y el
arnés se detuvo antes de abrir una conexión MySQL (`HostPort` ausente). Se retiraron ese contenedor
y esa red propios. Se corrigió únicamente la red del arnés a puente exclusivo con masquerading
desactivado y publicación loopback. No se cambió SQL ni se ampliaron permisos.

Evidencias locales sanitizadas y arnés de reproducción, fuera de Git:
`C:\Users\PCT40T\AppData\Local\Temp\horus-migrator-5788f2520cd246cf9ec69608190ad0eb\`:
`rehearsal.cjs`, `result.json` e `integration-academico.log`. El arnés genera las contraseñas en memoria;
no las guarda en esos archivos. El contenedor y la red del ensayo de permisos se retiraron tras
cotejar nombre y etiqueta de propiedad. También se comprobó la ausencia del contenedor de integración
al finalizar. Los once contenedores preexistentes conservan sus identificadores. No se eliminaron
recursos preexistentes.

No se conectó a Aiven ni a MySQL local; no se modificaron credenciales reales, React, otras ramas,
Azure o GHCR. No se ejecutó `admin:create`, no hubo commits ni push. Solo se añadió este informe.
La conexión de este ensayo fue local, sin TLS: no vuelve a acreditar TLS 1.3/VERIFY_IDENTITY de Aiven.
El estado remoto y de mantenimiento comunicado por el usuario no se verificó mediante una conexión.

La aprobación cubre la suficiencia y el alcance de la concesión reducida para el código y la instalación
vacía ensayados. No demuestra que cada uno de sus ocho privilegios sea individualmente indispensable,
ni elimina las facultades de modificación de datos y estructura que sí conceden DELETE y ALTER.
La siguiente etapa real conserva sus comprobaciones de identidad, host SQL, `partial_revokes`, grants
efectivos y capacidad de aprovisionamiento gestionado, además de su autorización específica.
