# Docker independiente para Laravel

Preparación local; no implica despliegue ni activación de MySQL definitivo. Ejecutar los
comandos desde `backend-laravel/`. No utiliza el Compose, `.env.docker`, usuarios,
redes o volúmenes de NestJS. No hay servicio MySQL en este Compose: nunca crea
`horus_group`, usuarios ni tablas. El arranque solo inicia PHP-FPM y Nginx.

## Diseño e inventario previo

El Compose de la raíz usa el proyecto `horus-local`: frontend/Caddy en
`127.0.0.1:8081`, backend en 3000 interno y MySQL en 3306 interno; red
`horus-local_default`, volúmenes `horus-local_mysql_data` y `horus-local_uploads_data`.
No se modifican esos archivos ni servicios. Se observó además un puerto 3306 del
anfitrión ocupado: no se publica otro MySQL ni se presupone su identidad.

| Servicio Laravel | Puerto | Límite de memoria | Función |
| --- | --- | --- | --- |
| `web` | `127.0.0.1:8082` → 8080 | 64 MiB | Nginx, estáticos y FastCGI |
| `app` | 9000, solo en la red propia | 768 MiB | PHP 8.4 FPM, hasta 3 trabajadores bajo demanda |

Proyecto predeterminado `horus-laravel`; red bridge `horus-laravel_laravel`. Sin
`container_name`, redes externas ni dependencias sobre el Compose existente.
Los nombres se aíslan también al usar `-p <otro-proyecto>`. PHP limita cada petición
a 192 MiB; OPcache usa 128 MiB. Los límites son un punto de partida para 4 GB de RAM,
no una prueba de carga. El servidor, MySQL y otros servicios necesitan memoria adicional.
La compilación de extensiones usa dos trabajos y requiere más memoria temporal.

Las dos imágenes se construyen con el mismo código y lockfile. Composer se ejecuta
dentro de Docker, sin dependencias de desarrollo ni scripts automáticos. Se ejecutan
explícitamente descubrimiento de paquetes y publicación de assets Filament, sin Vite.
El contexto está cerrado por `.dockerignore`: excluye `.env`, SQLite, vendor local,
storage, respaldos, caches y recursos Filament locales. Los recursos se regeneran.
No se cachean rutas durante la construcción: Livewire 4 genera sus rutas con la APP_KEY
efectiva. La clave nunca se genera ni cambia automáticamente al arrancar.

## Configuración privada

Crear un archivo privado **fuera del repositorio**, restringido al operador. No copiar
el `.env` habitual. El prefijo `HORUS_LARAVEL_` evita heredar variables de NestJS.
No mostrar el archivo ni el resultado completo de `docker compose config` o `inspect`:
contienen secretos. Usar `config --quiet`.

| Variable del archivo privado | Valor / condición |
| --- | --- |
| `HORUS_LARAVEL_APP_KEY` | `base64:` y 32 bytes aleatorios codificados; propia y estable |
| `HORUS_LARAVEL_DB_USERNAME` | Cuenta exclusiva de Laravel, nunca root ni la de NestJS |
| `HORUS_LARAVEL_DB_PASSWORD` | Clave privada exclusiva; obligatoria |
| `HORUS_LARAVEL_DB_HOST` | Por defecto `host.docker.internal`; elegir servidor autorizado |
| `HORUS_LARAVEL_DB_PORT` | 3306 por defecto |
| `HORUS_LARAVEL_DB_DATABASE` | `horus_group`; solo sustituir por una base desechable al probar |
| `HORUS_LARAVEL_HTTP_PORT` | 8082; comprobar disponibilidad antes de arrancar |
| `HORUS_LARAVEL_APP_URL` | `http://127.0.0.1:8082`; ajustar también si cambia el puerto |
| `HORUS_LARAVEL_SECURE_COOKIE` | false solo en HTTP local; true al preparar HTTPS autorizado |

