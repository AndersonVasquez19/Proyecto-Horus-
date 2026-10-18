# Horus Group — Sistema académico (Laravel 13 + Filament 5)

Primera versión del módulo de **gestión académica** del «Sistema web de gestión académica y atención al usuario con asistente virtual para Horus Group SRL – Cajamarca». Sustituye los registros manuales en Excel por un registro centralizado de estudiantes, cursos, ediciones y matrículas.

No es un LMS: no tiene clases virtuales, pagos, notas ni asistencia.

## Reconstrucción en otro equipo

Los pasos siguientes documentan una instalación inicial en una **copia nueva**, sin datos existentes. No constituyen autorización para ejecutarlos sobre el entorno habitual. Los comandos de ejemplo usan PowerShell y se ejecutan desde `backend-laravel/`.

### Requisitos

- PHP CLI 8.4.1 o superior compatible con `composer.lock`; el entorno de referencia usa PHP 8.4.26. Aunque `composer.json` declara `^8.3`, el lockfile completo exige al menos 8.4.1.
- Composer 2 y extensiones requeridas por el lockfile. Para SQLite y las pruebas, habilitar `pdo_sqlite` y `sqlite3`; comprobar también `intl`, `mbstring`, `dom`, `xml` y las demás exigencias con `composer check-platform-reqs --lock`. No usar `--ignore-platform-reqs` para sortear errores.
- Permisos de escritura en `storage/`, `bootstrap/cache/` y, una vez autorizada su preparación, `database/`. `vendor/`, `.env` y la SQLite local se generan en cada equipo y no se versionan.
- Node/npm no son necesarios para el panel con el CSS estático actual; consultar el apartado de recursos y lockfiles.

```powershell
cd backend-laravel
php -v
composer --version
composer check-platform-reqs --lock
```

### Dependencias y entorno privado

En la copia nueva, instalar las versiones fijadas, incluidas las dependencias de desarrollo para las pruebas:

```powershell
composer install --no-interaction --prefer-dist
```

Los hooks `post-autoload-dump` descubren paquetes y publican recursos Filament; no ejecutan migraciones. **No usar `composer setup`**: el script actual encadena migraciones con `--force`, instalación npm y build. Tampoco usar `composer create-project`, `composer update` ni `--seed` como sustitutos de esta reconstrucción.

Crear `.env` solo si no existe; este bloque se detiene para evitar sobrescribir una configuración previa:

```powershell
if (Test-Path -LiteralPath .env) { throw 'Ya existe .env: revisar el entorno antes de continuar.' }
Copy-Item -LiteralPath .env.example -Destination .env
```

Revisar el nuevo `.env` sin publicarlo: `APP_ENV=local`, `APP_LOCALE=es`, `DB_CONNECTION=sqlite` y `APP_URL=http://127.0.0.1:8000`. Para la SQLite nueva estándar, dejar `DB_DATABASE` sin definir (usa `database/database.sqlite`) y `DB_URL` sin definir. No reutilizar credenciales ni rutas de otro equipo. `MAIL_MAILER=log` evita envíos externos, pero los logs también son privados.

Generar una clave **solo para ese entorno nuevo**:

```powershell
php artisan key:generate
```

No regenerar APP_KEY en una instalación existente ni compartirla. El panel se muestra en español mediante `EstablecerIdiomaPanel`.

### Preparación explícita de una SQLite nueva

Este paso escribe datos y requiere autorización para esa copia y ese destino. Antes, verificar que no haya configuración cacheada de otro entorno, `DB_URL` ni `DB_DATABASE` heredadas que cambien el destino. No copiar una base personal al repositorio.

```powershell
if (Test-Path -LiteralPath database/database.sqlite) { throw 'La base ya existe: no continuar con la preparación inicial.' }
New-Item -ItemType File -Path database/database.sqlite -ErrorAction Stop | Out-Null
# Solo tras comprobar que Laravel apunta a ese archivo nuevo y vacío:
php artisan migrate
```

No ejecutar `migrate:fresh`, `migrate:refresh`, `migrate:reset`, `db:wipe` ni rollback sobre bases existentes. Una base con datos requiere revisión de migraciones, respaldo privado verificado y autorización específica; no se reinicializa para resolver un fallo. No ejecutar seeders: no son necesarios para reconstruir el esquema y pueden crear cuentas de ejemplo.

### Pruebas aisladas

Con las dependencias y la configuración nueva preparadas:

```powershell
php vendor/phpunit/phpunit/phpunit --no-progress
```

`phpunit.xml` selecciona SQLite **`:memory:`**, correo/sesiones/caché en memoria y cola síncrona. `tests/TestCase.php` aborta antes de las operaciones de prueba si la conexión no es SQLite en memoria o tiene una URL configurada. Los casos de concurrencia usan archivos SQLite temporales propios; no usan la base habitual. No retirar esas salvaguardas. Si existe configuración cacheada, detenerse y revisarla antes de autorizar su limpieza. No se necesita migrar la SQLite de desarrollo para ejecutar las pruebas.

