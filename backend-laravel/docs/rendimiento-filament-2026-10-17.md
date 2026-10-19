# Rendimiento de Filament — 17 de octubre de 2026

## Resultado

En el recorrido HTTP aislado, el coste dominante es cargar, compilar y arrancar el código PHP sin OPcache. Activar OPcache solo en el proceso de desarrollo reduce las medianas de las solicitudes posteriores aproximadamente un 75–85 %. SQL no explica la demora en este conjunto pequeño de datos ficticios.

No se usó una cuenta administrativa real ni su contraseña. No se midió el tiempo desde el clic hasta el pintado en el navegador del usuario: no se puede dar por explicada toda su espera de 1–3 segundos, ni extrapolar estos resultados a un volumen de datos mayor.

## Configuración comprobada

- Git inicial: `?? backend-laravel/`; toda la aplicación Laravel ya existía sin seguimiento. No se hizo commit ni push.
- Laravel 13.37.0, Filament 5.10.2, Livewire 4.4.7, PHP 8.4.26 ZTS.
- Servidor existente: `php artisan serve --host=127.0.0.1 --port=8000`; hijo PHP con `-S`, SAPI `cli-server`.
- Binario real: `C:\laragon\bin\php\php-8.4.26-Win32-vs17-x64\php.exe`.
- INI confirmado mediante HTTP en ese mismo servidor: `C:\laragon\bin\php\php-8.4.26-Win32-vs17-x64\php.ini`; sin otros INI cargados. OPcache y Xdebug no estaban cargados. `realpath_cache_size=4096K`, `memory_limit=512M`.
- Configuración local consultada sin mostrar secretos: debug activo, SQLite, sesiones y caché en base de datos.
- La DLL `ext/php_opcache.dll` ya estaba instalada. No se instalaron dependencias, incluido Laravel Boost: la restricción explícita de no instalar prevalece sobre el bootstrap genérico de `AGENTS.md`.

La sonda temporal exponía únicamente estos parámetros de rendimiento, sin `phpinfo()`, variables de entorno, credenciales ni sesiones. Se retiró después de verificarla.

## Método

1. Solicitudes GET secuenciales al servidor existente, sin credenciales ni redirecciones automáticas: `curl.exe --silent --output NUL --write-out 'status=%{http_code} ttfb=%{time_starttransfer} total=%{time_total}\n' http://127.0.0.1:8000/admin/login`. Se repitió con `/up`.
2. Servidor separado en `127.0.0.1:8017`, mismo binario e INI, misma aplicación y configuración de debug. SQLite **nueva** en `storage/app/private/perf-20261017/fixture.sqlite`, comprobada antes de ejecutar SQL. Solo se aplicó `migrate` en esa base nueva; nunca `migrate:fresh` sobre una base persistente.
3. Datos ficticios: 1 usuario, 1 curso, 1 edición con cupo 20, 11 estudiantes y 10 matrículas. Login real de Filament contra esa cuenta ficticia, cookies y CSRF válidos; POST al endpoint Livewire generado por la aplicación con sus snapshots y checksums originales. No se omitió autenticación ni protección CSRF.
4. Sesiones en la SQLite aislada. Caché de aplicación en `array`, correo en `array`, colas síncronas y clave de aplicación ficticia. Las vistas compiladas de la instrumentación se aislaron también. La caché `array` difiere del servidor habitual; se mantuvo igual en ambas variantes.
5. Instrumentación temporal por solicitud: autoload, bootstrap de Laravel, manejo HTTP, terminación, número de consultas y suma de sus duraciones con `DB::listen`. Se guardó la forma de SQL, nunca sus bindings. SQL está incluido en el tiempo de manejo: no se suma de nuevo al total. El tiempo SQL no incluye todo el trabajo de hidratar modelos.
6. Secuencia: sin OPcache → con OPcache → repetición con caché PHP caliente → sin OPcache otra vez. Misma fixture, código y rutas. Sin tráfico paralelo del propio medidor. El retorno a tiempos altos al desactivar OPcache respalda el efecto de esa variable, aunque sigue existiendo variabilidad del equipo.
7. GET: seis muestras por ruta, descartando la primera para la tabla de cargas posteriores (n=5). Acciones Livewire: seis muestras (n=6). Totales HTTP hasta leer el cuerpo completo; TTFB se midió por separado. No incluye descargar todos los assets, ejecutar JavaScript, debounce ni pintar el DOM.

