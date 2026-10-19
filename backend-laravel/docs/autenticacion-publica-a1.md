# Autenticación pública — lote A1

Alcance autorizado: registro, login, sesión y logout para la futura SPA React.
Guard `web` compartido con Filament; Sanctum solo para cookies, sin tokens personales
ni JWT. No cambia React, NestJS, los proxies, las políticas ni las bases habituales.

## Plan de implementación

1. Incorporar Sanctum compatible con Laravel 13 sin publicar recursos de Filament
   ni ejecutar migraciones. Preparar pruebas HTTP con SQLite `:memory:`.
2. Implementar registro y login con entradas permitidas explícitas, correo normalizado,
   rechazo de duplicados sin distinción de mayúsculas, cuenta activa sin rol,
   límites por IP y por correo/IP y regeneración de sesión.
3. Implementar consulta mínima de cuenta, comprobación persistida de estado y logout
   con invalidación de sesión y rotación CSRF. Probar cookies y CSRF con el middleware real.
4. Verificar toda la suite académica y del panel, Pint y diff. Documentar contrato y
   los requisitos pendientes de A2. Sin commits, pushes ni despliegues.

Las rutas nuevas quedan deshabilitadas por defecto mediante
`HORUS_PUBLIC_AUTH_ENABLED=false`. Además requieren la seguridad por roles del panel:
el modo local heredado sin migrar no admite autenticación pública. No se migra ni
activa el entorno habitual. Las pruebas habilitan A1 solo en su configuración aislada.
La compatibilidad de `User` con el esquema local anterior solo se conserva mientras
no existan las columnas de rol y estado: con el esquema actual se exigen siempre
rol académico y cuenta activa, incluso si posteriormente se apaga el modo seguro local.

## Contrato preparado

| Método y ruta | Entrada | Resultado |
| --- | --- | --- |
| `GET /sanctum/csrf-cookie` | Sin cuerpo | 204, cookies de sesión y XSRF |
| `POST /api/auth/register` | `name`, `email`, `password`, `password_confirmation` | 201, inicia sesión |
| `POST /api/auth/login` | `email`, `password` | 200, inicia sesión |
| `GET /api/auth/me` | Cookie de sesión | 200, cuenta actual activa; 401 sin sesión |
| `POST /api/auth/logout` | Cookie y CSRF | 204, invalida la sesión compartida |

Registro, login y sesión responden exclusivamente
`{"user":{"id":1,"name":"Persona pública","email":"persona@example.test"}}`.
No devuelven rol, permisos, contraseña, historial ni relaciones académicas.
Registro devuelve 422 ante entradas inválidas, duplicados o campos ajenos al
contrato, incluso `rol: null` o `permissions: []`. Las contraseñas conservan sus
espacios; para nuevas cuentas se exigen 8 caracteres y como máximo 72 bytes UTF-8.
El correo se recorta y convierte a minúsculas; la búsqueda de cuentas anteriores
es insensible a mayúsculas. El índice UNIQUE existente protege registros públicos
concurrentes porque todos escriben el correo normalizado. No se modifica ninguna
cuenta anterior ni se crean administradores.

Login incorrecto, inexistente o desactivado responde 401 con el mismo mensaje.
Login/registro sobre una sesión ya iniciada responden 409 (con entrada válida).
Una cuenta desactivada pierde su sesión al consultar A1. El logout también cierra
Filament en ese navegador, porque ambos utilizan el guard `web`.
Mientras A1 esté habilitado, Laravel bloquea por ID de sesión todas sus peticiones
con sesión (incluido Filament/Livewire) antes de leerla y hasta terminar de guardarla.
Así una respuesta concurrente no vuelve a guardar la sesión eliminada por logout.
El lock dura hasta 120 segundos y espera hasta 10 segundos; requiere un cache store
con locks atómicos compartidos entre las instancias. El modo habitual sin A1
mantiene el comportamiento previo.

Límites: registro, 5 peticiones/minuto/IP; login, 5/minuto/correo normalizado+IP
y 30/minuto/IP. Incluyen peticiones inválidas; el exceso devuelve 429 y
`Retry-After`. Se usa el cache store de Laravel; un despliegue con varias
instancias necesita un almacén compartido. La IP procede del Request de Laravel;
los proxies confiables deben verificarse en el futuro destino.

## Cookies y CSRF

Las rutas están dentro del grupo `web`: Laravel cifra la cookie de sesión,
mantiene la sesión en el servidor y protege las escrituras con su middleware
CSRF. No se utiliza `HasApiTokens` ni se publica su migración: A1 exige
`auth:web`, y un encabezado Bearer no autentica estas rutas.

La cookie de sesión es HttpOnly. `XSRF-TOKEN` es legible por JavaScript para
enviar su valor (decodificado de URL) como `X-XSRF-TOKEN`; no es una credencial
de acceso. Laravel 13 también admite su comprobación nativa de origen seguro
con `Sec-Fetch-Site: same-origin`. Sin origen válido ni token válido responde
419. No hay excepciones CSRF para A1. Login y registro regeneran la sesión y el
token CSRF; logout destruye la sesión anterior y vuelve a rotar el token.
Las respuestas de cuenta llevan `Cache-Control: no-store, private`.

El futuro destino HTTPS debe usar cookies `Secure`, HttpOnly y SameSite=Lax
(o una política más restrictiva compatible). No habilitar cookies cross-site
ni comodines CORS. En desarrollo HTTP, Secure debe estar apagado; no se ha
modificado el `.env` ni la configuración del servidor existente.
Fuera de `local`/`testing`, A1 responde 503 si la petición no es HTTPS, la cookie
no es Secure/HttpOnly, SameSite no es Lax/Strict o las sesiones no usan un almacén
de servidor (`database`, `file`, `redis`, `memcached` o `dynamodb`).

