# Guía para integrar React con el backend de Horus

Destinatario: el desarrollador del frontend React. Fecha: 23 de octubre de 2026, rama `anderson`.
Complementa el [contrato React](contrato-react-backend-consolidado.md), que sigue siendo la referencia completa de
endpoints, permisos y restricciones de los DTO. Aquí está lo necesario para empezar y los ejemplos verificados.

**Estado:** la base local `horus_db` ya tiene las 18 migraciones (Preinscripciones y Horarios incluidas) y
`db:check` pasa. La separación MySQL local se ejecutó y verificó el 23/10/2026: NestJS usa `horus_app` y
`horus_migrator` queda reservado para mantenimiento ([privilegios efectivos](privilegios-mysql-propuesta.md)).
**No hay despliegue en Railway ni en Vercel**: la API central descrita en la sección 9 está preparada, no operativa.
La separación de cuentas MySQL conserva los contratos HTTP y no requiere cambios de React.

## 1. Configurar la URL de la API

React lee una sola variable de compilación, `VITE_API_BASE_URL` (`frontend/src/apiBase.ts`). Por defecto vale `/api`.

| Situación | `VITE_API_BASE_URL` | Cómo llega a la API |
| --- | --- | --- |
| Desarrollo con backend en tu propia máquina | `/api` (o sin definir) | El proxy de Vite envía `/api` a `http://127.0.0.1:3000`. |
| Desarrollo contra la API central (cuando exista) | `https://<dominio-de-la-api>/api` | Llamada directa entre orígenes; la API debe tener tu origen en `CORS_ORIGINS`. |
| React publicado en Vercel | `https://<dominio-de-la-api>/api` | Igual que la fila anterior; se fija en las variables del proyecto de Vercel. |

- Sin barra final. Las variables `VITE_*` se incrustan al compilar y son **públicas**: nunca pongas secretos en ellas.
- Usar siempre `API_BASE` de `apiBase.ts`; no escribir `'/api/...'` a mano. Las imágenes subidas ya se resuelven con
  `contentImages.ts` desde cualquier origen.
- Para trabajar contra la API central sin tocar el archivo versionado, crea `frontend/.env.local` (ignorado por Git)
  y reinicia Vite: las variables se leen al arrancar.

## 2. Registro, inicio de sesión y sesión

Todas las rutas llevan el prefijo `/api`. El JWT dura **8 horas**; no hay refresh ni logout en el servidor.

**Registro público** (`POST /admin/signup`, sin sesión; 3 por minuto y 10 por hora por IP):

```json
{"nombre":"Ana Pérez","email":"ana@ejemplo.test","password":"una-clave-de-8-a-72"}
```

Respuesta 201, siempre igual y **sin token**:

```json
{"ok":true,"mensaje":"Cuenta creada. El acceso al panel requiere la autorización de la gerencia."}
```

- Enviar solo esos campos y, opcionalmente, `website` vacío (campo trampa). Cualquier campo extra, como `rol`,
  responde **400**. Correo repetido: **409** `{ ok:false, mensaje }`. Cuota superada: **429** con `Retry-After`.
- La cuenta nace **activa y sin rol**: puede iniciar sesión, pero no tiene permisos administrativos.

**Login** (`POST /admin/login`):

```json
{"email":"ana@ejemplo.test","password":"una-clave-de-8-a-72"}
```

```json
{"ok":true,"mensaje":"Login correcto.","token":"<JWT>","user":{"id":5,"nombre":"Ana Pérez","email":"ana@ejemplo.test","rol":null,"permisos":[]},"acceso":{"modo":"por_roles"}}
```

Credenciales incorrectas o cuenta desactivada: **401** `{"ok":false,"mensaje":"Credenciales incorrectas."}`.
Enviar el token como `Authorization: Bearer <JWT>`; nunca en la URL ni en enlaces de descarga.
`GET /admin/me` devuelve `{ ok, user, acceso }` con el rol y los permisos **vigentes leídos de la base**.

## 3. Autorización por roles

