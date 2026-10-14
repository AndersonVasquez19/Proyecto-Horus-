# Roles administrativos: columna `rol`, asignación y recuperación

Estado: **Etapa 2 de H-BACK-01 (preparación)**. La columna `admin_users.rol` y el script `admin:assign-role` existen, pero **el rol todavía no lo consulta ninguna ruta, guard, JWT ni pantalla**. Mientras no se active el control de acceso (etapas posteriores), todas las cuentas siguen con los permisos actuales. Asignar un rol ahora solo deja el dato preparado.

Roles aprobados (idénticos en `src/permissions/roles.ts`, `schema.prisma`, la migración y el script; una prueba lo comprueba): `GERENTE_GENERAL`, `COORDINADORA_INSTITUCIONAL`, `SECRETARIA`.

## Qué cambia en la base

- Migración `20261014-admin-rol`: `ALTER TABLE admin_users ADD COLUMN rol ENUM(...) NULL`. Solo añade una columna nula **sin valor predeterminado**: ninguna cuenta recibe un rol de forma implícita y no se modifica ninguna fila.
- Es **requerida antes de desplegar** el backend que incluya este cambio: el cliente Prisma selecciona `admin_users.rol` y el inicio de sesión fallaría sin la columna. Ver `RAILWAY.md`.
- No hay migración de retroceso a propósito (las migraciones del proyecto no borran estructura). La columna nula no estorba; ver «Recuperación».

## El script `admin:assign-role`

Desde `backend/`. **Por defecto solo simula y solo lee.**

```
npm run admin:assign-role -- --listar
npm run admin:assign-role -- --email=<correo> --rol=<ROL>
npm run admin:assign-role -- --email=<correo> --rol=<ROL> --apply --confirmar=<correo> --destino=<host>:<puerto>/<base> --servidor=<server_uuid>
```

### Confirmación del destino (qué garantiza y qué no)

1. **Una sola configuración.** Al arrancar, el script carga `database.cjs`, que lee el `.env` del directorio actual (dotenv) y, al importar Prisma, también `backend/.env` para las variables que falten; las variables del proceso prevalecen sobre ambos archivos. Esa configuración se resuelve **una vez**, antes de validar nada, y la conexión se abre forzando ese mismo host, puerto y base. Lo que se confirma es lo que se usa.
2. **`--destino=<host>:<puerto>/<base>`** debe coincidir exactamente con la configuración resuelta (incluido el puerto: dos servidores en el mismo host con la misma base se distinguen). Si no coincide, el script **se detiene sin conectarse** y muestra el destino configurado. Esto comprueba la *configuración*, no el servidor.
3. **Base real.** Tras conectar, `DATABASE()` debe ser exactamente la base configurada; si no, se detiene sin leer ni escribir cuentas (también en `--listar` y en la simulación).
4. **`--servidor=<server_uuid>`** identifica al servidor MySQL realmente conectado (`@@server_uuid`). `--listar` y la simulación lo muestran junto con la línea de confirmación completa. Para escribir, el valor debe coincidir; si no coincide o no se puede obtener, **no se escribe nada**.
5. El *hostname* y el *puerto* que informa MySQL (`@@hostname`, `@@port`) se muestran solo como referencia: con Docker, proxies o nombres DNS pueden diferir legítimamente del host y puerto configurados, por lo que **no** se usan como prueba de identidad.

Límites: `server_uuid` demuestra que la escritura ocurre en el **mismo** servidor que se listó o simuló, no que ese servidor sea el correcto. Compare el valor con la identidad conocida del destino (anotada por el responsable, p. ej. con `SELECT @@server_uuid` desde la consola del proveedor). Una copia del directorio de datos de MySQL (clonación de un servidor) puede conservar el mismo `server_uuid`; por eso también se exigen host, puerto y base.

Salvaguardas:

- Sin `--apply` no abre transacciones ni escribe. Con `--apply` exige repetir el correo exacto (`--confirmar`), el destino configurado (`--destino`) y la identidad del servidor conectado (`--servidor`), según el apartado anterior. Las opciones repetidas o incompatibles se rechazan.
- Solo asigna roles a cuentas **existentes y activas**; no crea cuentas, no cambia contraseñas ni correos y no activa ni desactiva cuentas. **No puede retirar un rol** (volver a «sin rol») ni cambiar el de una cuenta desactivada: solo cambia entre los tres roles (ver M-2).
- Nunca deja al sistema **sin un `GERENTE_GENERAL` activo**: el primer rol asignado en una base sin gerente tiene que ser `GERENTE_GENERAL`, y no se puede degradar al último gerente.
- Dar `GERENTE_GENERAL` a una segunda cuenta exige `--permitir-otro-gerente` (para que el acceso completo no se conceda por accidente).
- **Toda** asignación o cambio de rol, incluida la primera, sube `session_version` de esa cuenta: cierra sus sesiones abiertas y obliga a iniciar sesión de nuevo (decisión aprobada). Las demás cuentas no se tocan.
- Escribe dentro de una transacción con las filas bloqueadas (`FOR UPDATE`) y con un bloqueo de MySQL contra ejecuciones simultáneas; revalida con esas filas y comprueba el resultado final antes de confirmar. Si algo cambió o falla, revierte.
- No lee la columna de contraseñas ni muestra usuario, contraseña o cadena de conexión. Los listados enmascaran los correos (`ab***@dominio`). Si falta la columna `rol`, se detiene e indica aplicar la migración.
- Cada ejecución imprime el destino, la cuenta, el rol anterior y el nuevo. **Todavía no existe tabla de auditoría**: conserve la salida de la terminal como constancia (la auditoría llega en una etapa posterior).