Referencia contrastada: [Sanctum para Laravel 13](https://github.com/laravel/docs/blob/13.x/sanctum.md).

## Pendiente para A2 (no ejecutado)

1. Definir URL y orígenes reales de React/Laravel y el enrutamiento que separará
   Laravel de NestJS; hoy los proxies existentes siguen apuntando a NestJS.
2. Comprobar en el destino autorizado que el esquema ya contiene `users.rol`,
   `users.activo` y almacenamiento de sesiones, y que el panel usa seguridad por
   roles (`HORUS_SEGURIDAD_ACTIVA=true` para local). A1 no migra bases existentes.
3. Habilitar expresamente `HORUS_PUBLIC_AUTH_ENABLED=true` en ese entorno,
   preparar HTTPS/cookies, cache compartido y CORS con credenciales y orígenes
   explícitos si React accede desde otro origen. Recrear la caché de rutas y
   configuración, si existe, como parte de esa activación autorizada.
4. Implementar el cliente React con `credentials: 'include'`, inicialización
   CSRF, header XSRF en POST y actualización tras cada rotación; restaurar sesión
   mediante `/me` y manejar 401, 409, 419, 422 y 429. No almacenar credenciales
   de sesión en localStorage ni mezclar este flujo con el JWT de NestJS.
5. Probar en navegador real registro/login/reload/logout, cookies, CORS, CSRF,
   acceso denegado a Filament y coexistencia con NestJS en el destino elegido.

A1 solo verifica HTTP dentro de Laravel y SQLite temporal; no demuestra todavía
la conexión React ni un despliegue, CORS o comportamiento de cookies del navegador.

## Archivos del lote

Creados:

- `app/Http/Controllers/Auth/SesionPublicaController.php`
- `app/Http/Requests/Auth/EntradaPublica.php`
- `app/Http/Requests/Auth/RegistroPublico.php`
- `app/Http/Requests/Auth/InicioSesionPublico.php`
- `app/Http/Middleware/SesionPublica.php`
- `app/Http/Middleware/CuentaPublicaActiva.php`
- `app/Support/CorreoUsuario.php`
- `config/public-auth.php` y `config/sanctum.php`
- `routes/auth-publica.php`
- `tests/Feature/Auth/AutenticacionPublicaTest.php`
- `tests/Support/ExigirCsrf.php`
- `docs/autenticacion-publica-a1.md`

Modificados:

- `composer.json` y `composer.lock`: Sanctum 4.3.3; ningún otro paquete actualizado.
- `routes/web.php`: inclusión del archivo de rutas condicionado a la activación.
- `bootstrap/app.php`: prioridad de la respuesta JSON antes de autenticar A1.
- `app/Providers/AppServiceProvider.php`: límites de registro y login.
- `app/Models/User.php`: impedir privilegios públicos en el modo local con roles.
- `config/session.php`: bloqueo compartido cuando A1 esté habilitado.
- `tests/bootstrap.php`: habilitación exclusiva del lote en las pruebas aisladas.

## Verificación

PHPUnit usa `tests/bootstrap.php`, `tests/TestCase.php` y SQLite `:memory:`;
la salvaguarda del destino permanece intacta. Se ejecutan el middleware HTTP,
las cookies y el CSRF reales de Laravel. El helper de pruebas únicamente retira
la excepción de CSRF propia del entorno testing; las peticiones envían cookies
y renuevan guard/atributos en memoria para no heredar autenticación entre requests.

Las 35 pruebas de A1 cubren registro, datos inválidos (incluidos arrays y bytes
nulos en contraseñas), duplicados ASCII/Unicode y conflicto UNIQUE intercalado,
rechazo de roles y permisos, login válido/inválido/inactivo, CSRF, regeneración,
logout y replay de sesión antigua, estado revocado, límites, sesión administrativa
compartida, bloqueo ante petición concurrente en A1 y Filament, denegación de
Filament a cuentas básicas, cookies seguras, serialización mínima y rutas apagadas.
La intercalación del UNIQUE y el lock retenido son escenarios deterministas dentro
del proceso de pruebas, no una prueba de carga con procesos de navegador.

Comandos de verificación desde `backend-laravel/`:

```powershell
php vendor/phpunit/phpunit/phpunit tests/Feature/Auth/AutenticacionPublicaTest.php
php vendor/phpunit/phpunit/phpunit
php vendor/bin/pint --test
composer validate --no-check-publish
composer check-platform-reqs --lock
git diff --check
```

Resultado del 17 de octubre de 2026: A1, **35/35** pruebas; suite completa
académica, panel y resto de Laravel, **278/278** pruebas y **1.790 aserciones**.
Pint, validación de Composer, requisitos del lockfile y diff sin errores.
Sanctum **4.3.3** quedó instalado y descubierto a partir del manifiesto de
Composer, sin cargar el entorno privado ni publicar recursos de Filament.
La revisión independiente detectó la carrera de sesión y la diferencia Unicode
de SQLite; ambas quedaron cubiertas por regresiones y corregidas antes de la
ejecución final. Hubo fallos durante el desarrollo de esas regresiones; la suite
final no tiene fallos ni pruebas omitidas.

No se han ejecutado migraciones fuera de las pruebas, cambiado usuarios reales,
leído/modificado el `.env`, tocado la SQLite habitual, reiniciado servidores,
publicado recursos de Filament, hecho commits/pushes ni desplegado cambios.
NestJS, React y los proxies quedan fuera de este diff; la coexistencia real se
verificará al conectar ambos servicios en A2.
