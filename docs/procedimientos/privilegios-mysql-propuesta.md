# Separación de credenciales MySQL: propuesta para revisión

23 de octubre de 2026. **Preparación, sin ejecutar CREATE USER, GRANT, REVOKE ni cambios de configuración real.**
La sonda de solo lectura de `horus_db` confirmó que la credencial configurada tiene privilegios globales de administración.
No es una credencial mínima de aplicación. No se reproducen nombre de cuenta, contraseña ni salida completa de configuración.

## Frontera actual

`src/database/prisma.service.ts` y `scripts/database.cjs` consumen `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`,
TLS y clave RSA; los scripts no tienen hoy un segundo juego de variables de migración. Build solo genera Prisma.
La misma credencial permite a todos los módulos Prisma acceder a sus tablas: el aislamiento de Preinscripciones frente
a OpenAI es de código, no una cuenta MySQL diferente. No se cambia esta arquitectura en este cierre.

Separar **procesos y secretos**, sin añadir configuración nueva:

| Proceso | Credencial propuesta | Privilegios |
| --- | --- | --- |
| API NestJS | `horus_app` restringida al host real | SELECT/INSERT/UPDATE/DELETE sobre tablas de ejecución; sin DDL, administración ni acceso a otros esquemas. |
| Inicialización/migraciones explícitas | `horus_migrator` restringida al host de mantenimiento | SELECT/INSERT/UPDATE/DELETE/CREATE/ALTER/INDEX/REFERENCES sobre el esquema elegido. Sin GRANT OPTION ni privilegios globales. |
| Backup/check de esquema | `horus_backup` | SELECT sobre el esquema; SHOW VIEW solo si se incorporan vistas (el backup actual no las incluye). |
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
CREATE USER 'horus_backup'@'HOST_RESPALDO' IDENTIFIED BY '<SECRETO_RESPALDO_PRIVADO>';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON `horus_db`.* TO 'horus_migrator'@'HOST_MANTENIMIENTO';
GRANT SELECT ON `horus_db`.* TO 'horus_backup'@'HOST_RESPALDO';
```

Para la API, revisar los modelos `@@map` de `schema.prisma` y generar **sin ejecutar** los GRANT por tabla:

```sql
SELECT CONCAT('GRANT SELECT, INSERT, UPDATE, DELETE ON `horus_db`.`',
              REPLACE(TABLE_NAME, '`', '``'), '` TO ''horus_app''@''HOST_APP'';') AS propuesta
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'horus_db' AND TABLE_TYPE = 'BASE TABLE'
  AND TABLE_NAME NOT IN ('horus_migrations', 'docentes', 'docente_asignaciones', 'sesiones',
                         'certificados', 'academico_historial', 'admin_auditoria')
ORDER BY TABLE_NAME;
```

Revisar la salida antes de ejecutarla: esta es una base conservadora para el backend completo, no una demostración de mínimo
por cada tabla/operación. Las tablas históricas de Docentes/Sesiones no tienen consumidor activo; backups las lee otra cuenta.
`certificados` sigue necesitando SELECT para verificación pública y bloqueo histórico de matrículas.
Las tres excepciones anteriores quedan fuera del generador para no concederles DML de más:

```sql
GRANT SELECT ON `horus_db`.`certificados` TO 'horus_app'@'HOST_APP';
GRANT SELECT, INSERT ON `horus_db`.`academico_historial` TO 'horus_app'@'HOST_APP';
GRANT SELECT, INSERT ON `horus_db`.`admin_auditoria` TO 'horus_app'@'HOST_APP';
```

Revisar y ensayar estos permisos con todos los consumidores antes de la transición. `rate_limit_buckets` sí necesita DML.
Mantener fuera `horus_migrations` evita que una API comprometida altere el registro de migraciones.

## Secuencia propuesta de validación y transición

1. Confirmar servidor, versión, UUID, esquema, hosts que MySQL ve y autorización. Inventariar cuenta actual con
   `SHOW GRANTS FOR CURRENT_USER()` sin registrar autenticadores ni secretos. Preparar recuperación y respaldo privado verificado.
2. Ensayar las cuentas propuestas primero en un clon desechable, con los mismos hosts y transporte previstos.
   Crear tablas de fixture únicamente allí y comprobar DML válido, autenticación, cuotas, transacciones, FK y reportes.
   Intentar DDL como app debe fallar; además, comprobar `SHOW GRANTS` y falta de privilegios sobre `horus_migrations` y otros esquemas.
   La separación de cuentas **no se ejecutó en este cierre**; los ensayos de migración usan root de un contenedor propio.
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
autoriza cambios de `horus_db`. La validación de estas cuentas, su creación real, la inyección de secretos y la retirada
de privilegios actuales quedan pendientes de revisión y autorización específicas.
