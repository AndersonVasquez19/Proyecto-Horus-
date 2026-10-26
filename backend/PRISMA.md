# Prisma y esquema MySQL

Fase 4: `20261019-importaciones-academicas` se aplica después de `20261018-convocatorias-capacidad`; añade `importaciones_academicas` sin modificar datos previos. Prisma y `db:check` verifican columnas, unicidad por archivo/destino, claves foráneas restrictivas y recuentos válidos. Requiere aplicar ambas migraciones antes de habilitar la importación, con autorización explícita del destino. Véase [el procedimiento](../docs/procedimientos/importacion-academica.md).

El backend utiliza Prisma 6.19.0, `engineType="client"` y el adaptador MariaDB/MySQL. La aplicación y los scripts comparten variables `DB_*`, verificación TLS y clave RSA pública fijada. El cliente se genera durante instalación/build con una URL ficticia, sin conectarse a la base.

## Base existente

Respaldar y confirmar el destino. Ejecutar `npm ci`, `npm run build` y `npm run db:check`. Revisar los SQL pendientes en `migrations/`, aplicar `npm run db:migrate` y repetir la comprobación.

Las versiones se registran en `scripts/migrate.cjs` y en `horus_migrations`; un bloqueo MySQL evita ejecutores simultáneos. No se reescriben migraciones anteriores.

Ediciones (fase 2) añade `20261018-convocatorias-capacidad`: un único ALTER aditivo con `capacidad INT NULL` y CHECK positivo, sin completar datos anteriores. El cliente Prisma conserva `NULL` para capacidad desconocida. La migración es necesaria antes de activar el módulo; sus reglas, bloqueo por curso, revisión, historial y pruebas están en [Gestión de ediciones](../docs/procedimientos/gestion-ediciones.md). Si el ALTER termina pero no llega a registrarse en `horus_migrations`, comprobar columna/CHECK y registro antes de reintentar; no borrar ni recrear tablas.

`20261002-complete-institutional` añade `activo` y `session_version` a administradores, `consent_at` a suscripciones, seguimiento con historial, cuotas compartidas y una clave foránea que impide borrar un contacto vinculado a una cotización. Las referencias huérfanas antiguas se vuelven `null`, conservando la propuesta.

MySQL DDL no es transaccional. Si falla una migración parcialmente, revisar los cambios aplicados antes de reintentar; no borrar datos ni resetear el esquema.

## Base nueva