Roles: `GERENTE_GENERAL`, `COORDINADORA_INSTITUCIONAL`, `SECRETARIA`, o `null` (cuenta básica).

- Decidir qué mostrar con `user.permisos` (lista de cadenas `recurso:accion`), no con el nombre del rol.
  `frontend/src/panel/context/panelAccess.ts` ya lo hace y una prueba lo contrasta con el backend.
- El backend vuelve a comprobar el permiso en cada solicitud (AccessGuard). Ocultar un botón no protege nada.
- **401**: sesión ausente, vencida o revocada → volver al login. **403**: falta permiso → mostrar aviso, **sin** cerrar sesión.
- Un cambio de rol, desactivación o cambio de contraseña **revoca las sesiones** de esa cuenta (sube `session_version`):
  su siguiente solicitud recibe 401 y, al volver a entrar, obtiene los permisos nuevos.

## 4. Panel «Roles y usuarios»

Solo para cuentas con `cuentas:leer` (hoy, el gerente). Ya existe en React (`PanelAccounts`).

| Operación | Solicitud | Respuesta |
| --- | --- | --- |
| Listar | GET `/admin/users` | `{ ok, users: [{ id, nombre, email, activo, rol, createdAt }] }`, sin contraseñas. |
| Cambiar rol | PUT `/admin/users/:id/rol` con `{ "rol": "SECRETARIA", "rol_actual": null }` | 200 `{ ok, mensaje, user: { id, rol } }`. |
| Retirar rol | Mismo PUT con `"rol": null` | La cuenta queda básica y sus sesiones se cierran. |
| Activar/desactivar | PUT `/admin/users/:id` con `{ "activo": false }` | Desactivar y reactivar dejan el rol en `null`. |

`rol_actual` es el rol que la pantalla mostraba; si cambió entretanto, **409** y no se escribe nada: recargar la lista.
Reglas que el backend impone (409 salvo indicación): nadie cambia su propio rol ni se desactiva a sí mismo; no se
puede dejar el sistema sin un gerente activo; una cuenta desactivada debe activarse antes de recibir rol; sin
`cuentas:asignar_rol` la respuesta es **403**. Pedir el rol que ya tiene responde 200 sin cambios.

Flujo completo comprobado en un clon desechable:

1. La persona se registra en React → cuenta activa sin rol.
2. El gerente la ve en «Roles y usuarios» y le asigna el rol.
3. La sesión anterior de esa persona recibe 401; vuelve a iniciar sesión y obtiene los permisos nuevos.

**Primer gerente de una base nueva:** no se puede asignar desde el panel (todavía no hay gerente). Se hace una sola
vez por base con el procedimiento auditado de terminal (sección 9.4). React no necesita ninguna pantalla para ello.
La base local `horus_db` ya tiene un gerente activo: allí no hay que inicializar nada.

## 5. Endpoints académicos

Rutas, filtros y cuerpos completos en el [contrato React](contrato-react-backend-consolidado.md). Resumen:

| Recurso | Base | Escrituras |
| --- | --- | --- |
| Cursos y capacitaciones | `/admin/cursos` (públicos: `/cursos`) | POST, PUT (sin `revision`) |
| Ediciones | `/admin/convocatorias` | POST; PUT `/:id`, `/apertura`, `/preinscripcion`, `/cierre`, `/archivo` con `revision` |
| Horarios | `/admin/convocatorias/:id/horarios` | PUT del conjunto completo con `revision` de la edición |
| Estudiantes | `/admin/estudiantes` | POST; PUT `/:id`, `/archivo` con `revision` |
| Matrículas | `/admin/matriculas` | POST; PUT `/anulacion`, `/cumplimiento`, `/reactivacion` |
| Preinscripciones | públicas `/preinscripciones`, `/chatbot/preinscripcion`; admin `/admin/preinscripciones` | validación, descarte, desistimiento, conversión |
| Reportes | `/admin/reportes`, `/:tipo`, `/:tipo/exportar` | Solo lectura y descarga |

