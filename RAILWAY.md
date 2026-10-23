# Despliegue de Horus en Railway

**Importación académica (fase 4):** antes de habilitar `/admin/dashboard?section=importacion-excel`, se requieren `20261018-convocatorias-capacidad` y, al final de `versions`, `20261019-importaciones-academicas`. Esta última crea únicamente el registro de operaciones, con hash del archivo, destino, actor, recuentos y unicidad archivo/edición; no carga estudiantes. La activación requiere autorización y comprobación del destino. No se aplicaron migraciones en las bases habituales durante esta implementación. Contrato y validación local: [Importación académica CSV](docs/procedimientos/importacion-academica.md).

**Variante React en Vercel + API en Railway** (arquitectura objetivo acordada el 23/10/2026): el frontend no pasa por Caddy, la API necesita dominio público HTTPS y `CORS_ORIGINS` debe listar los orígenes de React. Variables, primer gerente y conexión de varias computadoras a una sola API: [guía para React y API central](docs/procedimientos/guia-react-api-central.md). Lo siguiente describe la variante con el frontend también en Railway.

El repositorio contiene dos paquetes npm independientes. Desplegar tres servicios dentro del mismo proyecto y entorno de Railway: `frontend`, `backend` y `MySQL`. El navegador accede al frontend por HTTPS; Caddy envía `/api` y `/api/*` al backend por la red privada, conservando las rutas actuales. MySQL debe tener un volumen persistente.

Los Dockerfiles usan Node 22, los lockfiles existentes y generación de Prisma sin conexión a MySQL. El backend ejecuta `dist/main.js` con dependencias de producción. No se ejecutan migraciones ni se crean cuentas durante la compilación o el arranque. Los contextos Docker excluyen archivos de entorno, dependencias locales y compilaciones previas.

## 1. Crear y configurar los servicios

Conectar el mismo repositorio de GitHub a ambos servicios de aplicación. Configurar antes del primer despliegue:

| Ajuste | backend | frontend |
| --- | --- | --- |
| Root Directory | `/backend` | `/frontend` |
| Builder | Dockerfile detectado automáticamente | Dockerfile detectado automáticamente |
| Build Command personalizado | Vacío | Vacío |
| Start Command personalizado | Vacío; usa el CMD de la imagen | Vacío; usa el CMD de la imagen |
| Pre-Deploy Command | Vacío inicialmente | Vacío |
| Healthcheck Path | `/api/health` | `/healthz` |
| Puerto | `3000` | `8080` |
| Dominio público | No es necesario | Generar dominio HTTPS con puerto de destino `8080` |

El healthcheck del frontend comprueba su servidor estático; no comprueba MySQL ni el proxy. `/api/health` comprueba que NestJS terminó de arrancar, pero no valida la base ni el esquema completo. Swagger (`/api/docs`) está apagado en producción por defecto; solo se habilita con `SWAGGER_ENABLED=true` y entonces exige HTTPS y una cuenta de administrador. Verificar la API y la base por separado al final.

### Cabeceras de seguridad y CSP

- **Backend (Helmet):** cabeceras de API y CSP estricta (`default-src 'none'`); HSTS solo en producción y por HTTPS (requiere `TRUSTED_PROXY_CIDRS` para reconocer `X-Forwarded-Proto`). Detalle en [backend/README.md](backend/README.md).
- **Frontend (Caddy):** `frontend/Caddyfile` añade, solo a las respuestas del sitio (no a `/api`), `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy` y una **CSP** sin `unsafe-eval` ni scripts en línea. Orígenes externos permitidos: `fonts.googleapis.com` y `fonts.gstatic.com` (Google Fonts), `cdnjs.cloudflare.com` (Font Awesome), `www.google.com` (iframe del mapa) e imágenes por HTTPS (las que se pegan desde el panel; una imagen con URL `http://` queda bloqueada). `style-src` admite estilos en línea porque la biblioteca `sonner` inyecta un `<style>` al cargar y React usa atributos `style`. `connect-src 'self'` supone que la API se sirve bajo el mismo origen (`/api` por Caddy, como aquí); con una API en otro dominio habría que añadirlo a `connect-src` e `img-src`.
- **Estado de la validación:** el Caddyfile se validó con `caddy validate` y se ejecutó sirviendo el frontend con el ejecutable oficial de Caddy v2.11.7 (Windows, checksum SHA-512 verificado contra el publicado), sin violaciones de CSP en 24 páginas y escenarios. También se validó (`Valid configuration`) con la imagen construida desde `caddy:2-alpine`, y esa imagen sirvió el sitio y el proxy `/api` en el entorno local ([docs/procedimientos/docker-local.md](docs/procedimientos/docker-local.md)). **Pendiente:** el despliegue real de Railway, donde también hay que confirmar que ningún recurso configurado en el panel usa `http://`. Nada de lo documentado aquí se ha desplegado ni probado en Railway.

