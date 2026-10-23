# Separación de credenciales MySQL: propuesta para revisión

23 de octubre de 2026. **Preparación y ensayo aislado; sin ejecutar CREATE USER, GRANT, REVOKE ni cambios de configuración en el servidor real.**
La sonda de solo lectura de `horus_db` confirmó que la credencial configurada tiene privilegios globales de administración.
No es una credencial mínima de aplicación. No se reproducen nombre de cuenta, contraseña ni salida completa de configuración.

## Evidencia nueva de separación en MySQL 8.0.46

La misión final volvió a confirmar privilegios administrativos globales y `GRANT OPTION` en la credencial habitual.
La escucha del servidor es `bind_address=*`; no se comprobó su accesibilidad desde otras máquinas ni el firewall.
No se cambió la escucha, el servicio, las cuentas, los grants ni `backend/.env` del servidor habitual.

En un **servidor nativo propio y desechable 8.0.46**, distinto de `horus_db`, se crearon cuentas de ensayo restringidas
a `localhost`, con secretos aleatorios privados. Se usó el respaldo nuevo de la misión final, restaurado y comprobado:

- La cuenta de mantenimiento, con SELECT/INSERT/UPDATE/DELETE/CREATE/ALTER/INDEX/REFERENCES exclusivamente
  sobre el clon, aplicó Preinscripciones y Horarios. `db:check` pasó y la repetición fue idempotente.
- La cuenta de respaldo con solo SELECT ejecutó `db:check` y `db:backup --include-rate-limits`; su restauración
  conservó exactamente los datos y las 18 migraciones del clon actualizado.
- Se comprobaron **ocho denegaciones**: DDL de aplicación, lectura de `mysql.user`, registro de migraciones y
  Docentes; escritura de Certificados; UPDATE de historial; DELETE de auditoría; UPDATE con la cuenta de respaldo.
  Los grants de aplicación tampoco contienen DDL ni `GRANT OPTION`.

La revisión final eliminó también operaciones DML que el código no utiliza: el conjunto preparado usa la matriz
por tabla inferior. Se comprobaron otras **seis denegaciones**: DELETE de Cursos, Preinscripciones e Importaciones;
UPDATE de historial de Preinscripciones, métricas de interacciones y Horarios. No se alteraron cuentas reales.
La limpieza oportunista del chatbot sí necesita DELETE sobre sus dos tablas; no se retiró ese privilegio.

Este ensayo valida los privilegios SQL indicados; el resultado funcional de NestJS con esa cuenta se registra en
[la entrega](entrega-backend-20261023.md). No confundir permisos SQL comprobados con cobertura completa de cada
flujo HTTP. No se necesita crear una cuenta real adicional de respaldo para copias manuales: puede usarse el proceso
privado de mantenimiento. La cuenta SELECT se ensayó para una futura automatización que justifique separarla.

El primer intento del arnés privado falló con autenticación 1045: `dotenv` incorporaba la clave pública RSA del
servidor habitual a la conexión del clon. Se reprodujo la carga ausente/presente de esa variable y se aisló su valor
por proceso; la conexión y las migraciones pasaron sin ampliar permisos. **No fue un fallo del SQL de migración**.
La clave pública del clon se exporta como PEM canónico antes de incorporarla al entorno de procesos de prueba.
Nunca copiar al clon ni al futuro servidor la clave pública de otra instancia.

La transición real sigue pendiente de la autorización separada de la etapa D. Antes, elegir host/transportes,
guardar los secretos de aplicación y mantenimiento por separado y confirmar sus consumidores. Conservar la
configuración anterior mientras se valida la nueva; no revocar la credencial anterior por anticipado.

