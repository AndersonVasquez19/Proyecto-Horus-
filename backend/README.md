# Backend Horus

NestJS, Prisma 6.19 y MySQL. Una base sin contenido devuelve listas vacías y contadores en cero. Usa Node 22.x y npm.

## Preparación

Ejecutar `npm ci`, configurar `.env` y revisar [Prisma](PRISMA.md). Las migraciones se ejecutan explícitamente mediante `npm run db:migrate`, después de verificar y respaldar el destino. `db:init` es exclusivo de una base vacía. Build y arranque no migran MySQL.

`npm run start:dev` usa `dist-dev/`; producción usa `npm run build` y `npm run start:prod`, en `dist/`. En desarrollo, Swagger está en `/api/docs`; utiliza Authorize con un token sin añadir Bearer. En producción está apagado salvo `SWAGGER_ENABLED=true` (ver "Seguridad HTTP, CORS y Swagger").

## Rutas y contratos

- Alta por un administrador: `POST /api/admin/register` requiere JWT de una cuenta activa con `cuentas:crear` y no devuelve token (el primer administrador se crea con `npm run admin:create`). Registro público: `POST /api/admin/signup` crea una cuenta activa **sin rol** (sin token; campos ajenos → 400; correo repetido → 409; 3/min y 10/h por IP); sin rol, AccessGuard deniega toda ruta con permiso. Login: `POST /api/admin/login`. Las demás operaciones administrativas y `admin/me` requieren JWT y una cuenta activa.
- Recuperación: `admin/forgot-password` y `admin/reset-password`. El enlace vence en 30 minutos, es de un solo uso y revoca sesiones anteriores. Cambio de contraseña autenticado: `POST admin/password`. Gestión de cuentas: `GET admin/users` y `PUT admin/users/:id`.
- Catálogos `cursos`, `servicios` y `preguntas-frecuentes`: GET público paginado y detalle solo publicados; CRUD administrativo bajo `admin/`. Los cursos y capacitaciones se conservan: DELETE responde 409 si existen (404 si no existen), sin modificar el registro ni liberar su slug. Se archivan desde Editar mediante PUT con `estado: archivado`; siguen disponibles en la administración y pueden republicarse con el mismo ID, slug y contenido. Su conservación prepara los futuros módulos académicos, todavía no implementados. DELETE de preguntas frecuentes sigue archivando; en `servicios` sigue eliminando definitivamente. El listado administrativo de servicios admite `categoria` con una o varias categorías separadas por coma.
- Catálogo PUT rechaza null y cuerpos vacíos. Para quitar campos opcionales, usar `limpiar`: cursos admiten `imagen_url`, `fecha_inicio`, `temario`, `area`, `certificacion`, `icono`, `modalidad`, `duracion`; servicios admiten `imagen_url`, `alcance`, `nombre_corto`, `destacado`, `dato_principal`, `dato_secundario`, `etiquetas`, `icono`. Modalidad y duración solo se pueden quitar en capacitaciones; un curso exige ambas. No se puede asignar y limpiar el mismo campo.
- Las listas administrativas aceptan `page`, `limit` y filtros; conservan las claves anteriores de respuesta. Si se omite `page`, las listas heredadas mantienen su contrato. El panel siempre solicita páginas.
- Seguimiento: GET/PUT `admin/seguimiento/messages/:id` o `admin/seguimiento/reclamaciones/:id`. PUT exige `revision`, `estado`, `responsable`, `notas` y `respuesta`. Una modificación obsoleta responde 409. POST `correo` envía la respuesta guardada; POST `constancia` reenvía la notificación de registro.
- Las reclamaciones no se borran físicamente desde la API; se archivan mediante seguimiento. Los mensajes con seguimiento o cotizaciones vinculadas están protegidos contra borrado.
- Cotizaciones: `admin/cotizaciones`, detalle, edición de borrador, `/:id/estado` y `/:id/correo`. El backend calcula importes y exige revisión. La impresión para PDF se realiza en el navegador.
- `POST /api/newsletter` exige correo y `consentimiento:true`; reactivar conserva el interés si no se envía uno nuevo. `POST newsletter/unsubscribe` recibe un token firmado. La baja administrativa desactiva la suscripción.
- `POST admin/uploads` recibe multipart `file`, máximo 5 MB, PNG/JPEG/WebP comprobados por firma. GET público `/api/uploads/:filename` sirve el recurso con MIME fijo. En producción se exige `UPLOAD_DIR` sobre un volumen persistente.
- Los formularios públicos tienen cuotas atómicas compartidas en MySQL. Solo se usa la IP validada por Express.

## Diseño original editable

Los catálogos incorporan color, icono y orden de presentación. Los servicios añaden diseño de tarjeta, nombre de pestaña, destacado, dato principal y secundario y características. Las capacitaciones añaden área y certificación. Los catálogos se ordenan por `orden` y luego ID; la agenda mantiene su orden por fecha.