Listas: enviar `page=1&limit=20` (máximo 100). Respuesta `{ ok, items, pagination: { page, limit, total, pages } }`.
Detalles y escrituras: `{ ok, item }`. Fechas de edición `AAAA-MM-DD`. JSON con números reales, no cadenas.

Una edición nueva nace `planificada`, con recepción `cerrada` y `minimo_apertura: 10`. Abrir la recepción no la abre
académicamente; la apertura exige diez preinscripciones validadas o matriculadas y una confirmación explícita.

## 6. Horarios, `revision` y errores 409/422

GET `/admin/convocatorias/7/horarios`:

```json
{"ok":true,"convocatoria":{"id":7,"nombre":"Edición de ejemplo","estado":"abierta","archivada":false,"revision":4,"modificable":true},"zona_horaria":"America/Lima","items":[{"id":12,"dia_semana":1,"dia":"lunes","hora_inicio":"19:00","hora_fin":"21:00"}]}
```

PUT con el **conjunto completo** (sin ids) y la revisión de la edición:

```json
{"revision":4,"horarios":[{"dia_semana":1,"hora_inicio":"19:00","hora_fin":"21:00"},{"dia_semana":6,"hora_inicio":"09:00","hora_fin":"12:00"}]}
```

Responde como el GET más `cambios: true|false`. Un cambio real sube la revisión de la edición en uno; repetir el mismo
conjunto con la revisión vigente devuelve `cambios: false` sin subirla. `horarios: []` borra todos los tramos.
Guardar la `revision` devuelta: la comparten los horarios y todas las acciones de la edición.

**409, revisión obsoleta u operación bloqueada.** Conservar el borrador, recargar y dejar decidir al usuario; no reenviar solo:

```json
{"statusCode":409,"message":"<texto en español>","error":"Conflict"}
```

**422, regla de horario.** Mostrar `message` y señalar los tramos de `conflictos` (o `tramos` si es `HORARIO_INVALIDO`):

```json
{"statusCode":422,"error":"Unprocessable Entity","codigo":"HORARIO_SOLAPADO","message":"Hay horarios que se solapan el mismo día.","conflictos":[{"tipo":"solapamiento","primero":{"dia_semana":2,"dia":"martes","hora_inicio":"18:00","hora_fin":"20:00"},"segundo":{"dia_semana":2,"dia":"martes","hora_inicio":"19:00","hora_fin":"21:00"}}]}
```

Códigos: `HORARIO_INVALIDO`, `HORARIO_DUPLICADO`, `HORARIO_SOLAPADO`. Los reportes también usan 422 cuando se supera
el límite de filas o de rango de fechas. Coexisten dos formas de error (`{ ok:false, mensaje }` y
`{ statusCode, error, message }`, con `message` cadena o lista): leer primero el estado HTTP y reutilizar el lector de
errores del panel. No mostrar trazas ni textos internos de un 500.

## 7. Descargas con `Content-Disposition`

`GET /admin/reportes/:tipo/exportar?formato=csv|xlsx|pdf` (con los mismos filtros del reporte, sin `page`/`limit`).
La API expone `Content-Disposition` al origen autorizado (comprobado: `attachment; filename="..."`).

```ts
const response = await fetch(`${API_BASE}/admin/reportes/estudiantes/exportar?formato=csv`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!response.ok) { /* leer el error JSON como en el resto del panel */ return; }
const header = response.headers.get('Content-Disposition') ?? '';
const raw = /filename="([^"]+)"/.exec(header)?.[1] ?? 'reporte.csv';
const nombre = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
const url = URL.createObjectURL(await response.blob());
const enlace = Object.assign(document.createElement('a'), { href: url, download: nombre });
enlace.click();
URL.revokeObjectURL(url);
```

Exportar está reservado al gerente en la matriz actual; dos exportaciones simultáneas por proceso, una tercera da 429.

## 8. Rutas retiradas