`host.docker.internal` se añade con `host-gateway` para Ubuntu/Docker Engine. El MySQL
del anfitrión debe escuchar en una interfaz accesible desde la red de este proyecto;
`127.0.0.1` dentro de PHP es el propio contenedor. Confirmar host, puerto, UUID, cortafuegos
y permisos antes de conectar. No abrir MySQL a Internet ni unir automáticamente redes
de proyectos existentes. Un servidor remoto requiere revisar TLS y su CA antes de activarlo.

La conexión fuerza MySQL, `DB_URL` vacío, UTC y `utf8mb4_unicode_ci`. La cuenta de ejecución
solo necesita SELECT/INSERT/UPDATE/DELETE sobre `horus_group.*`; migración y traslado
requieren otro operador autorizado. No se monta una copia de SQLite.
Contenido de panel/API y autenticación pública quedan apagados explícitamente.
Sanctum permanece instalado según el lockfile, sin activar sus rutas públicas.
Sesiones y cache usan archivos; cola síncrona y correo `array`, sin envíos externos.

## Construcción, arranque y apagado

Sustituir `/ruta/privada/laravel-docker.env` por la ruta real; en PowerShell se puede
usar `C:/ruta/privada/laravel-docker.env`. No ejecutar estos comandos sobre otro Compose.

```sh
docker compose --env-file /ruta/privada/laravel-docker.env -f compose.yaml config --quiet
docker compose --env-file /ruta/privada/laravel-docker.env -f compose.yaml build
docker compose --env-file /ruta/privada/laravel-docker.env -f compose.yaml up -d --wait
docker compose --env-file /ruta/privada/laravel-docker.env -f compose.yaml ps
docker compose --env-file /ruta/privada/laravel-docker.env -f compose.yaml logs --tail=80
docker compose --env-file /ruta/privada/laravel-docker.env -f compose.yaml stop
docker compose --env-file /ruta/privada/laravel-docker.env -f compose.yaml down
```

`down` conserva volúmenes; **no usar `down -v` ni `volume prune`**. No se inicia ningún
migrador, seeder, trabajador ni scheduler. Configurar un sistema de colas o tareas
programadas futuro requiere revisar su necesidad y recursos. No instalar Composer/npm
en el anfitrión. `restart: unless-stopped` reinicia procesos que terminan; Docker no
reinicia por sí solo un proceso marcado unhealthy. Investigar el healthcheck antes de
reiniciar manualmente solo el servicio de este proyecto.

Nginx sirve exclusivamente `public/`, rechaza dotfiles y PHP arbitrario y conserva
las peticiones Livewire mediante `index.php`. El healthcheck PHP prueba el ping FPM;
el de Nginx pasa por Laravel `/up`. `/up` no comprueba MySQL ni la existencia de tablas:
un contenedor healthy **no demuestra** que la base definitiva esté activada. Comprobar
por separado conexión, UUID, migraciones y acceso a `/gestion` durante la activación.

## Persistencia y recuperación

`horus-laravel_archivos` conserva `storage/app` (privado, público y temporales Livewire).
Nginx lo monta en solo lectura y solo sirve `app/public` mediante `/storage/`.
`horus-laravel_sesiones` conserva las sesiones de archivo. Ambos volúmenes nuevos
heredan el propietario preparado en la imagen; los procesos no arrancan como root.
No se montan carpetas del código anfitrión ni los uploads de NestJS. No restaurar archivos
privados dentro de `app/public`.

Antes de activar, acordar respaldo externo de `horus_group`, archivos y APP_KEY privada.
La imagen no contiene esos datos ni la clave. Para recuperar una imagen anterior,
recrear **ambos** servicios con imágenes de la misma versión y conservar los volúmenes
y la APP_KEY. No usar una imagen vieja si hay cambios de esquema incompatibles; revisar
la compatibilidad antes. OPcache no comprueba cambios: cada cambio de código exige
reconstruir y recrear contenedores. No sobrescribir código dentro del contenedor.
Para restaurar archivos o MySQL, usar destino nuevo y verificado, comparar integridad y
autorizar el cambio de destino. No borrar ni sustituir los volúmenes actuales como prueba.