Configuración preparada, **sin escribirla en `.env`**: conservar `DB_HOST=127.0.0.1`, `DB_PORT=3306` y
`DB_NAME=horus_db`; inyectar `DB_USER`/`DB_PASS` de aplicación únicamente en NestJS y las credenciales de
mantenimiento únicamente en su proceso separado. `DB_RSA_PUBLIC_KEY` debe ser la clave pública comprobada
de ese servidor, y TLS debe corresponder al transporte validado. Mantener `DB_SYNC=false` y
`SWAGGER_ENABLED=false`; conservar el secreto JWT existente sin reproducirlo ni rotarlo en esta etapa.
La reversión consiste en restaurar el secreto/configuración anterior del proceso, reiniciarlo de forma controlada
y verificarlo; no deshacer migraciones, borrar datos ni revocar cuentas automáticamente.

## Frontera actual

`src/database/prisma.service.ts` y `scripts/database.cjs` consumen `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`,
TLS y clave RSA; los scripts no tienen hoy un segundo juego de variables de migración. Build solo genera Prisma.
La misma credencial permite a todos los módulos Prisma acceder a sus tablas: el aislamiento de Preinscripciones frente
a OpenAI es de código, no una cuenta MySQL diferente. No se cambia esta arquitectura en este cierre.

Separar **procesos y secretos**, sin añadir configuración nueva:

| Proceso | Credencial propuesta | Privilegios |
| --- | --- | --- |
| API NestJS | `horus_app` restringida al host real | Solo operaciones por tabla de la matriz inferior; sin DDL, administración ni acceso a otros esquemas. |
| Inicialización/migraciones explícitas | `horus_migrator` restringida al host de mantenimiento | SELECT/INSERT/UPDATE/DELETE/CREATE/ALTER/INDEX/REFERENCES sobre el esquema elegido. Sin GRANT OPTION ni privilegios globales. |
| Backup/check de esquema, si requiere cuenta separada | `horus_backup` opcional | SELECT sobre el esquema; SHOW VIEW solo si se incorporan vistas (el backup actual no las incluye). |
| Restore de ensayo | Cuenta administrativa del servidor desechable propio | CREATE DATABASE y DDL/DML únicamente dentro de ese servidor aislado. Nunca conceder estos permisos a la API. |

El código actual usa bloqueos `SELECT ... FOR UPDATE`, transacciones y `GET_LOCK` de migraciones; no necesita FILE,
SUPER, CREATE USER, SHUTDOWN ni GRANT OPTION. El backup hace SELECT/SHOW/instantánea, no `LOCK TABLES` ni `mysqldump`.
Las migraciones vigentes se revisan por su SQL; nuevas migraciones podrían requerir revisar esta lista.
No conceder DROP preventivamente: las migraciones actuales no ejecutan DROP TABLE/DATABASE.

## Plantilla SQL, pendiente de elegir destino y hosts

Ejecutar **solo después de autorización**, mediante una sesión administrativa segura en el servidor/UUID comprobado.
Sustituir los marcadores `HOST_*` y contraseñas dentro del canal privado autorizado; estos ejemplos no son credenciales.
No pasar contraseñas por argumentos de CLI ni guardar el SQL cumplimentado en Git/logs/historial.
No usar `%` como host por comodidad. Ajustar TLS al transporte real, sin desactivar verificación ni inventar certificados.

```sql
SELECT @@server_uuid, VERSION(), DATABASE();
CREATE USER 'horus_app'@'HOST_APP' IDENTIFIED BY '<SECRETO_APP_PRIVADO>';
CREATE USER 'horus_migrator'@'HOST_MANTENIMIENTO' IDENTIFIED BY '<SECRETO_MIGRACION_PRIVADO>';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON `horus_db`.* TO 'horus_migrator'@'HOST_MANTENIMIENTO';
```

Solo si se necesita una cuenta de lectura para respaldos automatizados, autorizar adicionalmente:

```sql
CREATE USER 'horus_backup'@'HOST_RESPALDO' IDENTIFIED BY '<SECRETO_RESPALDO_PRIVADO>';
GRANT SELECT ON `horus_db`.* TO 'horus_backup'@'HOST_RESPALDO';
```

Para la API, se revisaron los modelos `@@map`, las operaciones Prisma, el delegado dinámico de Catálogo y el SQL
de ejecución. El código no contiene DDL de ejecución; la API ensayada funciona sin CREATE/ALTER/DROP.
La matriz preparada para las **27 tablas con consumidores activos** es:

| Permisos | Tablas |
| --- | --- |
| SELECT, INSERT, UPDATE, DELETE | `admin_items`, `servicios`, `contactos`, `galeria_items`, `rate_limit_buckets`, `convenios`, `convenio_fotos`, `chatbot_preguntas_sin_respuesta` |
| SELECT, INSERT, UPDATE | `admin_users`, `cursos`, `preguntas_frecuentes`, `cotizaciones`, `newsletter_subscribers`, `empresa_settings`, `attention_records`, `estudiantes`, `convocatorias`, `matriculas`, `preinscripciones` |
| SELECT, INSERT | `admin_auditoria`, `reclamaciones`, `importaciones_academicas`, `academico_historial`, `preinscripciones_historial` |
| SELECT, INSERT, DELETE | `convocatoria_horarios`, `chatbot_interacciones` |
| SELECT | `certificados` |

Los horarios se reemplazan por diferencia (DELETE/INSERT), sin UPDATE; el seguimiento de reclamaciones modifica
`attention_records`, conserva `reclamaciones`. Los historiales e importaciones se insertan y leen; no se editan
ni borran. La retención oportunista del chatbot requiere DELETE incluso sin ejecutar el comando de mantenimiento.
La matriz corresponde al código actual: una operación futura exige revisar sus privilegios.

Generar **sin ejecutar** la propuesta, después de activar las dos migraciones y confirmar las 30 tablas:

```sql
SELECT CONCAT('GRANT ', permisos, ' ON `horus_db`.`',
              REPLACE(TABLE_NAME, '`', '``'), '` TO ''horus_app''@''HOST_APP'';') AS propuesta