Las solicitudes Livewire medidas buscaron estudiantes, cambiaron el estudiante del formulario de matrícula y abrieron/cerraron el modal «Cambiar estado». Abrir el modal se comprobó por su respuesta, sin confirmar cambios de estado. Las mutaciones de negocio sí se ejercitan en la suite con SQLite en memoria.

## Primera carga y cargas posteriores

En el servidor original, el primer GET **observado**, sin reiniciarlo, al login respondió en **1.331 ms**; los siguientes, en **528, 526, 547 y 470 ms**. `/up`: **793, 552 y 411 ms**. Todos devolvieron HTTP 200. No representan una caché de sistema operativo vaciada de forma controlada.

Al cierre, el servidor original conservado registró otro `/up` de **2.240 ms**, seguido por **1.294, 973 y 1.845 ms**, todos HTTP 200. Esta variación también aparece sin una sección de negocio ni una cuenta autenticada. No se perfiló su causa adicional: las medianas del experimento describen las ventanas medidas, no garantizan un tiempo constante en este equipo ni explican por sí solas cada pico.

En el servidor instrumentado, la primera solicitud del proceso con OPcache vacío tardó **1.663 ms**; cargar su autoload y arrancar Laravel consumieron aproximadamente **1.102 ms**. La primera apertura posterior autenticada de Estudiantes tardó **456 ms**. No se promete una mejora de la primera solicitud: llenar OPcache tiene un coste y estos primeros GET no tienen idéntico estado de cachés de vistas/disco.

Las siguientes son medianas de la repetición sin OPcache y la repetición con OPcache caliente; la vuelta a desactivarlo se ejecutó después de la variante optimizada.

| Solicitud | Sin OPcache, total ms | Con OPcache, total ms | SQL sin/con, ms |
| --- | ---: | ---: | ---: |
| `/up` | 396 | 59 | 0 / 0 |
| Escritorio | 565 | 117 | 9,18 / 6,30 |
| Estudiantes | 694 | 145 | 8,43 / 6,33 |
| Ediciones | 663 | 158 | 7,52 / 19,00 |
| Matrículas | 723 | 174 | 8,09 / 9,01 |
| Nueva matrícula | 606 | 127 | 10,96 / 6,77 |
| Editar edición con matrículas | 602 | 151 | 13,83 / 10,28 |
| Livewire: buscar estudiante | 578 | 137 | 9,35 / 6,75 |
| Livewire: seleccionar estudiante | 535 | 98 | 9,37 / 5,59 |
| Livewire: abrir «Cambiar estado» | 534 | 100 | 8,68 / 6,62 |
| Livewire: cerrar el modal | 615 | 150 | 8,36 / 7,57 |

Por ejemplo, en Estudiantes la mediana del autoload pasó de **45,6 a 1,6 ms**; el bootstrap, de **290,3 a 42,0 ms**; el manejo HTTP, de **342,0 a 99,7 ms**. Las medianas de fases independientes no deben sumarse como si pertenecieran a una única muestra. En `/up`, sin consultas SQL, también aparece la mejora.

Detalle numérico con n, TTFB, fases y rangos: [CSV de mediciones](mediciones/filament-2026-10-17.csv). Los JSONL y herramientas de diagnóstico de esta ejecución quedan localmente en `storage/app/private/perf-20261017/`, bajo el almacenamiento ignorado por Git. Las ejecuciones fallidas del propio medidor durante su preparación se excluyen; la tabla usa únicamente `baseline-return` y `opcache-warm` con HTTP 200. Los errores iniciales de formato del payload del medidor no se atribuyen al panel.

## Cambio conservado

`scripts/serve-local.ps1` ofrece un arranque **opcional**, solo para Windows/Laragon, con el router original de Laravel y flags del proceso PHP:

```powershell
# Desde backend-laravel/; conserva libre el servidor habitual en 8000.
powershell -NoProfile -File scripts/serve-local.ps1
# Puerto diferente:
powershell -NoProfile -File scripts/serve-local.ps1 -Port 8002
```

