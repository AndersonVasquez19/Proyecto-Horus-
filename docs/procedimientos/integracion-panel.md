# Integración real del panel (React ↔ NestJS ↔ MySQL 8.4 desechable)

Estado: **H-BACK-01, E3.4.4 fase 2 (local, sin publicar)**. Script: [`frontend/scripts/integration-panel.cjs`](../../frontend/scripts/integration-panel.cjs).

**AccessGuard sigue inactiva** (`acceso.modo = heredado`): el backend no responde 403 por rol y cualquier sesión válida puede llamar a cualquier ruta administrativa. Esta prueba comprueba lo que hace **React** con respuestas reales (qué muestra y qué solicitudes evita). **No** demuestra ninguna autorización del servidor; esa se probará al activar AccessGuard (E3.6). Una ausencia de 403 aquí no es un fallo.

No forma parte de `npm test`, de los `test:*` ni de la CI (necesita Edge y Docker en la máquina). Se ejecuta a mano, en serie y solo contra un MySQL creado para la ocasión.

## Arquitectura

```
Edge (DevTools, perfil horus-panel-it-*)                       MySQL 8.4 en Docker (solo 127.0.0.1, puerto aleatorio)
  │  bloqueo de toda petición que no sea del origen local          ▲  base horus_panel_it_<hex> (se crea y se elimina)
  ▼                                                                 │
servidor de smoke-kit.cjs: sirve frontend/dist y reenvía /api/* ──► NestJS real (backend/dist/main.js), proceso hijo
  (mismo origen, como Caddy; aquí se inyectan los fallos [SIMULADO])     cwd vacío (sin .env), precarga isolate-env,
                                                                         JWT_SECRET aleatorio, sin correo ni IA
```

- **Esquema y cuentas con los procesos reales y auditados**: `init-database`, `migrate`, `check-database`, `admin:create` y `admin:assign-role` con `--destino`, `--servidor`, `--operador` y `--motivo`. No hay ningún atajo que los evite.
- **Cuentas ficticias** (solo en la base temporal, contraseña aleatoria por ejecución, nunca impresa): `gerente@horus-it.test` (GERENTE_GENERAL), `coordinadora@horus-it.test` (COORDINADORA_INSTITUCIONAL), `secretaria@horus-it.test` (SECRETARIA) y `sinrol@horus-it.test` (sin rol). Se eliminan con la base.
- **Datos ficticios**: una capacitación y una consulta manual, creadas por la API real con la sesión de la gerente.
- Los permisos esperados se leen de `backend/dist/permissions/policy.js` (la matriz real compilada). El panel no duplica la matriz.
- El límite real de `/admin/login` (10 por minuto e IP) se respeta: si hace falta, el script espera a la ventana siguiente.
- La limpieza de Edge es la oficial (`smoke-cleanup.cjs`, sin cambios). Ver «Problemas conocidos».

### Barreras de aislamiento (antes de crear nada)

1. `PANEL_IT_DB=true` explícito.
2. `DB_HOST` de bucle local y `DB_PORT` explícito.
3. `@@server_uuid` de la conexión igual a `PANEL_IT_SERVER_UUID`, leído **por otra vía** (`docker exec` dentro del contenedor).
4. MySQL 8.4, servidor recién creado (Uptime < 1 h) y sin tablas en ninguna base ajena a las del sistema.

Son las mismas que `backend/test/admin-scripts.integration.cjs`. Si una falla, el script se detiene sin crear ni escribir nada. Solo elimina la base `horus_panel_it_<hex>` que creó.

## Cómo ejecutarla (PowerShell, Windows)

Desde la raíz del repositorio. La contraseña de root es de un solo uso y no es un secreto, pero no se imprime.

```powershell
# 1. MySQL desechable propio: nombre único, solo 127.0.0.1, puerto asignado por Docker, sin volumen con nombre.
$name = 'horus-e344-it-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$pass = 'it-' + [guid]::NewGuid().ToString('N')
docker run -d --name $name --label horus.purpose=e344-integracion -p 127.0.0.1::3306 -e MYSQL_ROOT_PASSWORD=$pass mysql:8.4 --mysql-native-password=ON --authentication-policy=mysql_native_password --character-set-server=utf8mb4
do { Start-Sleep 2 } until (docker logs $name 2>&1 | Select-String 'ready for connections.*port: 3306')

# 2. Identidad del servidor leída dentro del contenedor y destino.
$env:PANEL_IT_SERVER_UUID = docker exec -e MYSQL_PWD=$pass $name mysql -uroot -N -B -e 'SELECT @@server_uuid'
$env:DB_PORT = (docker port $name 3306).Split(':')[-1]
$env:PANEL_IT_DB = 'true'; $env:DB_HOST = '127.0.0.1'; $env:DB_USER = 'root'; $env:DB_PASS = $pass

# 3. Compilar y ejecutar (en serie; ningún otro smoke a la vez).
Push-Location backend; npm run build; Pop-Location
Push-Location frontend; npm run build; node scripts/integration-panel.cjs; Pop-Location

# 4. Retirar el contenedor y su volumen anónimo, y las variables.
docker rm -f -v $name
Remove-Item Env:PANEL_IT_DB, Env:PANEL_IT_SERVER_UUID, Env:DB_HOST, Env:DB_PORT, Env:DB_USER, Env:DB_PASS
```