Mantener los servicios en la misma región. El dominio privado predeterminado del backend se asume `backend.railway.internal`; confirmar el valor real en Networking. No hace falta configurar `railway.json`: Railway detecta cada Dockerfile desde su Root Directory.

## 2. Variables

En `frontend`:

```dotenv
PORT=8080
BACKEND_UPSTREAM=backend.railway.internal:3000
```

`BACKEND_UPSTREAM` es host y puerto internos, sin rutas. Si el servicio tiene otro nombre o puerto, actualizarlo. No usar `localhost`. No hace falta `VITE_API_URL`: las llamadas existentes usan `/api` y Caddy las redirige.

En `backend`, usar las referencias de Railway al servicio llamado exactamente `MySQL`:

```dotenv
NODE_ENV=production
PORT=3000
DB_HOST=${{MySQL.MYSQLHOST}}
DB_PORT=${{MySQL.MYSQLPORT}}
DB_NAME=${{MySQL.MYSQLDATABASE}}
DB_USER=${{MySQL.MYSQLUSER}}
DB_PASS=${{MySQL.MYSQLPASSWORD}}
DB_SYNC=false
DB_SSL=false
JWT_SECRET=REEMPLAZAR_POR_UN_SECRETO_ALEATORIO_DE_AL_MENOS_32_CARACTERES
CORS_ORIGINS=https://TU-FRONTEND.up.railway.app
UPLOAD_DIR=/data/uploads
```

Sustituir los ejemplos de JWT y dominio antes de desplegar. `CORS_ORIGINS` debe contener el origen HTTPS real, sin ruta ni barra final. Si hay varios dominios, separarlos por comas. El nombre de servicio de las referencias distingue el servicio configurado: adaptarlo si no se llama `MySQL`.

`DB_SSL=false` corresponde a una conexión privada a MySQL sin TLS configurado. Para un proveedor que exija TLS, usar `DB_SSL=true` y, si corresponde, `DB_SSL_CA`; se mantiene la verificación del certificado. La aplicación y los scripts usan `DB_*`, no `DATABASE_URL`.

Montar un volumen persistente en `/data` del backend para las imágenes subidas; `UPLOAD_DIR=/data/uploads` mantiene los archivos entre despliegues. Sin esa variable, la API rechaza cargas en producción en vez de guardarlas en disco temporal.

**Permisos del volumen (probado en Docker local; pendiente de confirmar en Railway):** según la documentación de volúmenes de Railway, un volumen se monta como `root`, y el proceso de la API no debe correr como root. El `CMD` del `backend/Dockerfile` resuelve ambas cosas: el contenedor arranca como root solo el instante necesario para corregir el propietario de `UPLOAD_DIR` (únicamente si cuelga de `/data/`) y después ejecuta `node dist/main.js` como `node` (UID 1000, sin capacidades) con `setpriv`. **No hace falta `RAILWAY_RUN_UID`**; no lo definas, porque correría la API como root. Probado localmente con un volumen propiedad de root: `/data/uploads` pasó a `node` y el proceso corre con UID 1000. Sin probar en Railway: tras el primer despliegue, comprueba una subida desde el panel. Si Railway ya arranca la imagen sin root, el `CMD` no cambia nada y la subida fallaría con `EACCES`; en ese caso hay que revisar cómo ejecuta Railway el contenedor, y solo como último recurso valorar `RAILWAY_RUN_UID=0`, que ejecutaría toda la API como root (más superficie ante una vulnerabilidad de la API).