`GET /api/admin/contenido-original` presenta el inventario recuperable sin escribir. `POST /api/admin/contenido-original/:section` acepta `servicios`, `capacitaciones` o `galeria`, con `{ "estado": "publicado" }` o `borrador`. Ambas rutas exigen JWT. La importación es transaccional por sección, omite duplicados y conserva ediciones y estados mediante `origen_original`. El contenido procede de `fb2880b`; no genera ejemplos ni fechas, modalidades o duraciones desconocidas.

Aplicar la migración `20261002-original-design` antes de usar estos campos. `npm run content:restore`, después de compilar y migrar, permite recuperar las tres secciones solo en MySQL local de desarrollo. En otros entornos, utilizar el panel. El comando no modifica ajustes institucionales.

## Correos y ajustes

`MAIL_USER` y `MAIL_PASS` configuran el transporte. Los formularios conservan el registro aunque falle SMTP y responden `correo_enviado:false`; el panel puede reenviar la notificación. El envío explícito de una propuesta/respuesta devuelve error si el correo no pudo entregarse.

Los ajustes públicos exponen solo claves conocidas; leerlos no escribe ejemplos. El sitio utiliza los valores configurados de contacto y pie de página, con el contenido actual como respaldo cuando están vacíos. Los datos institucionales pendientes de confirmación permanecen sin normalizar.

## Comprobación

`node node_modules/typescript/bin/tsc --noEmit --incremental false`, `npm test`, `npm run build` y `npm run test:integration`. Para un entorno con recursos limitados, la suite puede ejecutarse secuencialmente con `node --test --test-concurrency=1 -r ts-node/register test/*.test.ts`.

La biblioteca es interna al panel y todos los administradores conservan sus permisos. Market no forma parte de este proyecto: no hay tienda ni pagos.

## Seguridad HTTP, CORS y Swagger

- **Cabeceras (Helmet):** `src/common/security.ts`, aplicado en `main.ts` antes de cualquier ruta. Todas las respuestas llevan `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy`/`Cross-Origin-Resource-Policy: same-origin` y una CSP de API (`default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'). Sin `X-Powered-By`. Las imágenes públicas (`/api/uploads/*`) relajan solo CORP (`cross-origin`, para que el frontend las incruste desde otro origen) y permiten estilos en línea para el visor del navegador. La CSP no incluye `upgrade-insecure-requests`: el acceso local por HTTP (localhost, LAN, Docker) sigue funcionando.
- **HSTS:** solo con `NODE_ENV=production`/Vercel y solo en respuestas que llegaron por HTTPS (`max-age=15552000`, sin `includeSubDomains` ni preload). Por HTTP no se envía. Con proxy, configura `TRUSTED_PROXY_CIDRS` para que Express reconozca `X-Forwarded-Proto`.
- **CORS:** lista exacta en `CORS_ORIGINS` (nunca `*`); fuera de producción, los orígenes locales de Vite. Un dominio de ngrok u otra URL solo funciona si se añade a `CORS_ORIGINS` (con Vite y su proxy `/api` no hace falta, porque la petición es del mismo origen). **Limitación para LAN/Docker:** fuera de producción solo se aceptan los orígenes locales de Vite y los que añadas exactos (por ejemplo `http://192.168.1.50:5173`); con `NODE_ENV=production` cada origen debe ser HTTPS y la lista no puede estar vacía, así que una instalación en producción accesible solo por HTTP en la red local no arranca. No se admite un comodín ni «cualquier origen HTTP». La salida prevista para un futuro Docker Compose es servir el frontend y la API bajo el mismo origen (Caddy con `/api`, como en Railway), donde CORS no interviene; la configuración de producción pública no cambia.
- **Swagger (`/api/docs`, `/api/docs-json`, `/api/docs-yaml`):** en desarrollo está activo por defecto (desactívalo con `SWAGGER_ENABLED=false`) **y solo se sirve a clientes locales**: conexión directa desde loopback o una red privada (192.168.x.x, 10.x.x.x, 172.16–31.x.x...) sin cabeceras de proxy que declaren un cliente público (`X-Forwarded-For`, `X-Real-IP`, `Forwarded`...). Así, un servidor público arrancado por olvido sin `NODE_ENV=production`, o detrás de Caddy, Railway o ngrok, responde 404 a `/api/docs` en lugar de exponerlo. En producción está **apagado**: no se registra ninguna ruta y todo responde 404. Con `SWAGGER_ENABLED=true` en producción se sirve únicamente por HTTPS y con HTTP Basic de una cuenta de administrador activa (correo y contraseña; nunca en la URL), con límite de 5 fallos por minuto e IP, y sin caché. Si la petición no llega por HTTPS responde 403 aunque las credenciales sean correctas. La interfaz y el documento OpenAPI tienen el mismo control. Ningún valor de CORS, URL ni variable concede acceso por sí solo.
- **Healthcheck:** `GET /api/health` devuelve `{ "ok": true }` sin tocar la base de datos; es el que deben usar Railway y similares (antes se usaba `/api/docs`).