Si una comprobación falla o el script lanza un error, la ruta de error detiene la API, elimina la base `horus_panel_it_<hex>` y el directorio de trabajo, cierra Edge y borra su perfil antes de terminar con código 1. Si se interrumpe con Ctrl+C una vez abierto Edge, los manejadores de salida (síncronos) cierran la API y Edge y borran el perfil; antes de ese punto no hay manejador y la consola entrega la misma señal a la API hija. En ambos casos la base temporal y el directorio `horus-panel-it-api-*` (vacío, sin secretos) quedan hasta el paso 4, que elimina el contenedor completo. Borra ese directorio a mano si quedó.

Comprobaciones posteriores: `docker ps -a --filter label=horus.purpose=e344-integracion` vacío y ningún Edge con perfil `horus-panel-it-*` (`Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -match 'horus-panel-it' }`).

Salida: una línea `OK`/`FALLA` por comprobación (106 en total), `OBS` para observaciones que no son fallos y código 0 solo si todo pasa. Dura unos 2–3 minutos. Ningún token, contraseña ni `JWT_SECRET` aparece en la salida.

## Qué cubre

«Real» = respuesta del NestJS real con datos de la base temporal. «[SIMULADO]» = el reenvío inyecta un fallo de red, un retraso o un 503/403 en lugar de la respuesta (o antes de ella); el resto del escenario es real.

| Área | Casos | Tipo |
| --- | --- | --- |
| Contrato `POST /api/admin/login` y `GET /api/admin/me` | Claves exactas `user.{id,nombre,email,rol,permisos}` y `acceso.{modo}`; `rol` igual a la columna `admin_users.rol`; `permisos` igual a `permissionsOf(rol)`; `acceso.modo = heredado`; sin hash, `password` ni `session_version`; JWT solo con `id`, `email`, `version` (más `iat`, `exp`, `iss`, `aud`); `/me` idéntico al login; cuenta sin rol con `rol: null` y `permisos: []` | Real |
| Rechazos | Contraseña incorrecta (401 genérico, sin token); `/me` sin token, con token mal formado o con JWT alterado (rol añadido): 401 | Real |
| Cierre de sesión | No existe ruta de logout en el backend (404); el panel borra el token sin llamar al servidor | Real |
| A. Login y restauración | Login por el formulario sin consultar `/me` después; solo el token en `localStorage`; recarga con una sola consulta a `/me`; contraseña incorrecta sin token | Real |
| B/C/I. Menú por rol | Inicio y menú de gerente, coordinadora, secretaria (inicio en Mensajes sin `/admin/stats`) y cuenta sin rol (navegación heredada completa); «Cuentas y acceso» ausente; ninguna consulta a datos sin permiso de lectura | Real |
| D/E. Operaciones | Secretaria: Capacitaciones e Información de empresa en modo consulta, Enter sin PUT, Mensajes sin Eliminar ni Preparar cotización; «Iniciar atención» llega a la API y se confirma (200). Coordinadora y gerente: botones esperados | Real |
| F. Enlaces directos | Secretaria a Cotizaciones, Resumen, Convenios y Biblioteca; coordinadora a Biblioteca: aviso, sin redirección y sin solicitudes. `?section=cuentas` no monta la sección | Real |
| G. Cambio de rol | `admin:assign-role` (auditado) cambia secretaria → coordinadora e incrementa `session_version`; el JWT anterior da 401; el panel abierto vuelve al login («Tu sesión terminó»); el nuevo login muestra el menú de coordinadora y `/me` informa el rol nuevo | Real |
| H. Cierre y JWT inválido | Cerrar sesión borra el token y no lo presenta como caducada; token mal formado o alterado: 401, se borra y se muestra el login | Real |
| Revocación por `session_version` | `POST /admin/password` invalida el JWT anterior y el panel abierto vuelve al login; el nuevo login de la cuenta sin rol mantiene `rol: null` | Real |
| J. Errores temporales | Fallo de red o 503 en `/me` al restaurar: aviso con Reintentar, sin borrar la sesión; Reintentar consulta la API real y abre el panel. Fallo de red en una sección: la sesión se conserva | [SIMULADO] |
| 401 frente a 403 | 403 en una sección: no cierra la sesión y revalida con `/me` real | [SIMULADO] |
| Pestañas | Otra pestaña escribe un token real de otra cuenta: la primera lo valida con `/me` y cambia de cuenta (modelo compartido actual, sin cambios) | Real (la otra pestaña escribe el almacenamiento en lugar de usar su formulario) |
| Respuesta tardía | `/me` retrasado 3 s y la otra pestaña cierra sesión mientras tanto: la respuesta tardía no reabre el panel | [SIMULADO] el retraso |

