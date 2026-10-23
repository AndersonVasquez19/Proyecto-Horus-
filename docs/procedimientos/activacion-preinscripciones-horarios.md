# Activación controlada de Preinscripciones y Horarios

**Ejecutada en `horus_db` el 23 de octubre de 2026 a las 16:32 (America/Lima)**, con autorización expresa limitada a
`20261020-preinscripciones` y `20261023-convocatoria-horarios`. Otras bases (Railway, `horus_local`, Docker) siguen
sin activar: repetir este procedimiento en cada una, con su propia autorización. Las secciones posteriores conservan
la preparación y la evidencia previas.

**Actualización posterior del 23/10/2026:** la etapa B de separación de cuentas también quedó ejecutada y verificada
en este destino: NestJS usa `horus_app` y `horus_migrator` se reserva para mantenimiento. Ver el
[cierre de cuentas MySQL](privilegios-mysql-propuesta.md). Los límites de autorización y las credenciales anteriores
descritos en el acta de activación corresponden a aquella operación, previa a la separación.

## Activación real (23 de octubre de 2026)

Código `anderson` en `6f9e233` (código de aplicación idéntico a `88b8bdb`), Node **22.23.3**, scripts del repositorio.
Evidencia privada, fuera de Git y con ACL de operador/SYSTEM:
`%USERPROFILE%\.horus-respaldos\activacion-real-20261023-ad9bf238\`.

| Comprobación previa | Resultado |
| --- | --- |
| Destino | `127.0.0.1:3306/horus_db`, MySQL 8.0.46, UUID `dc5bb32a-a7b2-11f1-913f-14b5cd19372a`; servicio `MySQL80`. No es clon ni remoto. |
| Migraciones históricas | Las 16 registradas coinciden con las 16 primeras de `versions`. Sus SQL no cambiaron después de crearse (la única edición, de `20261015-academico-estructura`, es del 15/10, anterior a su aplicación). |
| Pendientes según el migrador | Exactamente las dos autorizadas. Sesiones retirada y sin registro. |
| Datos | 27 tablas InnoDB, 148 filas; huellas por tabla **idénticas** a la instantánea de las 15:27. Sin vistas, triggers, rutinas ni eventos. 17 FK sin huérfanos. |
| Respaldo previo | Existe; SHA-256 `ed82f63a…a77daf` intacto, restauración ya acreditada. |
| Respaldo de la ventana | Nuevo a las 16:29, `horus-horus_db-20261023-212937.sql.gz`: **mismo SHA-256** que el anterior (contenido idéntico), firma y manifiesto verificados. |
| Ensayo inmediato | Restaurado en MySQL 8.0.46 desechable (UUID distinto): datos exactos; migración, `db:check` 0, repetición idempotente, 18 migraciones, 30 tablas, 22 FK sin huérfanos. |
| Escritores | Solo dos sesiones inactivas de MySQL Workbench (aplicación del usuario, no cerrada); 0 transacciones InnoDB y 0 bloqueos de metadatos ajenos en `horus_db`. Ninguna API conectada; la pila Docker `horus-local` usa su propio MySQL. |
| Espacio y recuperación | ~241 GiB libres en C:. Recuperación por restauración aislada descrita abajo. |

Inmediatamente antes de migrar se repitieron identidad, lista de pendientes, ausencia de transacciones/bloqueos,
huellas de datos y hash de `backend/.env`. Se ejecutaron únicamente `scripts/migrate.cjs` y `scripts/check-database.cjs`.

| Resultado | Valor |
| --- | --- |
| `npm run db:migrate` | Salida 0. Aplicadas `20261020-preinscripciones` (21:32:18 UTC) y `20261023-convocatoria-horarios` (21:32:19 UTC). |
| `npm run db:check` | Salida 0: «Esquema compatible». |
| Migraciones | **18**; Sesiones no registrada y sin tabla. |
| Estructuras nuevas | `preinscripciones`, `preinscripciones_historial`, `convocatoria_horarios` presentes y vacías; columnas, índices, FK y CHECK nuevos verificados por `db:check`. |
| Datos originales | Huellas de todas las columnas originales de las 27 tablas iguales al respaldo; solo `horus_migrations` ganó sus dos filas. `convocatorias` no tenía filas, así que no hay ediciones antiguas afectadas. |
| Integridad referencial | **22 FK, sin huérfanos.** |
| Respaldo posterior | `horus-horus_db-20261023-213314.sql.gz`, SHA-256 `f284d736e61f9a0d74837673a6cb0e2cbeff7d4cf9862f39f5be9b4c6e549a9a`, 30 tablas, 150 filas, 18 migraciones; firma verificada y restauración exacta en clon desechable. |

No se ejecutó SQL de escritura adicional, no se cambiaron cuentas, credenciales ni `.env`, y no se insertaron datos
de prueba en `horus_db`. Los respaldos no están cifrados ni tienen copia externa: sigue pendiente esa política.

## Verificación nueva de la misión final (23 de octubre de 2026)

La inspección parte de `anderson`, commit publicado `88b8bdb6e4d4320cbf8c4f63dd316d1cad8339f6`,
con árbol limpio y los dos stashes históricos intactos. El shell ofrecía Node 24; los comandos de esta operación
usan **Node 22.23.3** ya instalado, sin instalar dependencias ni cambiar la configuración del usuario.

Se confirma de nuevo `127.0.0.1:3306/horus_db`, MySQL **8.0.46**, UUID
`dc5bb32a-a7b2-11f1-913f-14b5cd19372a`: **27 tablas InnoDB, 148 filas y 16 migraciones**.
Solo están pendientes las dos migraciones enumeradas abajo; Sesiones sigue retirada y sin registro.
`db:check` previo sale con código 1 exclusivamente por columnas, tablas, índices y restricciones de esas dos migraciones.
La integridad referencial del origen pasa: **17 claves foráneas, sin huérfanos**.
No se encontraron vistas, triggers, rutinas ni eventos que el respaldo de tablas pudiera omitir.
Había aproximadamente **243 GiB libres** en C: antes de las operaciones.

Respaldo nuevo tomado a las **15:28 del 23/10/2026 (America/Lima)**, fuera del repositorio:

- Directorio privado: `%USERPROFILE%\.horus-respaldos\mision-final-20261023-a6421ba2\source-backup\`.
- Archivo: `horus-horus_db-20261023-202804.sql.gz`, **13 884 bytes**, con manifiesto y archivo `.sha256`.
- SHA-256: `ed82f63ab5229ba60855920b4cf3566f4f1f751cb91d0827ba3c1b1901a77daf`.
- Incluye estructura y las **148 filas**, también `rate_limit_buckets` mediante `--include-rate-limits`.
- ACL sin herencia: acceso únicamente al operador y SYSTEM. **No se ha demostrado cifrado ni copia externa**;
  la ACL y SHA-256 no sustituyen esas medidas. No moverlo a Git ni a almacenamiento compartido sin protección.

La copia se restauró con `scripts/restore.cjs` en un **MySQL nativo desechable 8.0.46**, con directorio, puerto
y UUID distintos del origen. Se compararon todas las filas mediante SHA-256 por tabla, incluidas columnas generadas:
**27/27 tablas y 148/148 filas idénticas**, 16 migraciones y las 17 claves foráneas íntegras.
El manifiesto y el verificador también aprobaron firma, sentencias y recuentos.

En un clon limpio, una cuenta de mantenimiento **sin privilegios globales ni DROP** aplicó las dos migraciones:
**18 migraciones, 30 tablas, `db:check` 0, datos originales conservados** (excepto las dos filas nuevas del registro
de migraciones), repetición idempotente e integridad referencial correcta. Otra cuenta con solo SELECT ejecutó
`db:check` y un respaldo del clon actualizado; su restauración volvió a coincidir exactamente.
La integridad del clon actualizado verifica **22 claves foráneas, sin huérfanos**.
Las instancias propias se detienen al terminar; se conservan respaldos y evidencia privada.

La comparación de lectura de las **15:41** confirmó que el esquema, las 148 filas y `backend/.env` del origen
seguían idénticos. No había otras conexiones a `horus_db` en esa muestra; **eso no acredita una ventana futura
sin escritores**. Si el origen cambia antes de aprobar la operación, repetir respaldo y restauración.
La lectura final de las **16:01** volvió a confirmar esos mismos datos, DDL, migraciones y `.env`, sin huérfanos.

**Nota posterior:** la activación real se ejecutó después; ver «Activación real» al inicio.
En el momento de esta verificación, la etapa C del encargo exigía aprobación expresa y separada. Los comandos reales
siguen siendo `npm run db:migrate` y `npm run db:check` desde `backend/`, con Node 22, el destino anterior comprobado
inmediatamente antes y una ventana sin escritores confirmada. No cambiar `.env` ni cuentas como parte de esta aprobación.

## Destino y evidencia

Lectura de esta operación: `127.0.0.1:3306/horus_db`, MySQL **8.0.46**, UUID
`dc5bb32a-a7b2-11f1-913f-14b5cd19372a`, 27 tablas y 16 migraciones registradas.
Solo faltan, en este orden:

1. `20261020-preinscripciones`.
2. `20261023-convocatoria-horarios`.

La migración `20261020-sesiones-academicas` está retirada y no registrada en este destino; no aplicarla.
Docentes conserva su migración y sus dos tablas históricas. No ejecutar `db:init` ni Prisma Migrate.

Se verificaron las firmas de los 66 artefactos privados del cierre anterior y la coincidencia del código con su
inventario SHA-256. El ensayo 8.0.46 restauró el origen en un clon, alcanzó **18 migraciones**, obtuvo `db:check` 0,
conservó recuentos y hashes de todas las columnas originales, repitió la migración sin cambios y completó
backup/restauración del clon actualizado. Evidencia privada en
`%USERPROFILE%\.horus-respaldos\cierre-backend-20261023-1940\attempt3\`.
Este ensayo no es una ventana real ni demuestra ausencia actual de escritores.

## Antes de autorizar la ejecución

1. Registrar responsable, commit completo, servidor/UUID/base y ventana sin escritores; detener API, tareas y otros
   clientes que escriban. Confirmar por separado la autorización. El código actual tiene columnas académicas nuevas
   que se seleccionan desde Ediciones y Matrículas: migrar antes de arrancarlo sobre ese destino.
2. Inyectar `DB_*` en un proceso de mantenimiento privado con Node 22. No cambiar `.env` ni credenciales por comodidad.
   En la preparación inicial la separación aún no estaba aplicada; después se completó en la etapa B local
   ([Privilegios MySQL](privilegios-mysql-propuesta.md)). Para otra base, verificar su propia cuenta de mantenimiento.
3. Repetir la identidad y la lista de migraciones mediante consultas de lectura; detener si difieren del inventario.

```sql
SELECT @@server_uuid, VERSION(), DATABASE();
SELECT name FROM horus_migrations ORDER BY name;
SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME;
```

4. Ejecutar `npm run db:check` antes de migrar y conservar su salida privada: se espera incompatibilidad por las
   estructuras pendientes. Cualquier problema adicional requiere diagnóstico, no ignorarlo.
5. Preparar un directorio privado fuera de Git/OneDrive, con ACL solo de operador/SYSTEM y almacenamiento cifrado
   aprobado. Tomar un respaldo nuevo **durante la ventana**, verificarlo y restaurarlo en otro MySQL desechable
   con UUID distinto. No usar el respaldo antiguo como sustituto de este paso. Si cambia el origen, repetir.
   Respaldar uploads por separado para una recuperación integral.

## Comandos preparados

Desde `backend/`, en el proceso cuyo destino y credencial se verificaron. Sustituir las rutas privadas después de
aprobar su almacenamiento; no escribir contraseñas en comandos ni en el historial.

```powershell
node --version # Debe ser 22.x.
npm run db:check # Antes: salida 1 solo por las dos migraciones pendientes, revisar el detalle.
$backupDir = '<DIRECTORIO_PRIVADO_AUTORIZADO>'
npm run db:backup -- --dir=$backupDir --include-rate-limits
if ($LASTEXITCODE -ne 0) { throw 'Respaldo fallido: detener.' }
$backupFile = (Get-ChildItem -LiteralPath $backupDir -Filter '*.sql.gz' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
if (-not $backupFile) { throw 'No se encontró respaldo: detener.' }
npm run db:restore -- --file=$backupFile --verify-only
if ($LASTEXITCODE -ne 0) { throw 'Firma/contenido inválido: detener.' }
```

La restauración del ensayo debe hacerse en **otro proceso con DB_* del servidor desechable**, verificando primero
su UUID y que no contiene bases ajenas. Comando preparado para ese proceso, con el archivo privado elegido:

```powershell
npm run db:restore -- --file=$backupFile --target=horus_restore_prehorarios_ensayo --yes
```

El destino debe ser nuevo o vacío. Validar estructura, recuentos e integridad; no ejecutar este ensayo en el servidor real.

**Solo tras autorización expresa, ventana sin escritores y respaldo/restauración aprobados**, volver al proceso
de mantenimiento del origen y repetir identidad/pendientes inmediatamente antes de este bloque:

```powershell
npm run db:migrate
if ($LASTEXITCODE -ne 0) { throw 'Migración detenida: no reintentar sin inspección.' }
npm run db:check
if ($LASTEXITCODE -ne 0) { throw 'Esquema incompatible: mantener la ventana y diagnosticar.' }
```

## Comprobaciones posteriores

- Identidad del destino sin cambios y 18 migraciones activas; solo las dos nuevas añadidas. Sin registro ni tabla
  de Sesiones en este origen. Conservar Docentes, Certificados y el historial existentes.
- Tres tablas nuevas inicialmente vacías: `preinscripciones`, `preinscripciones_historial`, `convocatoria_horarios`.
  Cambios DDL previstos en `convocatorias` y `matriculas`; cotejar constraints/índices con `db:check`.
- Recuentos y hashes de las columnas originales iguales al respaldo de la ventana. Las ediciones anteriores
  mantienen `minimo_apertura=NULL`, `codigo_publico=NULL` y recepción `cerrada`; no habilitarla automáticamente.
- Comprobar con la cuenta de aplicación login, permisos, consulta de Ediciones/Matrículas y GET de Horarios.
  Las escrituras funcionales de prueba requieren cuentas/datos ficticios en el clon o autorización explícita adicional
  sobre los datos reales; no insertar pruebas en `horus_db` por defecto. El healthcheck no sustituye estas comprobaciones.
- Nuevo backup posterior, verificación y registro privado del resultado. Reabrir escritores solo al aprobar la revisión.

## Fallo parcial y recuperación

MySQL DDL no se revierte con ROLLBACK. Si un ALTER se aplicó pero falta su registro, mantener escritores detenidos,
guardar el error seguro, consultar `horus_migrations`, `SHOW CREATE TABLE` y metadatos de las tablas afectadas.
No editar el registro ni reintentar ciegamente. El migrador tolera duplicados concretos de Preinscripciones para
completar una interrupción, pero primero debe confirmarse que la estructura existente coincide con la esperada.

Restaurar el respaldo en una base **nueva y aislada**, comprobar datos/estructura y ensayar la corrección allí.
No restaurar encima de `horus_db`, borrar tablas ni promover el clon automáticamente. La decisión de reparación
o cambio de destino requiere nueva autorización y mantener preservado el origen. Conservar el commit y la
configuración anteriores; volver solo al código no deshace una migración ni demuestra compatibilidad.
