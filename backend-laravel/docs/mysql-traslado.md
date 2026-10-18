# Laravel en MySQL: compatibilidad y traslado desde SQLite

Estado: **preparado y probado contra MySQL 8.4.11 desechable**. No se ha creado ninguna
base definitiva, no se ha cambiado ningún `.env` y la SQLite habitual no se ha migrado
ni modificado. Laravel debe tener una base **propia**; nunca `horus_db` (NestJS).

## Diferencias verificadas y correcciones

| Diferencia (comprobada en MySQL 8.4) | Efecto sin corregir | Corrección |
| --- | --- | --- |
| `REGEXP` con `utf8mb4_unicode_ci` no distingue mayúsculas; `$` admite un `\n` final | El `CHECK` aceptaría CE `abcd` o DNI `12345678\n` | Migración aditiva `2026_10_18_000000_endurece_restricciones_mysql`: `CHAR_LENGTH` + `NOT REGEXP_LIKE(..., '[^0-9]', 'c')` |
| `IN (...)` ignora mayúsculas y espacios finales | Rol `SECRETARIA ` o movimiento `creacion` aceptados | Comparación `CAST(... AS BINARY)` en roles e historial |
| `DATE` trunca la hora **en silencio** | Pérdida de datos al copiar | El traslado aborta si una fecha trae hora distinta de `00:00:00` |
| Índices `UNIQUE` sin distinguir mayúsculas ni tildes (`Programación` = `PROGRAMACION`) | Fallo al copiar nombres que SQLite consideraba distintos | El traslado lo detecta, revierte y nombra el índice (sin citar el dato) |
| SQLite no limita la longitud de `varchar` | MySQL estricto rechazaría el texto | Validación previa por columna |
| `TIMESTAMP` depende de la zona de sesión | Horas desplazadas si el servidor no está en UTC | `DB_TIMEZONE` (nuevo, opcional) en la conexión `mysql`; usar `+00:00` (la app usa UTC) |

En SQLite la migración nueva no hace nada. En MySQL comprueba antes las filas existentes
y, si alguna no cumple, se detiene sin alterar la tabla; cada sustitución es un `ALTER` atómico.
Los bloqueos de matrícula (`lockForUpdate` sobre la edición y lecturas de cupo con bloqueo)
ya estaban preparados para InnoDB y se verificaron con dos procesos reales.

## Configuración futura de `backend-laravel/.env` (no aplicada)

```dotenv
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=horus_laravel        # base exclusiva; nunca horus_db
DB_USERNAME=horus_laravel_app    # usuario propio con permisos solo sobre esa base
DB_PASSWORD=                     # definir en el destino; no versionar
DB_TIMEZONE=+00:00
```

`DB_DATABASE` es compartida por las conexiones `sqlite` y `mysql`: al cambiar a MySQL deja
de apuntar al archivo SQLite. Ejecute `php artisan config:clear` tras editar el `.env`.

## Procedimiento de traslado (requiere autorización)

1. **Respaldo**: detenga Laravel (panel y API), copie `database/database.sqlite` a una ruta
   fuera del repositorio y anote su SHA-256 (`Get-FileHash -Algorithm SHA256`). Trabaje
   siempre con la copia; el original queda como recuperación inmediata.
2. Cree la base `horus_laravel` (utf8mb4, `utf8mb4_unicode_ci`) y su usuario dedicado.
3. Configure el `.env` como arriba y migre **solo esa base**: `php artisan migrate`.
4. Simulacro (copia, verifica y revierte; no deja datos):
   `php artisan horus:trasladar-sqlite-mysql --origen=<copia.sqlite>`
5. Aplicación: `php artisan horus:trasladar-sqlite-mysql --origen=<copia.sqlite> --aplicar --informe=<ruta.json>`

El comando abre el origen en solo lectura y comprueba su SHA-256; exige un destino MySQL/InnoDB
migrado al menos hasta la versión del origen, sin tablas de NestJS y con sus tablas vacías.
Valida todos los valores antes de escribir, copia en una sola transacción conservando los ids
(usuarios con sus hashes de contraseña y roles, estudiantes, cursos, ediciones, matrículas e
historial), compara recuentos y firmas SHA-256 normalizadas por tabla, verifica cada clave
foránea y solo entonces confirma. Después ajusta `AUTO_INCREMENT` para no reutilizar ids que
SQLite ya había usado. Los mensajes e informes no contienen datos personales.

No se trasladan `sessions`, `cache`, `cache_locks`, `jobs`, `job_batches`, `failed_jobs` ni
`password_reset_tokens`: las sesiones abiertas se pierden y cada usuario vuelve a iniciar sesión.

## Recuperación

- Fallo durante el comando: no queda nada escrito (transacción revertida); corrija y repita.
- Después de aplicar: el origen no se modificó. Para volver a SQLite basta restaurar el `.env`
  anterior y `php artisan config:clear`. Los datos creados en MySQL después del traslado no
  existen en SQLite; decida antes de volver.
- Repetir el traslado exige una base MySQL nueva o vaciada (operación destructiva que requiere
  autorización); el comando nunca sobrescribe.

## Pruebas MySQL (opcionales, fuera de `phpunit.xml` y de la CI)

```powershell
.\scripts\test-mysql.ps1                       # suite completa
.\scripts\test-mysql.ps1 -Filtro Traslado      # un subconjunto
```

El script crea un contenedor `mysql:8.4` propio (solo `127.0.0.1`, datos en memoria, clave
aleatoria no mostrada), ejecuta `phpunit.mysql.xml` y elimina siempre ese contenedor.
`tests/MySql/bootstrap.php` exige `HORUS_MYSQL_IT=true`, un servidor loopback, el `server_uuid`
esperado y que no exista `horus_db`; crea y elimina su propia base `horus_laravel_it_<hex>`.
Cubre: esquema e InnoDB, cada `CHECK` endurecido, la migración que se detiene sin cambios, el
ciclo completo `rollback`/`migrate`, cupos, historial, transiciones, instantáneas
`REPEATABLE READ`, las 10 carreras de concurrencia entre procesos y el traslado completo con
sus casos de rechazo.

Pendiente: añadir este job a la CI (requiere decidir el cambio de infraestructura), MariaDB
(no verificada: `REGEXP_LIKE` no existe allí) y bases grandes (la copia es por lotes de 500,
pero no se midió con volúmenes reales).
