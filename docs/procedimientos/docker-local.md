# Entorno local con Docker Compose

Levanta el sitio público, el panel, la API y MySQL en tu máquina con `docker-compose.local.yml`. **No es producción**: Railway usa los
Dockerfiles de cada paquete ([RAILWAY.md](../../RAILWAY.md)). Nada de lo que sigue inicializa, migra ni importa datos por sí solo. **Que funcione aquí no demuestra que Railway esté listo para producción**: no se prueban el volumen de Railway, su red privada, TLS/`DB_RSA_PUBLIC_KEY`, `TRUSTED_PROXY_CIDRS`, el dominio ni los servicios de correo reales.

## Qué se crea

| Servicio | Imagen | Acceso |
| --- | --- | --- |
| `frontend` | Caddy sirviendo React + proxy `/api` | `http://localhost:8081` (solo `127.0.0.1`) |
| `backend` | API NestJS (Dockerfile de producción, con `NODE_ENV=development`) | Solo red interna (sin puerto publicado) |
| `mysql` | `mysql:8.4` | Solo red interna (sin puerto publicado) |

- Proyecto Compose: `horus-local`. Volúmenes: `horus-local_mysql_data` (base) y `horus-local_uploads_data` (imágenes subidas, en `/data/uploads`).
  Imágenes: `horus-local-backend` y `horus-local-frontend`.
- La API y MySQL no se publican en el anfitrión: el navegador solo habla con Caddy, que reenvía `/api` igual que en Railway.
- `NODE_ENV=development` es necesario únicamente porque producción exige orígenes HTTPS y el acceso local es `http://localhost`. Las demás
  reglas (CORS exacto, guards, cuotas, validación de entradas) no cambian. Swagger está apagado salvo `SWAGGER_ENABLED=true` (y solo responde a clientes locales).
- La autenticación nativa de MySQL (`mysql_native_password`) es una decisión **solo local**: evita fijar la clave RSA que exige `caching_sha2_password`
  sin TLS ([RAILWAY.md](../../RAILWAY.md)). La red es privada y el puerto no se publica.

## Antes de empezar

1. Docker Desktop (o Docker Engine) con Compose v2 en marcha.
2. Comprueba que no choca con recursos tuyos: `docker compose ls -a`, `docker volume ls --filter name=horus-local`, `docker ps -a` y que el puerto 8081 esté libre.
   Si usas otro puerto, cámbialo en `HORUS_WEB_PORT`.
3. Crea tu archivo de variables (ignorado por Git) y sustituye **todos** los valores ficticios:

   ```powershell
   Copy-Item .env.docker.example .env.docker
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # úsalo como JWT_SECRET
   ```

   `.env.docker` solo debe contener credenciales locales. No copies `backend/.env` ni valores de producción.

## Comandos

Todos desde la raíz del repositorio, con el prefijo completo (`--env-file` es obligatorio porque Compose interpola las variables del archivo).

| Acción | Comando |
| --- | --- |
| Construir | `docker compose --env-file .env.docker -f docker-compose.local.yml build` |
| Iniciar | `docker compose --env-file .env.docker -f docker-compose.local.yml up -d --build` |
| Estado | `docker compose --env-file .env.docker -f docker-compose.local.yml ps` |
| Logs | `docker compose --env-file .env.docker -f docker-compose.local.yml logs -f backend` (o `frontend`, `mysql`) |
| Detener (conserva datos) | `docker compose --env-file .env.docker -f docker-compose.local.yml stop` |
| Quitar contenedores (conserva volúmenes) | `docker compose --env-file .env.docker -f docker-compose.local.yml down` |

**Una instalación nueva no es utilizable todavía:** la base nace sin tablas y sin administrador. `/` y `/admin/login` cargan (son archivos estáticos), pero las páginas que
consultan la API (catálogo, galería, formularios…) devuelven error y **nadie puede iniciar sesión en el panel** hasta ejecutar los pasos de la sección siguiente, incluida la creación del primer administrador.

El contenedor del backend arranca como root solo para corregir el propietario de `/data/uploads` y ejecuta la API como `node` (UID 1000). Por eso los comandos de abajo usan `exec -u node`.

## Preparar una base local vacía (explícito)

Estos pasos escriben **solo** en el MySQL del volumen `horus-local_mysql_data`. Compruébalo con `docker compose … exec backend printenv DB_HOST DB_NAME` (debe ser `mysql` / el nombre de tu `.env.docker`).
No los ejecutes contra otra base. En una base ya inicializada, omite `db:init`.

