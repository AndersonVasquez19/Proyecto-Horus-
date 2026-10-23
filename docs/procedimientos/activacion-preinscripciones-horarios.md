# Activación controlada de Preinscripciones y Horarios

Preparado el 23 de octubre de 2026. **No ejecutado: falta autorización específica de escritura.**
El push del código no activa MySQL. No desplegar ni usar los módulos afectados sobre una base sin migrar.

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
   La separación de cuentas se prepara en [Privilegios MySQL](privilegios-mysql-propuesta.md); todavía no está aplicada.
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
npm run db:backup -- --dir=$backupDir
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