Para envío de correos, elegir `MAIL_PROVIDER` (`resend` o `gmail`; sin valor se usa Gmail) y configurar sus variables según `backend/MAIL.md`. No copiar credenciales al repositorio ni al frontend. Confirmar que el plan y la red elegidos permiten la conexión SMTP utilizada por la aplicación.

## 3. Preparar MySQL explícitamente

Estos comandos escriben en la base seleccionada. Comprobar `DB_HOST` y `DB_NAME` y respaldar los datos si ya existen. Ejecutarlos desde `/app` en una terminal SSH del contenedor `backend` de Railway, que tiene acceso a la red privada y a sus variables. No ejecutar estos pasos contra la base local por accidente.

Para una base completamente vacía, ejecutar en este orden y detenerse ante cualquier fallo:

```sh
npm run db:init
npm run db:migrate
npm run db:check
```

`db:init` rechaza bases con tablas. Las operaciones DDL de MySQL no son transaccionales: si falla parcialmente, revisar las tablas antes de reintentar. No borrar datos para forzar la inicialización.

Para una base existente, omitir `db:init`: revisar primero `npm run db:check`, aplicar `npm run db:migrate` si corresponden las migraciones pendientes y volver a comprobar el esquema. `db:migrate` aplica, en orden y registrando cada una en `horus_migrations`, `20260909-create-catalogo`, `20260921-create-cotizaciones`, `20261002-complete-institutional`, `20261002-original-design`, `20261002-create-convenios`, `20261003-remove-otros-category`, `20261009-chatbot-metrics`, `20261010-newsletter-default-novedades`, `20261011-cotizaciones-idempotencia`, `20261014-admin-rol`, `20261014-admin-auditoria`, `20261015-academico-estructura`, `20261016-academico-solo-dni`, `20261018-convocatorias-capacidad`, `20261019-importaciones-academicas`, `20261020-docentes`, `20261020-preinscripciones` y `20261023-convocatoria-horarios` (lista `versions` de `backend/scripts/migrate.cjs`; el orden es el de esa lista y una migración nueva va siempre al final). `20261020-sesiones-academicas` está **retirada** (lista `retired` del mismo archivo): su SQL se conserva intacto como registro histórico, pero `db:migrate` ya no la aplica; si una base ya la tenía registrada, su tabla `sesiones` y sus filas se conservan y `db:check` sigue verificando esa estructura histórica. **`20261009-chatbot-metrics`, `20261011-cotizaciones-idempotencia`, `20261014-admin-rol` y `20261014-admin-auditoria` son requeridas antes de desplegar el código actual del backend**: el cliente Prisma selecciona `contactos.origen`, las columnas `cotizaciones.idempotencia_*` y `admin_users.rol`, y las consultas (incluido el inicio de sesión) fallan sin ellas; el alta de administradores y su activación o desactivación escriben en `admin_auditoria` dentro de la misma transacción y fallan (sin aplicar el cambio) si la tabla no existe; `20261014-admin-auditoria` solo crea esa tabla vacía (sin claves foráneas ni datos personales) y no modifica filas; `20261014` solo añade `admin_users.rol` (ENUM nulo, sin valor predeterminado: ninguna cuenta recibe un rol), no modifica filas, y los roles se asignan después con `npm run admin:assign-role` (`docs/procedimientos/roles-administrativos.md`); `db:check` también las espera. `20261011` solo añade dos columnas nulas y un índice único (admite varias filas con NULL), no modifica filas existentes y no se puede aplicar con el backend nuevo ya en marcha sin errores en cotizaciones: aplicarla **antes**. Hoy **nada lo garantiza**: la configuración documentada del Pre-Deploy Command del backend está vacía (tabla de la sección 1) y configurarlo es opcional. Solo si el responsable configura `npm run db:migrate` como Pre-Deploy Command, las migraciones pendientes se aplicarían antes de cada despliegue; mientras siga vacío hay que ejecutar `db:migrate` a mano, antes de desplegar este código. `20261010-newsletter-default-novedades` solo cambia el valor por defecto de `newsletter_subscribers.interes` a `novedades`; no modifica filas (los suscriptores con `market` se conservan como dato histórico) y el código ya envía el interés de forma explícita, así que no es previa al despliegue. `20261015-academico-estructura` (E4.2) solo crea, vacías, las tablas académicas `estudiantes`, `convocatorias`, `matriculas`, `certificados` y `academico_historial` con claves foráneas restrictivas hacia `cursos` y `admin_users`; no modifica ninguna tabla ni fila existente (los cursos y sus fechas se conservan) y todavía no la usa ningún servicio, así que tampoco es previa al despliegue; `db:check` la espera y verifica su estructura real (columnas, índices, claves foráneas, restricciones CHECK y la columna generada de certificados). `20261016-academico-solo-dni` (E4.3b) restringe el documento académico a DNI peruano (`PE` + exactamente 8 dígitos) en `estudiantes` y `certificados`: redefine sus ENUM y sus CHECK de formato, sin tocar columnas, índices, relaciones ni filas. Antes de cualquier sentencia comprueba que todas las filas existentes ya cumplen la regla nueva; si hay algún CE, PASAPORTE o DNI que la regla rechace, se detiene sin modificar nada e informa solo recuentos (los datos no se convierten, borran ni anonimizan: hay que decidir antes qué hacer con ellos). Sus dos `ALTER TABLE` son idempotentes, así que una ejecución interrumpida entre ambos se completa al repetir `db:migrate`. También es necesaria para los módulos académicos, pero `db:check` la espera y rechaza un esquema que aún admita CE o PASAPORTE. Antes de migrar una base con datos, respaldarla (`docs/procedimientos/backup-restauracion.md`). Consultar `backend/PRISMA.md` para discrepancias adicionales. Una base nueva no importa automáticamente el contenido de la base local.

