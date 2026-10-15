# Prisma y esquema MySQL

El backend utiliza Prisma 6.19.0, `engineType="client"` y el adaptador MariaDB/MySQL. La aplicación y los scripts comparten variables `DB_*`, verificación TLS y clave RSA pública fijada. El cliente se genera durante instalación/build con una URL ficticia, sin conectarse a la base.

## Base existente

Respaldar y confirmar el destino. Ejecutar `npm ci`, `npm run build` y `npm run db:check`. Revisar los SQL pendientes en `migrations/`, aplicar `npm run db:migrate` y repetir la comprobación.

Las versiones se registran en `scripts/migrate.cjs` y en `horus_migrations`; un bloqueo MySQL evita ejecutores simultáneos. No se reescriben migraciones anteriores.

`20261002-complete-institutional` añade `activo` y `session_version` a administradores, `consent_at` a suscripciones, seguimiento con historial, cuotas compartidas y una clave foránea que impide borrar un contacto vinculado a una cotización. Las referencias huérfanas antiguas se vuelven `null`, conservando la propuesta.

MySQL DDL no es transaccional. Si falla una migración parcialmente, revisar los cambios aplicados antes de reintentar; no borrar datos ni resetear el esquema.

## Base nueva

Crear una base vacía y configurar `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y `DB_PASS`. Ejecutar `npm run db:init`, `npm run db:migrate` y `npm run db:check`. La inicialización rechaza bases con tablas.

`npm run admin:create` es el proceso controlado para crear el primer administrador (el registro público está cerrado). Solicita nombre/correo, utiliza `ADMIN_INITIAL_PASSWORD` temporal y exige `--destino`, `--servidor` (el `server_uuid` que muestra `npm run admin:assign-role -- --listar`), `--operador` y `--motivo`; crea la cuenta sin rol y registra el alta en `admin_auditoria` (ver `docs/procedimientos/roles-administrativos.md`).

## Contratos

- El arranque ejecuta `SELECT 1`; no inicializa ni migra tablas.
- Las fechas de calendario se serializan como `YYYY-MM-DD`; los importes leídos se mantienen con dos decimales.
- Cotizaciones y seguimiento usan transacciones y revisión para detectar modificaciones obsoletas.
- No utilizar `prisma db push`, `prisma migrate reset` ni eliminar datos para corregir discrepancias.
- Configurar TLS verificado o la clave pública RSA confiable antes de probar un reinicio de MySQL. Consultar [Railway](../RAILWAY.md).

## Integración

`npm run test:integration` compila y crea/elimina exclusivamente una base `horus_prisma_test_<UUID>`. Requiere CREATE/DROP DATABASE. El destino debe ser local; un servidor remoto de pruebas exige autorización y `ALLOW_INTEGRATION_DB=true`.

Las pruebas cubren módulos, CRUD, publicación, fechas, importes, concurrencia, seguimiento, cuotas compartidas, recuperación de contraseña y referencias. Los correos de esas pruebas están sustituidos; no acreditan entrega SMTP real. La base configurada original no se migra durante estas comprobaciones.

## Convenios

Convenio y ConvenioFoto se crean mediante 20261002-create-convenios.sql, registrada en el ejecutor existente. Las fotos tienen FK con borrado en cascada de registros y permanecen separadas de GaleriaItem. Ninguna lectura, compilación o arranque importa datos. La carga inicial de los cinco convenios es un mantenimiento explícito e idempotente. Consulta [Convenios](CONVENIOS.md) para contratos, activación manual y vista previa.