## Plan seguro para asignar al primer gerente

Requiere autorización expresa del responsable; no lo ejecuta ningún proceso automático.

1. Confirmar el entorno y su destino (`DB_HOST`, `DB_PORT`, `DB_NAME`) y obtener, por una vía independiente, el `server_uuid` del servidor de destino.
2. Respaldo: `npm run db:backup -- --dir=<volumen persistente>` (ver `backup-restauracion.md`) y comprobar que existe.
3. `npm run db:check` (solo lectura). Antes de migrar se espera que informe `admin_users.rol: falta`.
4. `npm run db:migrate`; después `npm run db:check` debe terminar en «Esquema compatible».
5. `npm run admin:assign-role -- --listar`. Comprobar que «Destino configurado», la base y el `server_uuid` mostrados son los esperados. **El responsable identifica cuál cuenta es la del gerente**; no se deduce por orden ni por antigüedad.
6. Simular: `npm run admin:assign-role -- --email=<correo del gerente> --rol=GERENTE_GENERAL` y revisar cuenta, rol, conteo de gerentes y la línea de confirmación.
7. Aplicar con `--apply --confirmar=<correo> --destino=<host>:<puerto>/<base> --servidor=<server_uuid>`, usando valores comprobados en los pasos 1 y 5.
8. Comprobar con `--listar` (debe mostrar 1 gerente activo) y guardar la salida.
9. Las demás cuentas **quedan sin rol** (`NULL`). Nada las eleva. Cuando el control de acceso esté activo, una cuenta sin rol solo podrá consultar su sesión y cambiar su contraseña. Las cuentas que ya no correspondan (por ejemplo, del antiguo puesto administrativo) se **desactivan, no se borran**, desde «Cuentas y acceso» cuando exista o por el procedimiento que se autorice.
10. Asignar los demás roles uno a uno con el mismo script (simulación primero).

## Recuperación ante fallos

| Situación | Qué hacer |
| --- | --- |
| El script falla o se interrumpe | La transacción se revierte; vuelva a ejecutar `--listar` para ver el estado real y repita la simulación. El bloqueo de MySQL se libera al cerrar la conexión. |
| Se asignó el rol a la cuenta equivocada | Asigne `GERENTE_GENERAL` a la cuenta correcta con `--permitir-otro-gerente`, y después cambie la equivocada a otro de los tres roles (todo cambio de rol cierra las sesiones de esa cuenta). **El script no puede dejarla «sin rol»**: si no debe tener ningún acceso, desactívela por la vía autorizada; su rol se conserva mientras esté inactiva (M-2). No se puede quitar el rol del último gerente activo, a propósito. |
| El gerente olvida su contraseña | Flujo normal «Olvidé mi contraseña» (`/admin/forgot-password`); no requiere el script. |
| El gerente pierde también el acceso a su correo, o la cuenta quedó desactivada | Con acceso a la terminal y a la base: crear otra cuenta con `npm run admin:create` y darle `GERENTE_GENERAL` con `--permitir-otro-gerente`; la cuenta desactivada se tratará después. Requiere autorización expresa y respaldo. |
| La migración causó un problema | La columna es nula y aditiva; no hace falta deshacerla. Si fuera imprescindible volver al estado anterior, restaure el respaldo previo (`backup-restauracion.md`) y vuelva a ejecutar `db:migrate`. No se proporciona un `DROP COLUMN`. |
| El backend se desplegó antes que la migración | El inicio de sesión fallará: aplique `db:migrate` de inmediato (es aditiva y rápida). Evítelo aplicando la migración antes de desplegar. |

## Decisiones aprobadas y pendientes

Aprobadas: toda asignación de rol sube `session_version`; se mantienen las confirmaciones estrictas (`--apply`, correo, destino con puerto, identidad del servidor, segundo gerente); las cuentas no identificadas permanecen sin rol; los campos de trazabilidad de asignaciones (quién y cuándo) se incorporarán con la auditoría; **el primer gerente lo identifica expresamente el responsable** (no se deduce), y la cuenta de desarrollo se mantiene separada de las de producción.

Pendientes: cuándo y cómo se ejecuta la migración en cada entorno (local, Railway) y quién la autoriza; qué hacer con las cuentas actuales que no correspondan (propuesta: desactivarlas, no borrarlas).

## Observaciones abiertas de la auditoría (no resueltas en esta etapa)

| ID | Observación | Debe resolverse |
| --- | --- | --- |
| M-1 | La regla «siempre un gerente activo» solo la aplica el script: desde el panel (`PUT /admin/users/:id`, `AccountsService.status`) se puede desactivar al único gerente si queda otra cuenta activa, y entonces el script permitiría nombrar gerente a cualquier cuenta activa sin la opción especial. | Antes de activar los permisos. |
| M-2 | No hay operación para retirar un rol (volver a `NULL`) y las cuentas desactivadas conservan el suyo; al reactivarlas lo recuperan sin pasar por el script. | Antes de activar los permisos. |
| M-3 | No hay regresión automática contra MySQL del script: las pruebas de CI usan una base simulada. La validación con MySQL real fue manual y aislada. | Antes de administrar roles en producción. |
| M-4 | Las asignaciones de privilegios no quedan en un registro de auditoría; la constancia es la salida de la terminal. | Antes de administrar roles en producción (o aceptarlo expresamente). |