La fase 2 de Ediciones requiere **`20261018-convocatorias-capacidad` antes de desplegar**: añade `convocatorias.capacidad INT NULL` y un CHECK positivo, conservando filas anteriores sin inventar cupos. Los módulos de Estudiantes y Ediciones requieren también `20261015-academico-estructura` y `20261016-academico-solo-dni`. Estos requisitos sustituyen las notas históricas que consideraban las tablas académicas sin consumidores. No se aplica ninguna migración a bases habituales sin autorización y destino comprobado. Contrato y pruebas: [Gestión de ediciones](docs/procedimientos/gestion-ediciones.md).

**Docentes y ponentes (módulo retirado del alcance; la migración se conserva):** el código ya no registra `DocentesModule` ni las rutas `/api/admin/docentes` y `/api/admin/asignaciones-docentes`, pero `20261020-docentes` sigue en la secuencia y `db:check` la espera. Requiere, antes de ella, `20261015-academico-estructura`, `20261016-academico-solo-dni` y `20261018-convocatorias-capacidad`. Crea las tablas `docentes` y `docente_asignaciones` (vacías, con claves foráneas restrictivas) y amplía el ENUM `academico_historial.entidad` con `docente` y `asignacion_docente`; no modifica filas ni columnas existentes y sus sentencias son idempotentes (una ejecución interrumpida se completa al repetir `db:migrate`). `db:check` la espera. Los permisos `docentes:*` nacen de la matriz de roles en código (gerente y coordinación) sin cambiar la base. Procedimiento de activación, contrato y pruebas aisladas: [Gestión de docentes y ponentes](docs/procedimientos/gestion-docentes.md). No se aplicó en ninguna base habitual durante su implementación.

**Horarios de las ediciones (backend, sin pantallas):** requiere **`20261023-convocatoria-horarios` antes de desplegar** el código que registra `HorariosModule` (`GET`/`PUT /api/admin/convocatorias/:id/horarios`); sin la tabla, esas dos rutas responden 503 neutro y el resto de la API no se ve afectado. Antes de ella, `20261015-academico-estructura` (crea `convocatorias`). Crea vacía la tabla `convocatoria_horarios` (día ISO 1–7, hora de inicio y fin en hora de Lima, `UNIQUE` por edición, día e inicio, `CHECK` de día y de intervalo, clave foránea `RESTRICT` hacia `convocatorias`); no modifica filas ni otras tablas y su única sentencia es idempotente. `db:check` la espera. Reutiliza los permisos `convocatorias:leer`/`convocatorias:editar` sin cambiar la matriz. **Activada en `horus_db` local el 23/10/2026** ([activación](docs/procedimientos/activacion-preinscripciones-horarios.md)); en Railway, `horus_local` y cualquier otra base sigue pendiente y requiere autorización independiente, respaldo previo y el procedimiento de [Horarios de las ediciones](docs/procedimientos/horarios-ediciones.md).