Responden **404** y no deben tener pantallas ni permisos: `/admin/sesiones*`, `/admin/convocatorias/:id/sesiones`,
`/admin/docentes*`, `/admin/asignaciones-docentes*`, `/admin/certificados*` y los reportes `certificados` y
`pendientes-certificacion`. Se conserva solo `GET /certificados/verificar/:codigo` (público, lectura) para códigos QR
históricos. Swagger (`/api/docs`) no se publica: no depender de él.

## 9. Tres computadoras y API central

### 9.1 Por qué cada computadora ve cuentas distintas hoy

Con `VITE_API_BASE_URL=/api`, cada navegador llama al backend de **su propia máquina** (`127.0.0.1:3000`), que usa su
propia MySQL. Una cuenta creada en una computadora no existe en las otras. Eso es correcto para desarrollo aislado.

Para compartir cuentas, las tres deben llamar a **una única API** (Railway) con **una única MySQL** (Railway):

```text
Navegador (PC 1, PC 2, PC 3, Vercel) ──HTTPS──> API NestJS (Railway) ──red privada──> MySQL (Railway)
```

Los navegadores nunca se conectan a MySQL. No se expone la MySQL local a Internet ni se copian bases entre equipos.

### 9.2 Evitar usar `localhost` por accidente

- Comprobar en la pestaña Red del navegador que las solicitudes van a `https://<dominio-de-la-api>/api/...`.
  Si van a `localhost:5173/api` o `127.0.0.1:3000`, Vite no cargó `.env.local`: reiniciarlo.
- Un aviso visible en desarrollo (por ejemplo, mostrar `API_BASE` en el pie del panel) evita confusiones; es opcional
  y queda a criterio del frontend.
- No arrancar el backend local cuando se trabaja contra la API central, para que un proxy olvidado falle en vez de
  usar otra base.
- La recuperación de contraseña construye el enlace con el **primer** origen de `CORS_ORIGINS`: ponga primero el dominio
  público de React.

### 9.3 Variables de la API central (Railway)

Detalle de servicios, volumen y TLS en [RAILWAY.md](../../RAILWAY.md). Para React en **Vercel** y la API en Railway
(orígenes distintos) cambian tres cosas respecto a esa guía: la API necesita **dominio público HTTPS**, `CORS_ORIGINS`
lista los orígenes de React y no se usa el proxy Caddy.

```dotenv
NODE_ENV=production
PORT=3000
DB_HOST=${{MySQL.MYSQLHOST}}
DB_PORT=${{MySQL.MYSQLPORT}}
DB_NAME=${{MySQL.MYSQLDATABASE}}
DB_USER=<cuenta de aplicación, ver privilegios-mysql-propuesta.md>
DB_PASS=<secreto en el gestor de Railway>
DB_SYNC=false
DB_SSL=false
JWT_SECRET=<aleatorio, al menos 32 caracteres>
CORS_ORIGINS=https://<proyecto>.vercel.app
UPLOAD_DIR=/data/uploads
TRUSTED_PROXY_CIDRS=<rangos confirmados con Railway>
MAIL_PROVIDER=<resend|gmail> (ver backend/MAIL.md)
```

- `CORS_ORIGINS`: orígenes exactos, sin ruta ni barra final. En producción solo se admiten `https:`; **por eso
  `http://localhost:5173` no es válido con `NODE_ENV=production`** y la API no arrancaría. Opciones: desarrollar contra
  una vista previa HTTPS de Vercel, o mantener un entorno de Railway separado (`staging`) sin `NODE_ENV=production`.
  Decidirlo antes del despliegue; no relajar la validación.
- No definir `SWAGGER_ENABLED=true`. Swagger queda apagado.
- `connect-src` no es un problema: el proyecto de Vercel no fija CSP en `vercel.json`. Si se añade, incluir el dominio de la API.

En Vercel (proyecto `frontend`): `VITE_API_BASE_URL=https://<dominio-de-la-api>/api` y volver a desplegar tras cambiarla.

### 9.4 Inicializar el primer gerente en una base nueva

Una sola vez por base, por la persona responsable, desde la terminal del servicio backend de Railway. **Ningún
proceso automático crea gerentes**, y el arranque de la API no crea cuentas.

