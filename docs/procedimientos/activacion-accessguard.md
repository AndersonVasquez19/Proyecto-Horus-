# Activación coordinada de AccessGuard y `ACCESS_MODE = 'por_roles'` (E3.6)

Estado: **H-BACK-01, E3.6 implementada localmente sobre `6c07b1f`, sin commit, sin publicar y sin desplegar.** El código candidato registra AccessGuard en el AppModule normal y anuncia `acceso.modo = por_roles`. **No está desplegado en ningún entorno** y **las cuentas reales todavía no se han preparado** (roles sin revisar ni asignar sobre el destino real). «Cuentas y acceso» sigue deshabilitada en el panel.

Complementa [preparacion-accessguard.md](preparacion-accessguard.md) (E3.5: preparación de cuentas y lista de verificación), [roles-administrativos.md](roles-administrativos.md) (matriz, scripts y recuperación) e [integracion-panel.md](integracion-panel.md) (React con el backend real).

## Qué cambia en el código

- `backend/src/app.module.ts` registra, en este orden:

  ```ts
  providers: [
    JwtAuthGuard,
    AccountAccessService,
    { provide: APP_GUARD, useClass: PublicRateLimitGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  ```

  `JwtStrategy` sigue en `AuthModule`. Los `@UseGuards(JwtAuthGuard)` locales de los controladores se conservan.
- `backend/src/permissions/session-access.ts`: `ACCESS_MODE = 'por_roles'`. El login y `GET /admin/me` lo informan en `acceso.modo`.
- **Ambos cambios van juntos.** No hay variable de entorno que active o desactive la guard ni el modo. `session-access.test.ts` exige que el modo anunciado coincida con el registro real en ambos sentidos y comprueba que detecta las dos configuraciones incoherentes (`por_roles` sin guard registrada: falsa garantía; guard registrada anunciando `heredado`). `access-guard.test.ts` exige que AccessGuard se registre una sola vez, en AppModule, después de `PublicRateLimitGuard`, y que ningún otro archivo la registre ni la use.
- Sin cambios en Prisma, migraciones, la matriz de permisos (`policy.ts`), los decoradores, el inventario de rutas ni el comportamiento de conservación de cursos.

### Orden de las guards: `PublicRateLimitGuard → AccessGuard`

Nest ejecuta las guards globales en el orden de la lista. Primero se aplica el límite de frecuencia y después la autorización, de modo que **un intento denegado (401 o 403) en una ruta limitada también consume cuota**. Así nadie puede usar respuestas de autorización para hacer intentos ilimitados contra `/admin/register` o `/admin/password`. Las rutas sin límite configurado no escriben cuotas.

### Lecturas de la cuenta por solicitud

Todas las rutas protegidas actuales conservan un `@UseGuards(JwtAuthGuard)` local, y cada ejecución de `JwtAuthGuard` invoca `JwtStrategy.validate`, que lee la fila de `admin_users` por clave primaria. Recuento según el código (no es una medición de rendimiento):

| Tipo de ruta | Antes de E3.6 | Con E3.6 | Adicionales |
| --- | --- | --- | --- |
| Pública | 0 | 0 | 0 |
| Autoservicio (`@AuthenticatedRoute`: `/admin/me`, cambio de contraseña) | 1 (`JwtStrategy`, guard local) | 2 (`JwtStrategy` desde AccessGuard + `JwtStrategy` desde la guard local) | 1 |
| Con permiso (`@RequirePermission`, `@RequireFollowUp`, `@RequireByField`) | 1 (`JwtStrategy`, guard local) | 3 (`JwtStrategy` desde AccessGuard + `AccountAccessService.find` + `JwtStrategy` desde la guard local) | 2 |
| Denegada por defecto (sin clasificar o recurso desconocido) | — | 1 (`JwtStrategy` desde AccessGuard) y 403 antes del controlador | — |

Si AccessGuard responde 401 o 403, la guard local no llega a ejecutarse y hay menos lecturas. Son consultas pequeñas por clave primaria; su efecto en la latencia no se ha medido. Se acepta en esta etapa y la optimización (por ejemplo, retirar las guards locales redundantes o reutilizar la fila leída) queda pendiente.

## Evidencia (ejecutada localmente, MySQL 8.4 efímero y cuentas ficticias)

Todas las ejecuciones usaron un contenedor `mysql:8.4` propio, publicado solo en `127.0.0.1`, con `server_uuid` leído con `docker exec`, `JWT_SECRET` aleatorio, sin correo ni OpenAI y con puertos temporales. No se usó la base habitual del proyecto.

