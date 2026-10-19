# CI del backend Laravel

El workflow `.github/workflows/laravel.yml` valida Laravel sin desplegar ni modificar los otros paquetes. Se activa en pushes a `anderson` y Pull Requests cuya rama de destino sea `anderson`, si cambian archivos de `backend-laravel/`, el propio workflow o las instrucciones y atributos Git de la raíz. No cambia `.github/workflows/ci.yml`.

## Ejecución en GitHub

1. Un runner desechable Ubuntu 24.04 obtiene el código sin conservar credenciales Git. Las acciones están fijadas por SHA; el token solo tiene `contents: read`.
2. Prepara PHP 8.4, Composer 2 y las extensiones del lockfile, incluidas `pdo_sqlite`, `sqlite3`, `intl`, XML y ZIP. No instala paquetes npm ni Laravel Boost.
3. Genera un `.env` nuevo y una APP_KEY aleatoria sin mostrarlos. Se detiene si encuentra un `.env` o `database/database.sqlite` inesperados. No usa secrets del repositorio ni credenciales locales.
4. Valida `composer.json` y `composer.lock`, comprueba requisitos e instala las versiones fijadas. Los hooks existentes de Composer publican los recursos de Filament; no se usa `composer setup`, que también instala npm y migra.
5. Comprueba las migraciones en SQLite `:memory:`. Esa base desaparece al terminar el proceso. PHPUnit vuelve a preparar los esquemas efímeros que necesita cada caso.
6. Ejecuta **toda** la suite PHPUnit en serie. Las pruebas de bloqueo y concurrencia conservan sus SQLite en archivo, modos DELETE/WAL, conexiones y procesos independientes en directorios aleatorios `storage/framework/testing/robustez-*`; sus bloques `finally` cierran procesos y eliminan únicamente sus archivos. No se sustituyen por memoria ni se omiten.
7. Ejecuta Pint con `--test`: informa errores y no reescribe archivos. Se ejecuta también si falla PHPUnit, siempre que la instalación de dependencias haya terminado correctamente. No se ocultan fallos con exclusiones o `continue-on-error`.
8. Escribe un resumen de estados y recuentos en GitHub. Conserva solo el JUnit durante siete días; nunca sube `.env`, logs, SQLite, sesiones, vendor ni respaldos. El job tiene un límite de veinte minutos y cancela ejecuciones anteriores de la misma referencia.

## Aislamiento de las pruebas

`phpunit.xml` utiliza `tests/bootstrap.php`. Este reemplaza variables heredadas antes del autoload: SQLite en memoria, caché/sesión/correo en arrays, cola síncrona, logs descartados y credenciales de servicios vacías. Genera una clave temporal y elige una ruta inexistente de caché de configuración; no limpia ni modifica la caché de desarrollo.

`tests/TestCase.php` arranca la aplicación desde las rutas del repositorio, con un directorio de entorno exclusivo de tests y el nombre deliberadamente ausente `.env.phpunit`. El bootstrap rechaza ese archivo si alguien lo crea. No carga `.env` ni `.env.testing` de desarrollo. Valida el destino SQLite después de cargar configuración y **antes** de registrar proveedores y ejecutar migraciones de pruebas. Los workers de concurrencia también evitan el entorno local, y validan sus directorios y conexiones temporales.

Cada aplicación de prueba bloquea solicitudes HTTP de Laravel no simuladas mediante `Http::preventStrayRequests()`. Se mantienen permitidos los fakes. Los correos usan el transporte array y no se necesitan claves de WhatsApp, Resend, IA u otros proveedores. Esta barrera HTTP no es una sandbox de red para código PHP arbitrario: cualquier incorporación futura que use cURL directo, sockets o ejecutables externos requiere revisión y simulación. Composer y las acciones sí necesitan red para descargar dependencias; esto no equivale a contactar proveedores desde las pruebas.

## Verificación local sin tocar la base habitual

Desde `backend-laravel/`, con las dependencias **ya instaladas**:

```powershell
composer --no-plugins --no-scripts validate --strict --no-check-publish --no-interaction
composer --no-plugins --no-scripts check-platform-reqs --lock --no-interaction
php vendor/phpunit/phpunit/phpunit --no-progress
php vendor/bin/pint --test
```

No ejecutar el bloque de preparación del runner, `composer setup`, `artisan migrate` ni `config:clear` sobre el entorno habitual. La suite sí crea y migra bases propias efímeras; no apunta a `database/database.sqlite`.

Las regresiones `EntornoPruebasTest` y `BootstrapPruebasTest` verifican el destino de pruebas, el rechazo de HTTP no simulado y el reemplazo de variables heredadas incompatibles. No se necesitan rutas personales de Windows o Laragon; los procesos utilizan `PHP_BINARY` y rutas relativas al repositorio.

## Publicación y primera ejecución

Este cambio no demuestra una ejecución de GitHub. Tras revisar el diff y autorizar commit/push, publicar únicamente los archivos de CI y soporte de pruebas aprobados en `anderson`. El push activará **Laravel CI**; abrir la pestaña Actions del repositorio y revisar instalación, migraciones efímeras, PHPUnit, Pint, resumen y JUnit. El CI previo de React/NestJS puede ejecutarse por sus propios disparadores, que se conservan.

No declarar que pasó en GitHub hasta comprobar una ejecución real exitosa. Los filtros por rutas pueden dejar un check requerido pendiente cuando el workflow se omite; antes de configurar protección de ramas, revisar ese comportamiento y escoger los checks requeridos deliberadamente. Esta tarea no configura protecciones ni despliegues.