1. Base vacía: `npm run db:init`, `npm run db:migrate`, `npm run db:check` (detenerse ante cualquier fallo).
   Usar la credencial de mantenimiento verificada para ese destino, inyectada solo en su proceso; no la de la API.
2. La persona que será gerente se registra desde React (`/admin/register`), con su correo real.
3. `npm run admin:assign-role -- --listar` (solo lectura): anotar la línea `--destino=… --servidor=<server_uuid>`
   y comparar el `server_uuid` con `SELECT @@server_uuid` en la consola de MySQL de Railway.
4. Simular: `npm run admin:assign-role -- --email=<correo> --rol=GERENTE_GENERAL`.
5. Aplicar: añadir `--apply --confirmar=<correo> --destino=<…> --servidor=<…> --operador=<iniciales> --motivo=<texto>`.
   Queda en `admin_auditoria`. Un segundo gerente exige `--permitir-otro-gerente`, a propósito.
6. El gerente inicia sesión de nuevo y asigna los demás roles desde «Roles y usuarios».

Alternativa sin registro web: `admin:create` crea la cuenta sin rol desde la terminal. Detalles y recuperación en
[roles administrativos](roles-administrativos.md). Los pasos 1–6 se ensayaron completos en una base nueva de un MySQL
desechable; sobre una copia de `horus_db`, que ya tiene gerente, el paso 4 se negó a crear otro, como corresponde.

### 9.5 Compartir cuentas de forma segura

- Cada persona tiene **su propia cuenta** con su correo; no compartir contraseñas ni una cuenta común de gerente.
- Asignar el rol mínimo necesario; la gerencia confirma la identidad por un canal propio antes de asignarlo.
- Las cuentas que dejan de usarse se **desactivan**, no se borran (conservan auditoría).
- Las credenciales de MySQL, `JWT_SECRET` y claves de correo viven solo en las variables del servicio backend.
  Ninguna computadora de desarrollo las necesita para usar la API central.

## 10. Qué se puede probar y dónde

| Prueba | Local | API central |
| --- | --- | --- |
| Pantallas con API simulada (`npm run smoke:*`, `test:*` de `frontend/package.json`) | Sí | No aplica |
| Login, permisos y CRUD con tu propio backend y tu MySQL de desarrollo | Sí, con cuentas propias | — |
| Cuentas compartidas entre las tres computadoras | No | Sí |
| Asignación de roles entre personas distintas | Solo con cuentas ficticias en tu base | Sí |
| Recuperación de contraseña por correo | No (sin proveedor real) | Sí, con correo configurado |
| CORS entre Vercel y Railway, cookies/cabeceras reales | No | Sí |

Desde `frontend/` con Node 22 (no tocan la base ni envían correo; los `smoke:*` abren Edge con API simulada y se
ejecutan **de uno en uno**, nunca en paralelo):

```powershell
npm run check; npm run lint; npm run build
npm run test:panel-access; npm run test:account-roles; npm run test:session-access; npm run test:signup-form
npm run smoke:roles; npm run smoke:panel-access; npm run smoke:signup
```

Desde `backend/`, con Node 22: `npm test` (pruebas unitarias con entorno aislado, sin MySQL real).
Las integraciones con MySQL requieren un servidor desechable y no deben apuntar a una base con datos.

## 11. Si algo falla

| Síntoma | Causa probable |
| --- | --- |
| Error CORS en la consola | El origen de React no está, exacto, en `CORS_ORIGINS` de la API. |
| 401 justo después de cambiar un rol | Esperado: la sesión se revocó; volver a iniciar sesión. |
| 403 «requiere permisos adicionales» | La cuenta no tiene rol o el rol no incluye ese permiso. |
| 503 en ediciones u horarios | La base de esa API no tiene las 18 migraciones: ejecutar `db:check`. |
| Las cuentas no aparecen en otra computadora | Esa computadora apunta a su `localhost`; revisar `VITE_API_BASE_URL`. |