| Prueba | Qué demuestra con la guard del AppModule real |
| --- | --- |
| `npm test` (`access-guard.test.ts`, `session-access.test.ts`) | Composición y orden en AppModule, coherencia modo ↔ registro y sus dos incoherencias; contrato `por_roles`; reglas por rol con dobles de prueba |
| `test/prisma.integration.cjs` | El AppModule real exige rol: las cuentas ficticias reciben `GERENTE_GENERAL` o `COORDINADORA_INSTITUCIONAL` y una sesión nueva tras subir `session_version`; el JWT anterior da 401; una cuenta sin rol recibe 403 |
| `test/admin-access-readiness.integration.cjs` (E3.5) | API normal (`dist/main.js`) con la guard: sin gerentes, las cuatro cuentas solo tienen autoservicio (403 «sin rol» real); tras asignar roles, gerente 200 y coordinadora y secretaria 403 en `/admin/users`; la coordinadora recibe 403 (antes 409) al intentar desactivar al gerente |
| `test/access-guard-http.integration.cjs` (E3.6) | El arranque de prueba solo importa AppModule y añade un controlador de sondeo; **las dos guards globales proceden de AppModule** (ninguna segunda AccessGuard). Barrido HTTP de todas las rutas administrativas por rol, rutas públicas, autoservicio, `seguimiento` y `segun_campo`, revocación por `session_version`, falsificación de roles, denegación por defecto, conservación de cursos (409/404/403 con registros e imagen intactos), ausencia de efectos ante 403 y orden de guards (cuotas, 401/403 antes de agotar, 429 al agotar, login 10/min, rutas sin límite intactas) |
| `frontend/scripts/integration-panel.cjs` (Edge) | React con el NestJS real en `por_roles`: menú e inicio por rol, cuenta sin rol sin secciones, 401 real que cierra la sesión, 403 real que la conserva y muestra el aviso, revocación por cambio de rol, ninguna solicitud no autorizada desde secciones ocultas, «Cuentas y acceso» deshabilitada |

### Cómo se obtuvo el 403 real en el navegador

El procedimiento autorizado (`admin:assign-role`) incrementa `session_version`, así que tras un cambio de rol el JWT anterior da **401** y el panel vuelve al login (lo comprueba la sección G del script). Con él no se puede observar un 403 de AccessGuard con la sesión abierta. Para obtenerlo, `integration-panel.cjs` hace una **simulación controlada, solo en la base MySQL temporal de esa ejecución**:

1. Con la coordinadora en el panel, un `UPDATE` directo cambia su `rol` a `SECRETARIA` **sin tocar `session_version`** (el JWT sigue siendo válido).
2. El panel conserva los permisos anteriores en memoria; al abrir «Convenios», su GET llega al NestJS real y AccessGuard responde **403** (no hay fallo inyectado: el script distingue los 403 reales de los simulados).
3. Se comprueba que la sesión se conserva (mismo token, panel abierto), que se muestra el aviso de falta de permiso, que `/admin/me` real (200) revalida y el menú pasa al del rol vigente, y que `session_version` no cambió.
4. Otro `UPDATE` directo restaura el rol en la base temporal.

Ese `UPDATE` no es un procedimiento administrativo y no debe usarse sobre bases reales: el cambio de rol real se hace siempre con `admin:assign-role`, que revoca las sesiones anteriores.

### Niveles de prueba

- **Prueba local**: todo lo de la tabla anterior, ejecutado en este equipo (Windows) con MySQL efímero.
- **Prueba HTTP en CI**: los scripts `.cjs` de E3.5 y E3.6 del backend, en el job `integration` (ver abajo).
- **Prueba de navegador manual**: `frontend/scripts/integration-panel.cjs` con Edge, solo en local; no forma parte de la CI.

**En GitHub Actions**: E3.5 y E3.6 ya se ejecutan en el job `integration` (pasos con MySQL efímero del runner); la última ejecución aprobada (CI #27, sobre `6c07b1f`) corresponde a sus versiones **preparatorias**, con la guard registrada solo en el módulo de prueba. Las versiones adaptadas a E3.6 solo se han ejecutado en local hasta que se publique este cambio. **La integración con navegador sigue siendo manual** (Windows, Edge) y no forma parte de la CI.

## Despliegue y reversión: siempre coordinados

Pendiente de autorización; nada de esto se ha ejecutado.

- **Antes de desplegar**: completar sobre el destino real la [lista de verificación de E3.5](preparacion-accessguard.md#lista-de-verificación-previa-a-e36) (destino identificado, esquema al día, al menos un gerente activo con acceso comprobado, decisión registrada para cada cuenta activa sin rol, matriz aprobada, recuperación ensayada). Con 0 gerentes, la guard deja la administración sin acceso.
- **Despliegue**: backend y frontend del **mismo commit**, migraciones aplicadas antes del backend y verificación posterior con la cuenta gerente (login, `/admin/me` con `acceso.modo = por_roles`, una sección por rol).
- **Reversión**: volver al commit anterior completo, que deja **a la vez** la guard sin registrar y `ACCESS_MODE = heredado`, sin tocar la base (ni roles, ni `admin_auditoria`, ni `session_version`). No se revierte solo uno de los dos cambios: la prueba de coherencia lo impide. La reversión devuelve la **seguridad degradada** descrita en E3.5 (cualquier sesión válida puede llamar a cualquier ruta administrativa).

## Riesgos pendientes antes de desplegar con cuentas reales

- Cuentas reales sin preparar: roles sin asignar en el destino; con la guard activa, toda cuenta sin rol queda solo con autoservicio.
- Cuentas activas sin rol: requieren una decisión explícita (asignar, conservar sin privilegios o desactivar) antes del despliegue.
- Recuperación dependiente de la terminal mientras «Cuentas y acceso» siga deshabilitada.
- Cerrar sesión no revoca el JWT en el servidor (válido hasta 8 h o hasta que cambie `session_version`).
- Lecturas repetidas de la cuenta por solicitud (2 adicionales en rutas con permiso, 1 en autoservicio; sin optimizar ni medir).
- La documentación Swagger, cuando se habilita, se protege con credenciales de cualquier administrador activo, sin mirar el rol (no expone datos, solo la descripción de la API; está desactivada por defecto en producción).
- La integración con navegador solo se ha ejecutado en Windows y fuera de la CI.