### Servidor local y acceso

```powershell
php artisan serve --host=127.0.0.1 --port=8000
```

La ruta depende de la configuración existente: con seguridad activa es `/gestion`; en `APP_ENV=local` sin `HORUS_SEGURIDAD_ACTIVA=true`, se mantiene la compatibilidad `/admin`. Fuera de local, la seguridad siempre está activa. No cambiar rutas ni desactivar seguridad para resolver problemas de acceso. El script de arranque opcional aún anuncia `/admin`; usar la ruta efectiva del entorno.

Una instalación vacía no trae cuentas administrativas. Crear una cuenta, asignar rol y activar seguridad son operaciones separadas que necesitan autorización, identificación del destino y comprobación de acceso; no se automatizan en esta guía. Ver [preparación de seguridad](docs/seguridad-fase-1.md) y [registro histórico de activación local](docs/activacion-seguridad-local-2026-10-17.md).

### Recursos estáticos y lockfiles

`composer.lock` fija Laravel, Filament, Livewire y las herramientas PHP y debe versionarse junto con `composer.json`. No requiere Laravel Boost.

El tema Horus Academic se registra desde `resources/css/horus-academic.css`; su copia publicada `public/css/app/horus-academic.css` y el logo forman parte del proyecto. Los recursos propios de Filament se regeneran desde `vendor/` mediante los hooks de Composer o, si hace falta, `php artisan filament:assets`; no necesitan npm.

`package.json` y `vite.config.js` conservan el pipeline Vite/Tailwind del esqueleto. El panel actual no lo consume y `welcome.blade.php` incluye estilos de reserva si no hay manifiesto Vite ni servidor de desarrollo. **Puede posponerse `package-lock.json` para este primer commit**: no hay instalación npm reproducible prometida ni dependencias npm adicionales para el CSS estático. Si se decide usar Vite, habrá que autorizar la instalación, revisar requisitos de Node y generar/versionar su lockfile antes de usar `npm ci`. No ejecutar `npm install` solo para producir ese archivo.

### Arranque local opcional con OPcache (Windows/Laragon)

Desde `backend-laravel/`:

```powershell
powershell -NoProfile -File scripts/serve-local.ps1
# http://127.0.0.1:8001/gestion con seguridad activa; otro puerto: añadir -Port 8002
```

Usa el PHP del PATH y su OPcache existente, sin instalar paquetes ni modificar `php.ini` o `.env`. Comprueba cambios de archivos en cada solicitud (`validate_timestamps=1`, `revalidate_freq=0`). Termina con Ctrl+C; `php artisan serve` sigue disponible. La primera carga debe llenar la caché y puede tardar más. Es exclusivamente para desarrollo local.

Mediciones, límites y comprobaciones: [Diagnóstico de rendimiento de Filament](docs/rendimiento-filament-2026-10-17.md).

## Tablas y relaciones

```text
cursos 1 ──< ediciones 1 ──< matriculas >── 1 estudiantes
```

| Tabla | Campos principales | Restricciones |
| --- | --- | --- |
| `estudiantes` | `tipo_documento`, `numero_documento` (texto, opcional), `nombres`, `apellidos`, `telefono`, `email`, `observaciones`, `nombre_busqueda` | UNIQUE (`tipo_documento`, `numero_documento`); CHECK de formato del documento |
| `cursos` | `nombre`, `codigo`, `descripcion`, `activo` | `nombre` y `codigo` únicos |
| `ediciones` | `curso_id`, `nombre`, `fecha_inicio`, `fecha_fin`, `cupo`, `estado` | UNIQUE (`curso_id`, `nombre`); CHECK `fecha_fin >= fecha_inicio`; CHECK `cupo > 0`; FK `curso_id` RESTRICT |
| `matriculas` | `estudiante_id`, `edicion_id`, `fecha_matricula`, `estado`, `observaciones` | UNIQUE (`estudiante_id`, `edicion_id`); FK RESTRICT en ambas claves |

- Ninguna clave foránea borra en cascada: el historial académico no se pierde por accidente.
- Los estados se guardan como `enum` (en SQLite, `CHECK ... IN (...)`).
- `nombre_busqueda` es una clave derivada («apellidos nombres» en minúsculas y sin tildes) para buscar y detectar homónimos. La calcula el modelo; no se edita.
- SQLite no admite `ALTER TABLE ... ADD CONSTRAINT`, así que las CHECK adicionales se crean como triggers (`app/Support/RestriccionesBd.php`). En MySQL/PostgreSQL se usan CHECK nativos. La rama MySQL está verificada contra un MySQL 8.4 desechable (suite opcional `phpunit.mysql.xml`), con la migración `2026_10_18_000000_endurece_restricciones_mysql` que la iguala a SQLite; PostgreSQL y MariaDB no se han probado. Traslado y diferencias: [docs/mysql-traslado.md](docs/mysql-traslado.md).

