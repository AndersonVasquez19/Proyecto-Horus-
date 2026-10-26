# Preparación de las cuentas administrativas para activar AccessGuard (E3.5, fase 1)

Estado: **H-BACK-01, E3.5 fase 1 (local, sin publicar)**. Prueba: [`backend/test/admin-access-readiness.integration.cjs`](../../backend/test/admin-access-readiness.integration.cjs). Complementa [roles-administrativos.md](roles-administrativos.md) (scripts, reglas y recuperación) y [integracion-panel.md](integracion-panel.md) (panel React con el backend real); no los sustituye.

Esta fase no cambió lógica de producción, Prisma ni migraciones. Todo lo aquí probado se hizo con **cuentas ficticias** en un **MySQL 8.4 desechable**. Nada de esto autoriza ni demuestra cambios sobre cuentas reales.

> **Actualización E3.6 (local, sin desplegar).** El código candidato ya registra AccessGuard en el AppModule normal con `ACCESS_MODE = por_roles` ([activacion-accessguard.md](activacion-accessguard.md)); la prueba de esta fase se adaptó y ahora ejercita la API normal **con la guard activa**, de modo que varios resultados marcados abajo como [PREVISTO] se contrastan además con solicitudes reales de muestra. Las cuentas reales siguen sin preparar: esta lista de verificación sigue pendiente sobre el destino real.

> **El panel no es seguro por roles sin E3.6 desplegada.** Con AccessGuard inactiva (el código anterior a E3.6, que es lo que sigue desplegado), el backend solo exige una sesión válida (`JwtAuthGuard`): **cualquier cuenta administrativa autenticada, con o sin rol, puede enviar solicitudes directas** (fuera del panel, con su JWT) a operaciones que React le oculta, incluidas `POST /admin/register` y `PUT /admin/users/:id`. El filtrado por permisos del panel es solo de interfaz. Las únicas reglas que el backend aplica hoy a cualquier sesión son las de integridad (último gerente activo, última cuenta activa, conservación de cursos), no de autorización por rol.

## Qué demuestra la prueba

Tres tipos de evidencia, marcados así en la prueba:

- **Real**: procesos reales de `init-database`, `migrate`, `check-database`, `admin:create` y `admin:assign-role` (con `--destino`, `--servidor`, `--operador`, `--motivo`) y respuestas HTTP del NestJS compilado (`backend/dist`), con la base temporal.
- **[PREVISTO]**: lo que decide AccessGuard en `por_roles`, calculado con la misma lógica compilada que ella usa (`requirementFor` + `canAll` sobre `ROUTE_INVENTORY`) para el estado real de cada cuenta leído de la base. Son **resultados calculados, no solicitudes HTTP**; desde E3.6 se contrastan con solicitudes reales de muestra y la autorización efectiva ruta por ruta se prueba en `access-guard-http.integration.cjs`.
- **[SIMULADO]**: la pérdida del único gerente se provoca con un `UPDATE` directo en la base temporal (como en M-3), para poder ejercer la recuperación.