**Sesiones académicas (módulo retirado, octubre de 2026):** el código ya no registra `SesionesModule` ni las rutas `/api/admin/sesiones` y `/api/admin/convocatorias/:id/sesiones`, y el recurso de permisos `sesiones:*` ya no existe. `20261020-sesiones-academicas` está **retirada** (no se aplica); no se borran tablas ni datos de las bases que la tuvieran aplicada. Historia: [Horarios y sesiones académicas](docs/procedimientos/horarios-sesiones-academicas.md) (documento histórico).

**Preinscripciones académicas (backend, sin pantallas):** requiere **`20261020-preinscripciones` antes de desplegar** el código que registra `PreinscripcionesModule` (`/api/preinscripciones`, `/api/chatbot/preinscripcion` y `/api/admin/preinscripciones`) **y también el código actualizado de Ediciones**: el cliente Prisma selecciona las columnas nuevas de `convocatorias` (`minimo_apertura`, `preinscripcion_estado`, `codigo_publico`), así que `/api/admin/convocatorias`, Matrículas y las demás consultas de ediciones fallan (503) con el código nuevo sobre una base sin migrar. Antes de ella, `20261015-academico-estructura` y `20261018-convocatorias-capacidad`; es independiente de Docentes, de la migración retirada de Sesiones y de Horarios, y no usa sus valores del ENUM del historial. Crea `preinscripciones` y `preinscripciones_historial` (vacías, claves foráneas restrictivas), añade a `convocatorias` tres columnas (la recepción nace `cerrada` y el mínimo y el código público quedan en NULL: las ediciones anteriores no cambian) y un índice único a `matriculas`; no modifica filas. Los dos `ALTER TABLE` no admiten `IF NOT EXISTS` en MySQL: `db:migrate` omite solo «columna duplicada», «índice duplicado» y «restricción CHECK duplicada» (1060/1061/3822) en esta migración para poder completarse tras una interrupción, y `db:check` verifica la estructura real. Los permisos `preinscripciones:*` nacen de la matriz de roles en código sin cambiar la base. **Activada en `horus_db` local el 23/10/2026** ([activación](docs/procedimientos/activacion-preinscripciones-horarios.md)); en Railway, `horus_local` y cualquier otra base sigue pendiente y requiere autorización independiente, respaldo previo y el procedimiento de [Gestión de preinscripciones](docs/procedimientos/gestion-preinscripciones.md).

Tras preparar la base, se puede configurar `npm run db:migrate` como Pre-Deploy Command del backend para futuros despliegues, si se desea aplicar automáticamente las migraciones revisadas. No configurar `db:init` como paso recurrente. Los scripts están incluidos en la imagen de producción.

Para el primer administrador, obtener primero en solo lectura el destino y la identidad del servidor con `npm run admin:assign-role -- --listar` (línea `--destino=… --servidor=<server_uuid>`; comprobar el `server_uuid` con `SELECT @@server_uuid` desde la consola de MySQL de Railway), configurar temporalmente `ADMIN_INITIAL_PASSWORD` y ejecutar `npm run admin:create -- --destino=<host>:<puerto>/<base> --servidor=<server_uuid> --operador=<identificador> --motivo=<texto>` en una terminal interactiva del backend. El script solicita nombre y correo, crea la cuenta **sin rol** y registra el alta en `admin_auditoria` (requiere la migración `20261014-admin-auditoria`). El rol se asigna después con `admin:assign-role` (ver `docs/procedimientos/roles-administrativos.md`). Retirar la variable al terminar; no utilizar este comando en un pre-deploy automático.

## 4. Comprobación final