Activa la extensión existente únicamente si no está ya cargada y fija `opcache.enable=1`, `opcache.enable_cli=1`, `opcache.validate_timestamps=1`, `opcache.revalidate_freq=0`. Comprueba modificaciones de archivos en cada solicitud; no usa cachés de configuración, rutas ni componentes de producción. [Referencia oficial de PHP](https://www.php.net/manual/es/opcache.configuration.php).

Para revertir basta detener ese proceso con Ctrl+C y volver a `php artisan serve`. No se cambia el arranque habitual, `php.ini`, `.env` ni la configuración de otros proyectos. Como usa directamente el servidor PHP, no incluye el supervisor de reinicios de `artisan serve`; si se cambia un parámetro de arranque o hace falta vaciar OPcache, se reinicia el proceso. No es un servidor para producción.

El lanzador se verificó adicionalmente con el router original, sin la instrumentación: mismo login ficticio, páginas protegidas y 24 solicitudes Livewire del recorrido completo, todas HTTP 200. OPcache activo por HTTP, `validate_timestamps=1`, `revalidate_freq=0`. Una sonda PHP ya caliente cambió de `before` a `after` al editarla sin reiniciar el servidor. El asset `/js/filament/filament/app.js` respondió HTTP 200, JavaScript, en 3,9 ms. La sonda se eliminó y se detuvo el servidor temporal; el servidor original se conservó.

## Cambios descartados y pendientes

- **Consultas repetidas confirmadas:** `EdicionForm` evalúa varias veces `matriculas()->exists()` entre `disabled` y `helperText`: 15 SELECT idénticos en un GET de edición (21 consultas totales). En una muestra con OPcache sumaron **2,99 ms**. Se conserva el código: ese dato no demuestra una mejora perceptible del HTTP completo al memoizarlo. Una futura optimización debe compartir el cálculo solo dentro de la solicitud y mantener fresca la validación al guardar.
- **Selector de ediciones:** ya usa `with('curso')` y `withCount` de plazas vigentes. El formulario de alta observado ejecutó una consulta de ediciones y una de cursos, sin N+1 por edición. No se cambian cupos, filtros de estudiante, estados ni reglas de matrícula. Falta medirlo con un volumen grande representativo antes de paginar o cambiar su carga.
- **Campos `live()`:** documento, estudiante y estado actualizan campos u opciones/textos dependientes. En edición, curso y fecha de inicio son candidatos a revisar, porque sus reglas también se validan al guardar. No se retiró ninguno sin una medición con navegador y comprobación del efecto en validación y formulario.
- **No verificado:** tiempo de pintado, debounce, descargas completas, cola por solicitudes simultáneas del servidor PHP, equipo bajo otra carga y latencia con la cuenta/datos reales. Si persisten 1–3 segundos usando el arranque opcional ya caliente, el siguiente paso es capturar Network/Performance en un flujo concreto, ocultando cookies, tokens y datos personales.

## Pruebas y conservación

- Suite existente completa con `php vendor/phpunit/phpunit/phpunit --colors=never`: **114 pruebas, 400 aserciones, todas correctas**, antes y después del trabajo.
- Repetición con OPcache y los mismos flags locales: **114 pruebas, 400 aserciones, todas correctas**.
- Cobertura existente: DNI y otros documentos, normalización/validación de teléfono, duplicados, matrículas, estados y transiciones, cupos, protección del historial, acceso HTTP y formularios/acciones/widgets reales de Filament. Se mantuvo la salvaguarda que exige SQLite en memoria para PHPUnit.
- Sintaxis del lanzador validada con el parser de PowerShell y arranque HTTP real probado.
- Se inventariaron y compararon por SHA-256 **97 archivos originales** de aplicación, configuración, pruebas y migraciones, incluido `.env`: sin cambios. El README se amplió después de esa comprobación. No se modificaron frontend, NestJS, chatbot, Resend, MySQL, Docker ni bases `horus_*`; no se crearon usuarios reales ni se borraron registros reales.
- Archivos de entrega: este informe, el CSV, `scripts/serve-local.ps1` y la sección del README. No se conserva instrumentación dentro de la aplicación ni una ruta de diagnóstico pública.