| Escenario | Resultado comprobado | Tipo |
| --- | --- | --- |
| Esquema | `init-database` + `migrate` y `check-database` termina en «Esquema compatible» | Real |
| Creación controlada | `admin:create` crea 4 cuentas activas **sin rol**; un `server_uuid` distinto no escribe nada | Real |
| Cero gerentes | `--listar` informa 0 gerentes; asignar `SECRETARIA` primero se rechaza sin escribir; las 4 cuentas inician sesión (desde E3.6, en `por_roles`) con `rol: null` y `permisos: []` | Real |
| Cero gerentes en `por_roles` | Las 4 cuentas quedan solo con autoservicio (`/admin/me`, `/admin/password`): bloqueo total de la administración. Desde E3.6 se comprueba además con 403 «sin rol» reales en una muestra de rutas | [PREVISTO] + muestra real |
| Asignación auditada | Cada `--apply` deja `rol_asignado` en `admin_auditoria` (origen `terminal`, operador y motivo declarados) y sube `session_version` en 1 | Real |
| Revocación de sesiones | Tras cada asignación, el JWT anterior de **esa** cuenta responde 401 en `/admin/me`; las sesiones de las demás siguen en 200 | Real |
| Login nuevo y `/admin/me` | El login posterior trae el rol de la base y `permisos` igual a `permissionsOf(rol)`; `/admin/me` devuelve lo mismo y `acceso.modo = por_roles` (E3.6; `heredado` en la versión preparatoria) | Real |
| Separación de permisos | Gerente 87 permisos, coordinadora 63, secretaria 15; el gerente incluye los de los otros dos; `cuentas:*` y `mensajes:eliminar` solo gerente; la secretaria sin `estadisticas:leer`; la coordinadora sin `items:leer` | Real (matriz compilada) |
| Rutas por cuenta en `por_roles` | De 70 rutas administrativas no públicas evaluadas con la lógica compilada (sin HTTP ni guard registrada): gerente 70, coordinadora 54, secretaria 14, sin rol 2 (autoservicio). Ninguna ruta del inventario queda sin clasificar | [PREVISTO] |
| Contraseña incorrecta | 401 sin token, con el mismo cuerpo que un correo inexistente | Real |
| Último gerente | El gerente no puede desactivarse a sí mismo (409); `admin:assign-role` no degrada al último gerente; la base y la auditoría quedan idénticas y la sesión del gerente sigue válida. En la versión preparatoria (modo heredado) la coordinadora **alcanzaba** `PUT /admin/users/:id` y recibía el 409 de la regla M-1; **desde E3.6 recibe 403 por permisos** antes de llegar a esa regla | Real |
| Cuenta inactiva | Desactivar desde la API: `activo = 0`, `rol = NULL`, `session_version + 1`, auditoría `cuenta_desactivada` con el actor; su JWT da 401; su login da 401 idéntico al de una contraseña incorrecta; el script no le asigna rol | Real |
| Reactivación | Una cuenta **con rol** desactivada y reactivada vuelve **sin rol** (`session_version + 2`); su login trae `rol: null`; `--listar` la detecta como cuenta activa sin rol; reasignar el rol revoca de nuevo la sesión | Real |
| Recuperación administrativa | Con 0 gerentes: `--listar` da la línea de confirmación; `admin:create` con otro `server_uuid` no escribe; con los valores comprobados crea la cuenta y `admin:assign-role` le da `GERENTE_GENERAL` sin `--permitir-otro-gerente`; el login real trae el rol y los 87 permisos | [SIMULADO] la pérdida; el resto real |
| Secretos | Ninguna salida de scripts ni de la API contiene contraseñas, hashes bcrypt, la clave de MySQL, el `JWT_SECRET` ni los tokens | Real |

Ya cubierto por otras pruebas y no repetido aquí: concurrencia, rollback por fallo de auditoría, esquema atrasado y segundo gerente con `--permitir-otro-gerente` (`admin-scripts.integration.cjs`, M-3, en CI); la guard con dobles de prueba (`access-guard.test.ts`); el panel React con el backend real (`integration-panel.cjs`).

### Dictamen automatizable

La prueba incluye `preflight()`, que interpreta la salida de `admin:assign-role -- --listar` (solo lectura, correos enmascarados) y señala: **0 gerentes activos** (bloqueo: activar la guard dejaría la administración sin acceso) y **cuentas activas sin rol** (pendientes de revisión: hay que decidir su tratamiento, que no tiene por qué ser desactivarlas). Se comprobó que detecta ambos y que no queda nada pendiente tras la recuperación. No es un script de producción: sobre el destino real se aplica la misma regla leyendo `--listar` a mano (lista de abajo, punto C).

## Cómo ejecutarla (PowerShell, Windows)

Desde `backend/`. Sin navegador. Dura menos de 1 minuto más una posible espera de hasta 60 s por el límite real de `/admin/login` (10 por minuto e IP), que la prueba respeta en lugar de eludirlo.