```powershell
docker compose --env-file .env.docker -f docker-compose.local.yml exec -u node backend npm run db:init       # solo si la base no tiene tablas
docker compose --env-file .env.docker -f docker-compose.local.yml exec -u node backend npm run db:migrate    # aplica TODAS las migraciones, incluidas 20261009-chatbot-metrics, 20261010-newsletter-default-novedades y 20261011-cotizaciones-idempotencia; sin las dos columnas de esta última, las cotizaciones fallan
docker compose --env-file .env.docker -f docker-compose.local.yml exec -u node backend npm run db:check      # solo lectura; debe terminar con «Esquema compatible»
docker compose --env-file .env.docker -f docker-compose.local.yml exec -u node backend npm run admin:assign-role -- --listar   # solo lectura; muestra la línea --destino=… --servidor=<server_uuid> que se usa abajo
$env:ADMIN_INITIAL_PASSWORD = "<clave-local>"
docker compose --env-file .env.docker -f docker-compose.local.yml exec -it -u node -e ADMIN_INITIAL_PASSWORD backend npm run admin:create -- --destino=<host>:<puerto>/<base> --servidor=<server_uuid> --operador=<identificador> --motivo=<texto>   # pide nombre y correo; crea la cuenta sin rol
Remove-Item Env:ADMIN_INITIAL_PASSWORD
```

`db:check` **valida el esquema**, no solo la conexión: contra una base sin tablas termina con código 1 y lista lo que falta (comprobado, ver «Verificado»). Un «funciona» solo es válido si imprime «Esquema compatible».

No se insertan datos de ejemplo. El contenido se crea desde el panel (`http://localhost:8081/admin/login`).
`content:restore` y `convenios:import --apply` no forman parte de este flujo; ejecútalos solo si los necesitas y revisando el destino ([AGENTS.md](../../AGENTS.md)).

## Qué significa «offline» aquí

«Offline» significa **sin Railway ni servicios alojados por el proyecto**: la API, la base y el sitio corren en tu máquina. **No significa** que todo funcione sin conexión a Internet. Construir las imágenes (descarga de imágenes base y `npm ci`) necesita Internet una vez; después:

| Funciona sin Internet | Necesita Internet (no está empaquetado) |
| --- | --- |
| API, MySQL, Caddy y el proxy `/api`; páginas públicas y panel (lógica, datos, sesión) | Fuentes de Google (`frontend/index.html`): sin conexión se usa la tipografía del sistema |
| Imágenes **subidas** desde el panel (`/api/uploads/…`) | Iconos de Font Awesome (cdnjs): faltan **todos** los iconos de la interfaz, también en el panel |
| Chatbot con respuestas del catálogo publicado (`CHATBOT_AI_ENABLED=false`) | Chatbot con IA (OpenAI): apagado |
| Formularios: el mensaje se guarda (`correo_enviado: false`) | Correo Gmail/Resend: no se envía; la recuperación de contraseña por correo no funciona |
| | Mapa de «Ubicación» (iframe de Google Maps) y enlaces a WhatsApp, Maps y redes |
| | Imágenes que se hayan pegado en el panel con una URL `https://` externa |

Las dos hojas de estilo externas están en el `<head>` y bloquean el renderizado mientras fallan; **no se probó cómo se ve ni cuánto tarda el sitio sin Internet** (inspección estática, sin ejecución). 

**Fase futura (pospuesta por decisión del responsable; no es parte de este alcance):** modo totalmente offline. Requeriría autoalojar fuentes e iconos (nuevas dependencias del frontend, copiar los archivos a `dist`) y quitar los orígenes de Google/cdnjs de la CSP de `frontend/Caddyfile`, que se comparte con producción. No se hizo: cambia el frontend y la CSP de producción.

**Qué falta tras una instalación nueva** (aunque haya Internet): tablas (`db:init` + `db:migrate`) y el primer administrador (`admin:create`); sin ellos la API pública responde con error y no hay inicio de sesión. Detalle en la sección anterior.

## Respaldos