Para volver a imágenes conservadas localmente, comprobar primero sus IDs y compatibilidad,
etiquetar ambas con `horus-laravel-php:local` y `horus-laravel-nginx:local`, y ejecutar:

```sh
docker compose --env-file /ruta/privada/laravel-docker.env -f compose.yaml up -d --no-build --force-recreate --wait
```

No hay TLS, dominio público ni proxy externo preparado. El puerto solo escucha en loopback.
Antes de publicar hacen falta autorización, HTTPS, cookies seguras, proxies confiables,
política de secretos, backup/restore y observación. Las etiquetas de las imágenes base
son mutables: registrar los digests validados antes de una entrega definitiva.

## Verificación de esta preparación

Ensayo local del **17/10/2026 (Lima)**, con proyecto Compose propio y MySQL **8.4.11**
desechable, sin puerto MySQL publicado y con sus datos en tmpfs. Se comprobó la base
aleatoria `horus_laravel_it_<16 hex>`, su UUID y UTC antes de migrar. No se creó
`horus_group` ni se conectaron `horus_db`, `horus_local` o SQLite habitual.

| Comprobación ejecutada | Resultado |
| --- | --- |
| Compose normal y superposición efímera, `config --quiet` | Salida 0 |
| Construcción de las dos imágenes | Salida 0, dependencias fijadas por Composer |
| Nginx `-t`, PHP-FPM `-t`, arranque con `--wait` | Salida 0; todos saludables |
| Arranque inicial | Base temporal sin tablas; ninguna migración o seeder automático |
| Preparación explícita solo de la base temporal comprobada | 12 migraciones y una cuenta ficticia |
| Runtime | PHP 8.4.26, Laravel 13.37.0, Filament 5.10.2, Livewire 4.4.7, Sanctum 4.3.3 |
| Extensiones exigidas por paquetes instalados | Las 16 presentes, además de PDO MySQL/SQLite, SQLite3, bcmath, pcntl y OPcache |
| Edge real, escritorio 1280 px y móvil 390 px | Login, escritorio y estudiantes; sin desborde, errores JS ni solicitudes externas |
| Livewire real por Nginx/FPM | Login y actualizaciones de escritorio/lista con respuestas HTTP 200 |
| Once comprobaciones HTTP | `/up`, inicio, login y archivo público 200; archivos privados/dotfiles/PHP bloqueados; contenido y Sanctum públicos 404 |
| Recreación exclusiva de app/web | Archivos, marcador de sesiones y sesión autenticada preservados; MySQL siguió en el mismo UUID |
| Imágenes sin volúmenes | Sin `.env` ni SQLite locales; sin caches de configuración/rutas del anfitrión |

La primera compilación intentó reconstruir SQLite ya integrado en PHP; se diagnosticó y
corrigió instalando solo extensiones faltantes. Las primeras sondas de navegador tenían
errores de selector/espera en el código temporal de prueba; se corrigieron y se repitieron
los flujos completos. No se cambió la aplicación para hacer pasar las sondas.

En una muestra aislada se observaron aproximadamente 91 MiB en PHP y 10 MiB en Nginx;
no es una medición de concurrencia, capacidad o carga sostenida. Las comprobaciones no
validan Ubuntu real, HTTPS, carga grande ni datos/credenciales definitivos. MySQL definitivo
y la activación requieren las decisiones de [activacion-contenido-laravel.md](activacion-contenido-laravel.md).
Los contenedores, red y volúmenes ficticios del ensayo se retiran al cerrar la verificación;
las imágenes locales quedan disponibles. No hay commit, push ni despliegue de Docker.

Referencias: [despliegue Laravel 13](https://laravel.com/docs/13.x/deployment),
[despliegue Filament 5](https://filamentphp.com/docs/5.x/deployment) y
[cambios de rutas Livewire 4](https://livewire.laravel.com/docs/4.x/upgrading).