- Frontend: abrir el dominio HTTPS y recargar `/educacion/cursos` y `/admin/login`. El panel está en `/admin/dashboard`; `/panel` no es una ruta de la aplicación.
- Proxy: abrir `/api/health` desde el dominio del frontend. Si devuelve 502, revisar el dominio privado, el puerto y los logs del backend.
- API: comprobar `/api/cursos` y `/api/servicios`; una base vacía debe devolver listas vacías reales. La página `/educacion/cursos` consulta `/api/cursos` y muestra cursos publicados; `/educacion/capacitaciones` muestra capacitaciones, con paginación, estados de carga/error/vacío y reintento. Comprobar que los borradores y archivados no aparezcan; tras publicar o editar, recargar la página o pulsar Actualizar catálogo. Los servicios por categoría, sus detalles, la galería activa y las FAQ también consultan la API. Los ajustes de contacto y pie de página utilizan lo configurado en el panel, conservando el contenido actual cuando están vacíos.
- Panel: comprobar login, expiración de sesión y las operaciones necesarias con una cuenta autorizada.
- Formularios y chatbot: probar estados de éxito/error y el envío de correo con datos de prueba controlados.
- MySQL: confirmar que `db:check` pasa y configurar respaldos del volumen antes de recibir datos reales.

No hay registro público de administradores: `/admin/register` y `POST /api/admin/signup` crean cuentas **sin rol** (sin acceso al panel hasta que la gerencia asigne uno con `admin:assign-role`). `POST /api/admin/register` exige una sesión válida con `cuentas:crear` y no devuelve token. El primer administrador de una instalación nueva se crea con `admin:create`. El panel y las demás operaciones administrativas requieren una sesión válida.

El chatbot usa la IP validada por Express. Configurar `TRUSTED_PROXY_CIDRS` en cada servicio como se indica abajo; no usar `*`, `true`, cantidades de saltos ni rangos /0. Las cuotas públicas se comparten en MySQL mediante `rate_limit_buckets` (200 POST/min en total para los formularios públicos y un tope de 200/min propio para cada ruta de `/admin/*` con límite: ni el tráfico público ni otra ruta de administración pueden agotar la cuota del inicio de sesión); aplicar la migración de esta versión antes de utilizar sus formularios.

## Comprobaciones locales

Con Docker disponible, desde la raíz:

```sh
docker build -t horus-backend ./backend
docker build -t horus-frontend ./frontend
docker run --rm --entrypoint caddy horus-frontend validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Para levantar todo el sitio en local (con MySQL, sin Railway) usa `docker-compose.local.yml`: [docs/procedimientos/docker-local.md](docs/procedimientos/docker-local.md).

El dominio `backend.railway.internal` solo se resuelve en Railway. Para una prueba local del proxy, proporcionar un `BACKEND_UPSTREAM` accesible desde el contenedor. Las compilaciones no necesitan credenciales de producción.

## MySQL después de un reinicio

Para MySQL 8 con `caching_sha2_password`, usar TLS verificado (`DB_SSL=true`, `DB_SSL_CA` si corresponde) o fijar `DB_RSA_PUBLIC_KEY` cuando se utilice la red privada sin TLS. La clave debe ser la clave pública RSA del servidor, obtenida de su administrador por un canal confiable; nunca copiar la privada. Se aceptan PEM multilínea o saltos literales `\n`. No se habilita `allowPublicKeyRetrieval`.

En el MySQL de prueba Docker, la clave pública está en `/var/lib/mysql/public_key.pem`. En Railway, confirmar la ruta efectiva con el administrador de MySQL; establecer su contenido como variable del backend. Conservarla mientras el servidor conserve su clave y actualizarla después de una rotación. El backend y los scripts usan el mismo validador y clave fijada.

La API ejecuta una consulta de lectura al iniciar y no abre el puerto si no puede conectar. Probar reiniciando MySQL y luego el backend, sin ejecutar previamente migraciones o `db:check` que calienten la caché de autenticación. Si se usa RSA sin TLS, la clave protege la autenticación; el tráfico SQL no queda cifrado. Usar esta opción solo en una red privada confiable.

## IP del visitante y proxies

- Backend: `TRUSTED_PROXY_CIDRS` contiene únicamente las IPs o los CIDRs confiables por los que llega Caddy. Acepta comas o espacios. Mantener la API sin dominio público. En Docker de prueba puede usarse la IP exacta del contenedor frontend.
- Frontend: `TRUSTED_PROXY_CIDRS` contiene únicamente los rangos de los proxies de entrada confirmados por el proveedor, separados por espacios. Caddy utiliza `X-Real-IP` y después `X-Forwarded-For` solo desde esos orígenes, y reemplaza la cabecera enviada al backend con una única IP validada. Para acceso local directo no se debe confiar en cabeceras del navegador; el valor predeterminado solo contempla loopback.
- Railway documenta `X-Real-IP` en su entrada HTTP, pero no se debe adivinar un rango confiable ni confiar en todo Internet. Confirmar con el proveedor los orígenes de entrada aplicables al proyecto antes de fijar los CIDRs. Si no se configura la confianza, se conserva la cuota por dirección del proxy como comportamiento seguro, sin aceptar cabeceras arbitrarias.
- Verificar con dos clientes distintos que sus cuotas sean independientes y que cambiar manualmente `X-Forwarded-For` no evite el límite. Las réplicas usan contadores compartidos en MySQL. El chatbot conserva además un límite local de llamadas simultáneas a IA.

## Lista para el responsable (no ejecutada)

Configuración manual en Railway antes del primer despliegue:

1. Tres servicios en el mismo proyecto y entorno: `MySQL` (con volumen), `backend` (Root Directory `/backend`, volumen en `/data`) y `frontend` (Root Directory `/frontend`, dominio HTTPS hacia el puerto `8080`).
2. Variables del `backend` y del `frontend` de la sección 2 (sin `RAILWAY_RUN_UID`; ver «Permisos del volumen»), `MAIL_PROVIDER` con sus credenciales (`backend/MAIL.md`) y, solo si se desea IA, `CHATBOT_AI_ENABLED`, `OPENAI_API_KEY` y `CHATBOT_MODEL`. Nunca `NODE_ENV=development` ni `SWAGGER_ENABLED=true` sin necesidad.
3. `CORS_ORIGINS` con el dominio real del frontend (también construye el enlace de baja del newsletter). Confirmar el dominio privado real del backend para `BACKEND_UPSTREAM` y el MySQL elegido (`DB_SSL`/`DB_RSA_PUBLIC_KEY`, sección «MySQL después de un reinicio»).
4. Base de datos: confirmar `DB_HOST` y `DB_NAME` del destino y hacer un respaldo si ya hay datos; después ejecutar desde la terminal del backend, en este orden y deteniéndose ante cualquier fallo: base vacía → `npm run db:init`, `npm run db:migrate`, `npm run db:check`; base existente → respaldo previo (`npm run db:backup -- --dir=<volumen persistente>` y `npm run uploads:backup -- --dir=<volumen persistente>`, ver `docs/procedimientos/backup-restauracion.md`), `npm run db:check` (solo lectura: si falla, la lista indica qué migraciones faltan; es el diagnóstico esperado antes de migrar), `npm run db:migrate`, `npm run db:check` (debe terminar con «Esquema compatible»). Crear el primer administrador con `npm run admin:create`. **El estado real de la base de Railway no se ha consultado desde este repositorio**: qué migraciones tiene aplicadas (`SELECT name FROM horus_migrations ORDER BY name`) debe confirmarlo el responsable antes de desplegar.
5. Comprobación final de la sección 4, incluida una subida de imagen desde el panel (permisos del volumen) y los límites de frecuencia con `TRUSTED_PROXY_CIDRS` confirmados con Railway.

Pendientes que dependen de decisiones o recursos externos: rangos confiables de entrada de Railway para `TRUSTED_PROXY_CIDRS` (frontend), versión/colación de MySQL de destino frente a la de los datos existentes, dominio verificado para Resend (o cuenta Gmail con contraseña de aplicación), política de retención y cifrado de respaldos y su almacenamiento externo (`docs/procedimientos/backup-restauracion.md`), y programar la limpieza del chatbot (`npm run chatbot:purge`, `backend/CHATBOT.md`): hasta que alguien la programe en el entorno real, la retención de 90 días solo se aplica de forma oportunista cuando el asistente recibe consultas.

## Referencias

- Dockerfiles: https://docs.railway.com/builds/dockerfiles
- Monorepos: https://docs.railway.com/deployments/monorepo
- React Router y proxy con Caddy: https://docs.railway.com/guides/spa-routing-configuration
- Pre-deploy: https://docs.railway.com/deployments/pre-deploy-command

- Cabeceras de entrada de Railway: https://docs.railway.com/networking/public-networking/specs-and-limits
- Proxies confiables en Caddy: https://caddyserver.com/docs/caddyfile/options#trusted-proxies