## Pendiente (no cubierto aquí)

- **Autorización real del servidor** (403 por rol, rutas protegidas por permiso, cuentas sin rol en `por_roles`): exige AccessGuard activa. E3.6.
- **Revocación al cerrar sesión**: el backend no tiene logout; el JWT sigue siendo válido hasta su caducidad (8 h) o hasta que cambie `session_version`. La prueba lo comprueba y lo deja como observación.
- **Cambio de permisos «en caliente»**: con el procedimiento autorizado (`admin:assign-role`) todo cambio de rol revoca la sesión, así que no se puede producir una revalidación de `/me` con permisos distintos y la sesión viva. La revalidación al recibir el foco o un 403 se cubre con API simulada (`smoke:session-access`).
- **Login correcto seguido de un fallo de `/me` y restauración del token anterior**: el backend real devuelve el contrato completo y el panel no consulta `/me` tras el login, de modo que ese camino no se alcanza sin alterar la respuesta real. Lo cubren `test:session-access` y `smoke:session-access` (simulados).
- **Login simultáneo en dos pestañas con el formulario** y carreras de varias pestañas a la vez: solo se probó el cambio de cuenta y el cierre desde otra pestaña.
- **Desactivación de cuentas** (`PUT /admin/users/:id`): pertenece a «Cuentas y acceso», que sigue sin habilitar.
- Linux y la CI: el script no se ha ejecutado fuera de Windows, y ni él ni los smokes de navegador forman parte de la CI.

## Riesgos pendientes para E3.5 y E3.6

Registrados aquí; esta fase no cambia nada de producción.

- Cerrar sesión no revoca el JWT en el servidor (válido hasta 8 h o hasta que cambie `session_version`).
- AccessGuard sigue inactiva: falta probar el 403 real por rol y el modo `por_roles` (incluidas las cuentas sin rol).
- No se ha probado el login simultáneo con el formulario en dos pestañas.
- Integración ejecutada solo en Windows; los smokes de navegador siguen fuera de la CI.
- Errores `EPERM` intermitentes al borrar perfiles de Edge (ver «Problemas conocidos»).
- La conservación de cursos y capacitaciones se trabaja en un worktree aislado (`fix/conservacion-cursos-capacitaciones`) y todavía no está integrada: esta prueba no la cubre.

## Problemas conocidos

- **Perfil de Edge bloqueado (EPERM) tras cerrar el navegador.** En esta máquina, la limpieza oficial confirma el cierre del árbol de Edge pero el borrado del perfil puede fallar durante unos segundos. Este script repite solo el borrado (la limpieza es idempotente). Los smokes existentes no lo repiten: por ejemplo, `smoke:panel-access` pasó todas sus comprobaciones y terminó con código 1 dejando su perfil `horus-permisos-*`. Tras cualquier smoke, comprueba y borra solo los perfiles que creó tu ejecución.
- **Proceso de Edge que tarda en terminar.** Una vez (en la ruta de error del script) la limpieza oficial no pudo cerrar un proceso («Acceso denegado») y conservó el perfil: el proceso raíz ya estaba terminando (sin handles) y desapareció solo unos segundos después; `taskkill` no podía hacer más. Si el script termina con «Limpieza del navegador: …», comprueba los procesos `msedge.exe` con perfil `horus-panel-it-*` y borra ese perfil cuando hayan terminado.
- **Intermitencia observada una vez**: el login por formulario tras el cambio de rol (caso G) no abrió el panel en 8 s; no se reprodujo en las ejecuciones siguientes. El script espera ahora 15 s y, si vuelve a ocurrir, informa del aviso del formulario y de los estados reales de `/admin/login` (el límite es de 10 por minuto e IP; el script no pasa de 8).