Antes de borrar o actualizar volúmenes, haz copia. Los archivos contienen datos personales y hashes de contraseñas: cífralos y no los subas a Git (`backups/` está ignorado).

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
# Base de datos (mysqldump dentro del contenedor mysql; la clave la lee del entorno del contenedor)
docker compose --env-file .env.docker -f docker-compose.local.yml exec -T mysql sh -c 'mysqldump --single-transaction -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' | Out-File -Encoding utf8 backups/horus-mysql.sql
# Imágenes subidas (copia del volumen a un .tar.gz)
docker run --rm -v horus-local_uploads_data:/data:ro -v "${PWD}/backups:/backup" alpine tar czf /backup/horus-uploads.tar.gz -C /data uploads
```

Estos dos comandos **no se ejecutaron** al preparar la guía: pruébalos con una base de prueba antes de fiarte de ellos. No uses `>` en PowerShell 5.1: escribe UTF-16 y corrompe el volcado.

Para los archivos subidos, el proyecto también ofrece `uploads:backup` / `uploads:restore` (manifiesto SHA-256, sin sobrescribir; ver [backup-restauracion.md](backup-restauracion.md)), que no dependen de `tar` ni del volumen montado en el anfitrión: `docker compose … exec -u node backend npm run uploads:backup -- --dir=/tmp/respaldo-uploads` y luego `docker compose … cp backend:/tmp/respaldo-uploads ./backups/`. Haz primero el respaldo de la base y después el de los archivos.

Alternativa del proyecto para la base (tampoco ejecutada en este entorno): `docker compose … exec -u node backend npm run db:backup -- --dir=/tmp/respaldo` y copiar el resultado fuera con
`docker compose … cp backend:/tmp/respaldo ./backups/` antes de recrear el contenedor. Sin `--dir` escribe en `/app/.backups`, donde `node` no puede escribir.
La restauración con `db:restore` solo acepta bases aisladas `horus_restore_*` y, al ser un servidor no local, exige `ALLOW_RESTORE_DB=true`: ver [backup-restauracion.md](backup-restauracion.md).

## Eliminar datos de forma deliberada

Esto **borra definitivamente** la base y las imágenes locales. Hazlo solo tras un respaldo y comprobando que el proyecto es `horus-local`.

```powershell
docker compose --env-file .env.docker -f docker-compose.local.yml down -v    # elimina contenedores y los volúmenes del proyecto
```

`down` sin `-v` conserva los datos. Las imágenes se quitan aparte (`docker image rm horus-local-backend horus-local-frontend`).

## Verificado y no verificado

Las comprobaciones se hicieron con el estado actual del repositorio sin confirmar: Dockerfile del backend con el `CMD` que baja privilegios con `setpriv`, imagen `horus-local-backend` reconstruida con `docker build` el 2026-10-10 (incluye el cambio de `newsletter`) y `mysql:8.4`; Docker Desktop 29.8, Windows. Se usaron recursos aislados con prefijo `horus-verify-final` y `horus-tmp-`, ya retirados salvo los volúmenes indicados abajo; no se tocaron `horus-*-test`, `horus-railway-*` ni `horus-local`.

**Ejecutado con la imagen y el Dockerfile actuales:**
- Construcción de las dos imágenes y arranque de los tres servicios con MySQL vacío; MySQL y el backend quedaron «healthy»; el frontend respondía 200 aunque su healthcheck seguía en «starting» en el momento de la consulta.
- `/healthz` y `/api/health` responden 200 a través de Caddy en `127.0.0.1:<puerto>`.
- El proceso de Node corre con UID 1000 y sin capacidades (`CapEff` en cero); `/data/uploads` pertenece a `node` y `node` escribe en él (`touch` y `rm` dentro del contenedor; **no** es una subida por el panel).
- `docker compose config` con el ejemplo de variables.

**Otras comprobaciones (la primera con la imagen final; las demás, antes, con una versión intermedia del Dockerfile con la misma lógica de `CMD`):**
- Con la imagen final y un volumen nuevo cuyo `/data` y `/data/uploads` eran propiedad de root (el caso de Railway), el contenedor arrancó como root, dejó `/data/uploads` a nombre de `node` (`/data` sigue siendo de root) y la API quedó con UID 1000 y sin capacidades; `node` escribe en `/data/uploads`. El volumen temporal se eliminó (era propio y recién creado). Es una simulación local: no prueba cómo monta Railway el volumen.
- `/api/docs` 404 con Swagger apagado, `401` en `/api/admin/me` sin token y `caddy validate` con la imagen.
- Sobre una base MySQL **vacía y temporal** (contenedor aparte, sin volúmenes, ya eliminado), `db:check` conectó y **no validó**: salió con código 1 y listó los elementos faltantes (72 en esa verificación, antes de la migración `20261011`). La afirmación anterior de que «funcionó» solo se refería a la conexión.

**Pendiente (no ejecutado):** `uploads:backup`/`uploads:restore` dentro del contenedor, `db:init`, `db:migrate`, un `db:check` con éxito («Esquema compatible»), `admin:create`, los comandos con `exec -u node`, subida de imágenes por el panel, formularios, inicio de sesión, los respaldos (`mysqldump`, `tar`, `db:backup`), `down -v`, cualquier flujo del navegador, el sitio sin conexión a Internet y todo lo relativo a Railway.

Tras la última verificación solo se retiraron contenedores y red del proyecto `horus-verify-final`. Sus dos volúmenes (`horus-verify-final_mysql_data` y `horus-verify-final_uploads_data`) siguen en el sistema: no contienen datos de la aplicación (sin tablas ni imágenes) y se pueden borrar a mano.

## Pregunta abierta

La imagen `mysql:8.4` y la colación por defecto no se han contrastado con una copia de los datos existentes del responsable (p. ej. el MySQL de Railway o el local de desarrollo).
Si hay que cargar datos reales en este entorno, confirma antes la versión y la colación del origen. No hay `mysqldump` incluido en la imagen del backend, y `db:restore` no
sobrescribe la base `DB_NAME`.