## Reglas de negocio

### Estudiantes

- `DNI`: exactamente 8 dígitos, guardado como texto (se conservan los ceros iniciales). `CE` y `PASAPORTE`: de 4 a 20 letras o dígitos.
- `Sin documento registrado`: el número queda vacío. Nunca se inventa un DNI.
- Documento único por tipo (validación en el formulario, en el modelo y UNIQUE en la base de datos).
- Al registrar a alguien con el mismo nombre que otro estudiante, se avisa del **posible duplicado**. Los dos registros se conservan para revisarlos manualmente: no se fusionan solos. El listado tiene el filtro «Posibles duplicados por nombre».
- Búsqueda por DNI (también parcial) o por nombre, sin distinguir mayúsculas ni tildes.

### Ediciones

Un curso puede dictarse muchas veces. Las fechas y el cupo son opcionales. Una edición `Cancelada` no admite matrículas, y no se puede cancelar mientras tenga matrículas vigentes. El cupo no puede quedar por debajo de las matrículas vigentes.

### Matrículas

- Un estudiante solo tiene una matrícula por edición, pero puede estar en varias ediciones del mismo curso.
- Toda matrícula nueva empieza como `Matriculado`. La fecha de matrícula es opcional.
- El estudiante y la edición de una matrícula no se cambian: si hubo un error, se anula y se registra otra.
- Las matrículas **no se eliminan**: se cambia su estado.
- Respetan el cupo de la edición. Ocupan plaza los estados `Matriculado` y `Culminado`.

| Estado | Significado | Puede pasar a |
| --- | --- | --- |
| Matriculado | Inscrito en la edición (p. ej. aparece en la hoja del curso). **No** implica pago, asistencia ni aprobación. | Culminado, Retirado, Anulado |
| Culminado | El personal confirmó que cumplió el curso. Nunca se asigna automáticamente. | Matriculado (corrección) |
| Retirado | Dejó el curso después de matricularse. | Matriculado, Anulado |
| Anulado | Registro sin efecto (error o anulación administrativa). Se conserva. | Matriculado (reactivación) |

### Borrados

No se puede eliminar un estudiante con matrículas, una edición con matrículas ni un curso con ediciones. Lo impide el modelo (con un mensaje claro) y, además, la base de datos (FK RESTRICT). En el panel, la acción «Eliminar» se oculta en esos casos.

## Qué incluye el panel

Grupo de menú **Gestión académica**:

- **Estudiantes**: alta y edición, búsqueda por DNI o nombre, filtros, ficha con el historial de matrículas y acción «Matricular en una edición».
- **Cursos**: alta y edición, activo/inactivo y ediciones del curso.
- **Ediciones**: alta y edición, filtros por curso y estado, y estudiantes matriculados con la acción «Matricular estudiante».
- **Matrículas**: alta, búsqueda, filtros por estado, curso y edición, y acción «Cambiar estado» (solo ofrece las transiciones permitidas).
- **Escritorio**: totales reales de estudiantes, cursos activos, ediciones y matrículas, y matrículas por estado, con mensajes claros cuando no hay datos.

## Pruebas

La suite incluye `tests/Feature/Academico` (reglas de modelo y base de datos, historial, aislamiento y concurrencia), `tests/Feature/Panel` (acceso, roles, revocación HTTP/Livewire, formularios, acciones y tema) y `tests/Unit`. `tests/MySql` es opcional y solo se ejecuta contra un MySQL desechable con `scripts/test-mysql.ps1`. Ejecutar el comando aislado indicado arriba; los resultados históricos de los documentos no sustituyen una ejecución en el nuevo equipo.

## Pendiente (siguientes entregas)

- Importación del Excel `CURSOS 2024.xlsx`. Una hoja por curso; aparecer en una hoja = `Matriculado`, sin fechas. Hallazgos de su estructura:
  - Apellidos y nombres van en **una sola columna**: dividirlos requiere una regla y revisión manual.
  - El DNI está guardado como **número** (pueden haberse perdido ceros iniciales; hay al menos un valor de 7 dígitos): normalizar con revisión, no inventar.
- Emisión y verificación de certificados (usará el estado `Culminado`).
- Administración de usuarios desde una interfaz específica; la seguridad por roles ya está implementada y el acceso requiere rol y estado autorizados cuando está activa.
- Base MySQL definitiva y traslado real desde SQLite (preparado y probado en desechable; requiere autorización).
- Integración con el frontend React, chatbot y Resend (siguen en `backend/`, sin cambios).
