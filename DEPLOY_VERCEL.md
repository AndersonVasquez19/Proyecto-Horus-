# Desplegar Horus en Vercel

## Arquitectura

Crear **dos proyectos Vercel desde el mismo repositorio**:

| Proyecto | Root Directory | Framework | Node.js |
| --- | --- | --- | --- |
| Sitio y panel | frontend | Vite | 22.x |
| API | backend | NestJS | 22.x |

MySQL debe estar alojado en un servidor accesible desde Vercel. El MySQL de tu computadora (`localhost`) no sirve para el despliegue. No se ha contratado alojamiento ni publicado el proyecto con estos cambios.

Las direcciones que aparecen aquí son ejemplos: reemplázalas por las que Vercel asigne a tus proyectos. No necesitas comprar un dominio propio para usar los subdominios de Vercel.

## 1. Preparar MySQL

Crear una base remota y obtener host, puerto, nombre, usuario, contraseña y requisitos de TLS. Si necesitas conservar información local, exportarla e importarla en esa base mediante las herramientas de MySQL. No mezclar credenciales de producción con pruebas.

Para una base remota **vacía**, desde backend y con sus variables configuradas en tu entorno local:

```text
npm ci
npm run db:init
npm run db:migrate
npm run admin:assign-role -- --listar
npm run admin:create -- --destino=<host>:<puerto>/<base> --servidor=<server_uuid> --operador=<identificador> --motivo=<texto>
```

`db:init` compila y crea las tablas sin datos de ejemplo; rechaza bases que ya contienen tablas. No usa force ni alter. No es una migración de un esquema existente. Si falla parcialmente, revisar el esquema antes de continuar.

Para una base existente, aplicar solo las migraciones pertinentes. El comando `admin:create` necesita la variable temporal `ADMIN_INITIAL_PASSWORD`, confirmar el destino configurado (`--destino`) y la identidad del servidor conectado (`--servidor`, el `server_uuid` que muestra `admin:assign-role -- --listar` en solo lectura; compruébelo con la identidad conocida del servidor) y declarar operador y motivo (quedan en `admin_auditoria`); pide nombre y correo y crea la cuenta sin rol. No poner la contraseña en argumentos ni subirla al repositorio.

Los scripts de base admiten `DB_SSL=true` y `DB_SSL_CA`. No se inicializa ni migra la base automáticamente durante builds o peticiones.

## 2. Proyecto backend

1. Importar el repositorio en Vercel.
2. Seleccionar **Root Directory: backend** y framework **NestJS**.
3. Conservar los valores predeterminados del framework para el build y la salida. No seleccionar dist como sitio estático.
4. Configurar las variables indicadas abajo.
5. Desplegar y conservar su URL estable de producción.

Vercel detecta `src/main.ts` de NestJS. No hace falta convertir la API en un frontend ni agregar un adaptador Express manual.

| Variable | Valor |
| --- | --- |
| NODE_ENV | production |
| DB_HOST | Host remoto de MySQL; no localhost |
| DB_PORT | Puerto del proveedor, normalmente 3306 |
| DB_NAME | Nombre de la base |
| DB_USER | Usuario de aplicación |
| DB_PASS | Contraseña de ese usuario |
| DB_SYNC | false |
| DB_SSL | true si el proveedor requiere TLS |
| DB_SSL_CA | Certificado CA del proveedor, cuando sea necesario; admite saltos como `\n` |
| JWT_SECRET | Secreto aleatorio de al menos 32 caracteres |
| CORS_ORIGINS | Origen exacto del frontend, por ejemplo https://horus-web.vercel.app |
| MAIL_PROVIDER | `resend` o `gmail` (sin valor, gmail); ver backend/MAIL.md |
| RESEND_API_KEY / RESEND_FROM | Solo con Resend: clave y remitente (dominio verificado) |
| MAIL_USER | Solo con Gmail: cuenta remitente |
| MAIL_PASS | Solo con Gmail: contraseña de aplicación |

Para varios orígenes CORS, separarlos por comas sin barra final. Autorizar explícitamente las URLs de previews que deban usar la API; no usar un comodín para todos los proyectos de vercel.app. Puedes reservar/configurar los nombres de ambos proyectos antes del primer despliegue para conocer las URLs.

Si la protección de despliegue de Vercel impide acceder públicamente a la API, configurar su acceso para el entorno que utilizará la web. No incluir secretos de bypass en variables VITE_*.

Comprobar:

- `https://TU-BACKEND.vercel.app/api/health` (Swagger está apagado en producción salvo `SWAGGER_ENABLED=true`, con HTTPS y cuenta de administrador)
- `https://TU-BACKEND.vercel.app/api/cursos`

Si MySQL no conecta, la aplicación no podrá arrancar. Revisar logs, host, TLS y restricciones de red del proveedor.

## 3. Proyecto frontend

1. Importar el mismo repositorio como otro proyecto.
2. Seleccionar **Root Directory: frontend**, framework **Vite** y Node.js **22.x**.
3. Build: `npm run build`; salida: `dist`; instalación: `npm ci`.
4. Configurar:

```env
VITE_API_BASE_URL=https://TU-BACKEND.vercel.app/api
```

5. Desplegar. Comprobar que el backend permite su origen en `CORS_ORIGINS`.

La variable incluye `/api`. No contiene contraseñas. Se incorpora al JavaScript durante la compilación: al cambiarla hay que **redesplegar el frontend**. Login, panel, contacto y reclamaciones usan la misma base de API.

El build en Vercel falla con un mensaje claro si falta esta URL o apunta a localhost. Las rutas React, como `/admin/dashboard`, tienen fallback a index.html al recargar. Las rutas `/api` se excluyen de ese fallback para no confundir HTML con JSON.

## 4. Correo y funciones

Las solicitudes esperan a que termine el intento de correo antes de responder, evitando abandonar la promesa al finalizar una función. Se fijaron tiempos de espera de SMTP. La entrega efectiva sigue dependiendo de Gmail y de las credenciales; el servicio actual registra fallos en logs y no tiene una cola persistente de reintentos.

No usar el filesystem de una función como almacenamiento permanente de imágenes. Actualmente la galería acepta URLs; usar URLs públicas de almacenamiento persistente cuando se incorpore subida de archivos.

## 5. Verificación

En frontend: `npm run build` y `npm run test:deploy`. En backend: `npm run build` y `npm test`.

Después de desplegar, comprobar:

1. Abrir y recargar una ruta pública y `/admin/login`.
2. Iniciar sesión, recargar el panel y consultar registros.
3. Crear/editar un registro de prueba controlado y comprobar persistencia.
4. Enviar contacto y reclamación; comprobar almacenamiento y correo.
5. Confirmar que Network apunta al backend remoto, sin errores CORS.
6. Verificar 401 en una ruta administrativa sin token.

## Desarrollo local

El frontend usa `/api` si no se configura VITE_API_BASE_URL. Vite lo envía a `http://127.0.0.1:3000`. Arrancar backend y frontend en terminales separadas como antes. Los archivos .env locales no se modificaron.

## Referencias

- [NestJS en Vercel](https://vercel.com/docs/frameworks/backend/nestjs)
- [Vite en Vercel y rutas SPA](https://vercel.com/docs/frameworks/frontend/vite)