Crear una base vacía y configurar `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y `DB_PASS`. Ejecutar `npm run db:init`, `npm run db:migrate` y `npm run db:check`. La inicialización rechaza bases con tablas.

`npm run admin:create` es el proceso controlado para crear el primer administrador (el registro público, `POST /api/admin/signup`, solo crea cuentas sin rol). Solicita nombre/correo, utiliza `ADMIN_INITIAL_PASSWORD` temporal y exige `--destino`, `--servidor` (el `server_uuid` que muestra `npm run admin:assign-role -- --listar`), `--operador` y `--motivo`; crea la cuenta sin rol y registra el alta en `admin_auditoria` (ver `docs/procedimientos/roles-administrativos.md`).

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

## Académico (E4.2 y E4.3b)

`20261015-academico-estructura` crea, vacías y solo con `CREATE TABLE IF NOT EXISTS` (cada una atómica en MySQL 8), `estudiantes`, `convocatorias`, `matriculas`, `certificados` y `academico_historial` (modelos `Estudiante`, `Convocatoria`, `Matricula`, `Certificado` y `AcademicoHistorial`). Solo es estructura: ningún servicio ni ruta la usa todavía. Las reglas viven en MySQL y Prisma no las valida:

- Documento opcional pero todo o nada (`doc_pais`, `doc_tipo`, `doc_numero`), único por la combinación de los tres. Desde E4.3b (`20261016-academico-solo-dni`) solo se admite **DNI peruano**: país `PE`, tipo `DNI` (único valor del ENUM y de `DocumentoTipo` en Prisma) y exactamente 8 dígitos ASCII guardados como texto (conserva los ceros iniciales). El CHECK exige además `CHAR_LENGTH(doc_numero) = 8`, porque el `$` de `REGEXP_LIKE` (ICU) también coincide antes de un salto de línea final: con la regla de E4.2, `'12345678\n'` (o `\r`, `\r\n`, U+0085, U+2028, U+2029) se aceptaba. CE y PASAPORTE se rechazan en estudiantes y certificados. El registro y la matrícula pueden hacerse sin documento; emitir un certificado exige el DNI completo. Registro manual: no hay campos de verificación externa ni RENIEC, y un formato válido no significa que la identidad esté verificada. El servicio normaliza antes de guardar (`src/academico/documento.ts`). Contacto opcional: `email` (VARCHAR 254) y `telefono` (VARCHAR 30), ambos NULL por defecto y sin UNIQUE ni índice (varios estudiantes pueden compartirlos).
- Convocatorias con fechas (`DATE`) y estado propios: no leen ni modifican `cursos.fecha_inicio` ni `cursos.estado`. Estudiantes y convocatorias se archivan (`archivado_at`); matrículas y certificados se anulan. Todas las claves foráneas son `RESTRICT`: no se puede borrar un curso, estudiante, convocatoria, matrícula, certificado sustituido ni administrador referenciado.
- Matrícula única por estudiante y convocatoria. El cumplimiento confirmado exige `confirmado_por`, `confirmado_at` y `confirmado_rol`, que solo admite `GERENTE_GENERAL` o `COORDINADORA_INSTITUCIONAL`.
- Certificados: copia de los datos de emisión (documento obligatorio), código aleatorio de 16-32 `[A-Z0-9]`, anulados conservados con quién, cuándo y por qué. Un solo vigente por matrícula mediante la columna generada `STORED` `vigente_matricula_id` con índice único (no declarada en Prisma a propósito: Prisma no admite columnas generadas y nunca debe escribirla). La sustitución enlaza con `sustituye_a_id` a un certificado de la misma matrícula (clave foránea compuesta) y una sola vez; el orden «anular y después emitir», el motivo y los permisos los comprobará el servicio en una transacción.
- `academico_historial`, sin claves foráneas ni datos personales (`campos` guarda solo nombres de campos), se escribirá en la misma transacción que el cambio académico.

Con el adaptador, Prisma 6.19.3 entrega una violación de `CHECK` (MySQL 3819) como `DriverAdapterError` (`cause.code = 3819` y el nombre de la restricción en el mensaje), no como `PrismaClientKnownRequestError`; las de `UNIQUE` y claves foráneas llegan como `P2002` y `P2003`. `db:check` verifica la estructura real (columnas, índices, claves foráneas, `CHECK` y columna generada): una tabla previa con otra forma no se corrige en silencio. Las expresiones de los `CHECK` y de la columna generada se comparan con las de la propia migración en forma canónica (`scripts/sql-expression.cjs`): se toleran las reescrituras de MySQL (minúsculas, paréntesis, introductores `_utf8mb4`/`_latin1`), no un cambio de lógica. También exige `id` como clave primaria con `AUTO_INCREMENT` y rechaza índices únicos no previstos (p. ej. `UNIQUE(email)`).

`20261016-academico-solo-dni` son dos `ALTER TABLE` (uno por tabla, cada uno atómico pero con commit implícito: no forman una transacción conjunta). Por eso `db:migrate` comprueba antes de la primera sentencia que todas las filas ya cumplen la regla nueva; si hay algún CE, PASAPORTE o DNI que la regla rechace, se detiene sin modificar datos ni estructura e informa solo recuentos (nada se convierte, borra ni anonimiza). Cada `ALTER` quita y vuelve a crear su CHECK con el mismo nombre y redefine el ENUM, así que es idempotente: si la ejecución se interrumpe entre ambos, repetir `db:migrate` la completa (y vuelve a comprobar los datos). Si una fila no DNI apareciera entre la comprobación y el `ALTER`, MySQL rechaza el `ALTER` sin cambiar nada (1265 en modo estricto, 3819 en no estricto). `db:check` compara con el esquema efectivo de las migraciones académicas en orden (`ACADEMIC_MIGRATIONS`) y rechaza un esquema que aún admita CE o PASAPORTE.

`test/academico-schema.integration.cjs` lo comprueba contra un MySQL 8.4 desechable (instalación desde cero, actualización desde E4.1 con datos, recuperación de una migración parcial, cada restricción, Prisma, `db:check` frente a estructuras incorrectas y respaldo/restauración reales con certificados; y para E4.3b: actualización desde E4.2 con y sin datos DNI, detención ante CE, PASAPORTE o DNI con terminador en modo estricto y no estricto, `ALTER` directo con filas no DNI, recuperación de la migración parcial y rechazo por SQL directo). Exige `ACADEMICO_SCHEMA_TEST_DB=true` y el `server_uuid` del contenedor; solo crea y elimina `horus_e42_<hex>` y `horus_restore_e42_<hex>`.

## Alcance académico reducido (octubre de 2026)

**Horarios y Sesiones (octubre de 2026).** `20261023-convocatoria-horarios` añade el modelo `ConvocatoriaHorario` (`convocatoria_horarios`: `dia_semana Int @db.TinyInt`, ISO 1–7; horas `DateTime @db.Time(0)` en hora de pared de Lima; `UNIQUE (convocatoria_id, dia_semana, hora_inicio)`; relación `Restrict`). Los `CHECK` de día e intervalo viven en MySQL y `db:check` los compara por su expresión. La migración `20261020-sesiones-academicas` está **retirada** (lista `retired` de `scripts/migrate.cjs`): su SQL se conserva intacto, pero `db:migrate` no la aplica. Por eso el esquema Prisma ya **no declara** el modelo `Sesion` ni sus enums; conserva los valores `sesion` de `AcademicoEntidad` y `reprogramacion` de `AcademicoOperacion` para leer filas históricas. `db:check` lee `horus_migrations`: si la migración retirada está registrada, exige y verifica entera la tabla histórica `sesiones` y los ENUM ampliados; si no lo está, cualquier resto (la tabla o los ENUM ampliados) es un problema que se informa y no se corrige ni se borra. Detalle y procedimiento: [Horarios de las ediciones](../docs/procedimientos/horarios-ediciones.md).

Los módulos de **Certificados** y **Docentes** se retiraron del código y de la API, pero **no del esquema**: las tablas `certificados`, `docentes` y `docente_asignaciones`, sus migraciones (`20261015-academico-estructura`, `20261016-academico-solo-dni`, `20261020-docentes`), sus datos, la columna generada `certificados.vigente_matricula_id`, los modelos Prisma (`Certificado`, `Docente`, `DocenteAsignacion`) y los valores del historial siguen igual, de modo que `db:check`, `db:backup` y `db:restore` los conservan. No se borró ni se modificó ninguna tabla, columna ni dato, y `sesiones.asignacion_id` (clave compuesta hacia `docente_asignaciones`) sigue en la tabla, pero las sesiones nuevas lo guardan en NULL. `MatriculasService` sigue leyendo `certificados` para impedir anular una matrícula o cambiar su cumplimiento si tiene un certificado vigente, y `CertificadosService.verify` (solo lectura) atiende la verificación pública provisional. Retirar físicamente estas tablas exigiría una migración nueva y una decisión explícita.