```powershell
# 1. MySQL desechable propio: nombre único, solo 127.0.0.1, puerto asignado por Docker, sin volumen con nombre.
$name = 'horus-e35-it-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$pass = 'it-' + [guid]::NewGuid().ToString('N')
docker run -d --name $name --label horus.purpose=e35-preparacion -p 127.0.0.1::3306 -e MYSQL_ROOT_PASSWORD=$pass mysql:8.4 --mysql-native-password=ON --authentication-policy=mysql_native_password --character-set-server=utf8mb4
do { Start-Sleep 2 } until (docker logs $name 2>&1 | Select-String 'ready for connections.*port: 3306')

# 2. Identidad del servidor leída dentro del contenedor y destino.
$env:ACCESS_READINESS_TEST_SERVER_UUID = docker exec -e MYSQL_PWD=$pass $name mysql -uroot -N -B -e 'SELECT @@server_uuid'
$env:DB_PORT = (docker port $name 3306).Split(':')[-1]
$env:ACCESS_READINESS_TEST_DB = 'true'; $env:DB_HOST = '127.0.0.1'; $env:DB_USER = 'root'; $env:DB_PASS = $pass

# 3. Compilar y ejecutar.
npm run build
node --test -r ./test/isolate-env.cjs test/admin-access-readiness.integration.cjs

# 4. Retirar el contenedor, su volumen anónimo y las variables.
docker rm -f -v $name
Remove-Item Env:ACCESS_READINESS_TEST_DB, Env:ACCESS_READINESS_TEST_SERVER_UUID, Env:DB_HOST, Env:DB_PORT, Env:DB_USER, Env:DB_PASS
```

Barreras antes de crear nada (las de `admin-scripts.integration.cjs`): `ACCESS_READINESS_TEST_DB=true`; `DB_HOST` de bucle local y `DB_PORT` explícito; `@@server_uuid` igual al leído con `docker exec`; servidor con Uptime < 1 h y sin tablas en bases ajenas a las del sistema. Solo crea y elimina `horus_e35_<hex>`. Scripts y API arrancan desde un directorio vacío (sin `.env`), con la precarga `isolate-env`, un `JWT_SECRET` aleatorio y sin credenciales de correo; ninguna ruta probada envía correo. El propio proceso de prueba no importa Prisma ni `database.cjs`. La API se cierra con `taskkill /T` (o `SIGKILL` en Linux) dentro de `finally`.

## Lista de verificación previa a E3.6

Cada punto indica si quedó **demostrado con cuentas ficticias** (esta fase) o si **requiere autorización y ejecución sobre el destino real**. Ningún punto real se ha ejecutado.