FROM (
  SELECT TABLE_NAME, CASE
    WHEN TABLE_NAME = 'certificados' THEN 'SELECT'
    WHEN TABLE_NAME IN ('admin_auditoria', 'reclamaciones', 'importaciones_academicas',
                        'academico_historial', 'preinscripciones_historial') THEN 'SELECT, INSERT'
    WHEN TABLE_NAME IN ('convocatoria_horarios', 'chatbot_interacciones') THEN 'SELECT, INSERT, DELETE'
    WHEN TABLE_NAME IN ('admin_users', 'cursos', 'preguntas_frecuentes', 'cotizaciones',
                        'newsletter_subscribers', 'empresa_settings', 'attention_records',
                        'estudiantes', 'convocatorias', 'matriculas', 'preinscripciones') THEN 'SELECT, INSERT, UPDATE'
    WHEN TABLE_NAME IN ('admin_items', 'servicios', 'contactos', 'galeria_items', 'rate_limit_buckets',
                        'convenios', 'convenio_fotos', 'chatbot_preguntas_sin_respuesta') THEN 'SELECT, INSERT, UPDATE, DELETE'
    ELSE NULL
  END AS permisos
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = 'horus_db' AND TABLE_TYPE = 'BASE TABLE'
) AS revisada
WHERE permisos IS NOT NULL
ORDER BY TABLE_NAME;
```

Exigir 27 propuestas y cotejar su contenido con la matriz, sin ejecutarlas automáticamente. No hay alternativa que conceda
permisos a tablas desconocidas. Docentes/Sesiones no tienen consumidor activo; los respaldos los lee otra cuenta.
`certificados` necesita SELECT para verificación pública y bloqueo histórico de matrículas.
Las comprobaciones HTTP cubren los flujos enumerados en la entrega, no todas las combinaciones de negocio posibles.
Mantener fuera `horus_migrations` evita que una API comprometida altere el registro de migraciones.

## Secuencia propuesta de validación y transición

1. Confirmar servidor, versión, UUID, esquema, hosts que MySQL ve y autorización. Inventariar cuenta actual con
   `SHOW GRANTS FOR CURRENT_USER()` sin registrar autenticadores ni secretos. Preparar recuperación y respaldo privado verificado.
2. Ensayar las cuentas propuestas primero en un clon desechable, con los mismos hosts y transporte previstos.
   Crear tablas de fixture únicamente allí y comprobar DML válido, autenticación, cuotas, transacciones, FK y reportes.
   Intentar DDL como app debe fallar; además, comprobar `SHOW GRANTS` y falta de privilegios sobre `horus_migrations` y otros esquemas.
   La misión final ejecutó el ensayo SQL anterior en un MySQL nativo propio; las cuentas reales siguen intactas.
3. Probar `db:check`/`db:backup` con la cuenta de lectura y `db:migrate` con la administrativa, solo en el clon.
   Comprobar migración repetida y restauración con una tercera conexión al servidor desechable.
4. En una ventana posterior autorizada, crear las cuentas reales y guardar secretos en el gestor privado.
   API recibe únicamente sus `DB_*`; un proceso de mantenimiento separado recibe las mismas claves con la cuenta de migración.
   Ni Dockerfile, build, arranque, React ni variables VITE reciben el secreto de migración.
5. Ejecutar el mantenimiento autorizado con la credencial administrativa; retirarla del entorno de ejecución al terminar.
   Arrancar la API con la cuenta mínima, verificar `/api/health` y flujos autorizados. No basta con un healthcheck para probar DML.
6. Tras comprobar todos los consumidores de la cuenta antigua, autorizar por separado su revocación/rotación.
   No revocar una cuenta compartida antes de inventariar sus otros usos. Conservar la posibilidad de volver a la configuración anterior.

Comandos de mantenimiento desde `backend/`, con `DB_*` inyectadas **solo en el proceso correspondiente**, nunca con secretos literales:

```powershell
# Proceso aislado con la cuenta de lectura y destino previamente comprobado:
npm run db:check
npm run db:backup -- --dir=<DIRECTORIO_PRIVADO_AUTORIZADO>
# Otro proceso, cuenta de migración y autorización de la ventana real:
npm run db:migrate
npm run db:check
```

## Acceso, respaldo y rotación

- MySQL local: preparar escucha en loopback si todos sus consumidores son locales. Para futuros servicios separados,
  usar la red privada y permitir solo los hosts necesarios en firewall y cuentas; no publicar 3306 en Internet.
  Verificar antes los consumidores actuales y la dirección que MySQL observa. Ninguna configuración real cambia aquí.
- Transporte remoto: validar CA/hostname y exigir TLS a las cuentas según el transporte ensayado. No añadir
  `REQUIRE SSL` al servidor local sin confirmar previamente certificados y conexión; no desactivar su verificación.
- Secretos: entregar solo `DB_*` de aplicación al proceso NestJS y guardar el secreto de migración en el canal privado
  del operador. No incluirlos en Git, imágenes, argumentos, logs ni variables `VITE_*`.
- Respaldo: ACL privada, cifrado con el mecanismo aprobado por el responsable, copia externa protegida y prueba de
  restauración. Conservar manifiesto/firma y una política de retención. La ACL y SHA-256 no sustituyen al cifrado.
- Rotación posterior autorizada: inventariar consumidores; generar el nuevo secreto en el gestor privado; ensayar
  una cuenta sustituta con los mismos privilegios mínimos; actualizar el secreto del proceso y reiniciar de forma
  controlada; validar lectura, escritura, cuotas y permisos. Mantener la cuenta anterior durante la comprobación.
  Solo después de verificar todos sus usos, autorizar su bloqueo/revocación; si falla, volver al secreto anterior.
  Rotar por separado aplicación, mantenimiento y respaldo, registrando fecha y responsable sin guardar secretos.

No se necesita `FLUSH PRIVILEGES` después de CREATE USER/GRANT. El procedimiento no habilita migraciones automáticas ni
autoriza cambios de `horus_db`. La creación real de estas cuentas, la inyección de secretos y la retirada
de privilegios actuales quedan pendientes de revisión y autorización específicas. El ensayo aislado descrito arriba
no concede autorización para la transición real.