| # | Condición | Con cuentas ficticias (E3.5 fase 1) | Sobre el destino real (pendiente de autorización) |
| --- | --- | --- | --- |
| A | Destino MySQL identificado inequívocamente | Barreras + `--destino`/`--servidor`; un `server_uuid` ajeno no escribe | Anotar host, puerto, base y `server_uuid` obtenidos por una vía independiente (consola del proveedor); `--listar` debe mostrar exactamente esos valores |
| B | Esquema y migraciones compatibles | `check-database` «Esquema compatible» tras `migrate` | Respaldo (`db:backup`), `db:check`, `db:migrate` si falta `20261014-admin-rol` o `20261014-admin-auditoria`, `db:check` otra vez. Autorización expresa para migrar |
| C | Cuenta gerente activa y acceso real comprobado | Rol asignado con el script, login real y `/admin/me` con 87 permisos | El responsable **identifica** la cuenta del gerente (no se deduce); `admin:assign-role` simulado y aplicado; la persona inicia sesión y se guarda la salida de `--listar` con ≥ 1 gerente activo. Recomendado: un segundo gerente o un procedimiento de recuperación ensayado |
| D | Procedimiento de recuperación autorizado | Ejecutado completo (pérdida simulada) | Designar quién lo ejecuta, con qué acceso a la terminal y a la base, y dónde está el respaldo previo; aprobación por escrito |
| E | Sin cuentas administrativas activas sin rol que necesiten permisos | `preflight()` detecta las cuentas activas sin rol | Revisar `--listar` y **decidir y registrar**, antes del despliegue, el tratamiento de cada cuenta activa sin rol: asignarle el rol que necesita, **conservarla justificadamente sin privilegios administrativos** (con la guard activa solo tendrá autoservicio: `/admin/me` y cambio de contraseña) o desactivarla (nunca borrarla). Ninguna opción es obligatoria por defecto |
| F | Matriz de permisos revisada | Separación comprobada sobre la matriz compilada; recuento previsto por rol | Aprobación de la gerencia de la matriz de `policy.ts` (87 / 63 / 15) y de las pérdidas anunciadas: coordinadora y secretaria pierden `POST /admin/register`, `GET /admin/users` y `PUT /admin/users/:id` |
| G | Integración React ↔ NestJS aprobada | `integration-panel.cjs` adaptado a E3.6: guard activa, 401 y 403 reales, `por_roles` y cuenta sin rol, en un entorno desechable (manual, Windows) | Revisión y aprobación del responsable |
| H | Plan de despliegue uniforme | — | **Plan futuro**, a coordinar cuando exista un entorno autorizado; no se afirma que haya ningún despliegue hecho ni en curso. Requisitos: backend y frontend del **mismo commit** en los entornos que se autoricen (previstos Railway y Vercel); migraciones aplicadas **antes** del backend; roles revisados y asignados **antes** de activar; ventana acordada y verificación posterior con la cuenta gerente (login, `/admin/me` con `acceso.modo = por_roles`, una sección por rol) |
| I | Plan de reversión que conserve roles, auditoría y `session_version` | — | Revertir el código al commit anterior (guard sin registrar, `ACCESS_MODE = heredado`) **sin tocar la base**: sin `DROP`, sin restaurar respaldos, sin modificar `rol`, `admin_auditoria` ni `session_version`. **La reversión no conserva la protección**: devuelve al estado actual, en que cualquier sesión válida puede llamar a cualquier ruta administrativa. Debe tratarse como **seguridad degradada**: decidir de antemano quién la autoriza, restringir el acceso administrativo mientras dure (p. ej. solo la cuenta gerente operando, revisión de `admin_auditoria`) o recurrir a la recuperación controlada, y fijar el plazo para volver a activar la guard |

## Riesgos pendientes para desplegar E3.6

- **Mientras E3.6 no esté desplegada, cualquier sesión válida puede invocar cualquier operación administrativa** en el entorno publicado, también las que React le oculta, enviando solicitudes directas con su JWT (incluidas `PUT /admin/users/:id` y `POST /admin/register`). El código candidato de E3.6 lo cierra (comprobado con HTTP real en `access-guard-http.integration.cjs`), pero no está desplegado.
- **Reversión = seguridad degradada**: volver a un código sin la guard reabre el riesgo anterior (ver punto I).
- **Bloqueo total si se activa con 0 gerentes**: previsto y comprobado; la condición C es imprescindible.
- **Cuentas reales sin preparar**: los puntos A–F de la lista siguen pendientes sobre el destino real.
- **Recuperación dependiente de la terminal**: «Cuentas y acceso» sigue sin habilitar; si el único gerente pierde el acceso, solo los scripts con acceso a la base lo resuelven.
- **No se puede retirar un rol sin desactivar** (M-2 pendiente) y los intentos rechazados no se auditan (M-4 pendiente).
- **Cerrar sesión no revoca el JWT** en el servidor (válido hasta 8 h o hasta que cambie `session_version`).
- **`--operador` no autentica**: la constancia depende del acceso restringido a la terminal y a la base.
- Esta prueba y la de E3.6 se ejecutan también en la CI (job `integration`); la integración con navegador sigue siendo manual y solo en Windows.
