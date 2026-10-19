# Activación de seguridad local — 17/10/2026

Estado: cambios técnicos aplicados y comprobados; pendiente la confirmación personal del titular al entrar en http://127.0.0.1:8001/gestion. No se declara finalizada la activación.

## Destino y cambios aplicados

- Exclusivamente backend-laravel, APP_ENV=local y database/database.sqlite, cuyo destino absoluto se contrastó antes de conectar. No se accedió a MySQL.
- El titular confirmó mediante su sesión local la cuenta existente seleccionada para la transición.
- Cero teléfonos inválidos antes de migrar. Integridad SQLite y claves foráneas correctas.
- Ventana de mantenimiento verificada en los servidores Laravel de 8000 y 8001; finalizada tras la transición. No se detuvo ni reinició el proceso optimizado de 8001.
- Respaldo consistente mediante SQLite3::backup, firma SHA-256 y restauración comprobada en un archivo aislado mediante comparación de esquema y de los datos de todas las tablas. Se ensayó la transición en una segunda copia.
- Únicamente las migraciones 2026_10_17_160000_add_telefono_valido_to_estudiantes_table y 2026_10_17_180000_add_rol_y_activo_to_users_table, ambas en lote 3. Las nueve migraciones del proyecto constan aplicadas; ninguna pendiente.
- Asignación con Eloquent y transacción de administrador_general y activo=true únicamente a la cuenta existente confirmada. Una sola cuenta antes y después. Los campos anteriores, incluidos contraseña, correo, remember_token y fechas, conservan exactamente sus valores. No se crearon cuentas ni se cambiaron contraseñas.
- Único cambio de configuración: HORUS_SEGURIDAD_ACTIVA=true en .env mediante el mecanismo existente. Ruta /gestion e identificador interno admin. Autorización estricta activa y middleware persistente conservado.
- Eloquent sigue siendo el ORM del backend Laravel. Se conservaron User, Estudiante, Curso, Edicion, Matricula, relaciones, políticas y restricciones.

## Evidencia

- Suite completa final, SQLite :memory:: 178 pruebas y 897 aserciones aprobadas. Incluye roles, acciones, revocación HTTP/Livewire, historial y tema de fases 1, 2A y 2B.
- En la copia aislada, usando la misma cuenta confirmada dentro de transacciones revertidas: administrador y coordinador activos reciben 200; cuenta básica, secretaría y ambos roles inactivos reciben 403. También se probaron URLs directas de alta y listado con cuentas no autorizadas. No se crearon usuarios adicionales en la base habitual ni en la copia.
- Con la cuenta existente confirmada, base abierta solo para lectura y sesiones array: el kernel HTTP devuelve 200 en /gestion, los cuatro listados y los cuatro formularios de alta; las políticas permiten el acceso. Estas comprobaciones establecen el usuario en memoria y no prueban la introducción de credenciales ni la sesión del navegador del titular.
- Servidor real 8001: /gestion y los cuatro módulos redirigen al visitante sin sesión hacia /gestion/login; login 200 con Horus Academic y Livewire; /admin, /admin/login y /gestion/register responden 404; /up responde 200. El CSS servido coincide exactamente con el fuente y conserva Fase 2B.
- PID original 23036, escuchando en 8001, con php_opcache.dll cargada y opciones enable_cli=1, validate_timestamps=1 y revalidate_freq=0. No fue necesario reiniciarlo.
- Los 119 archivos inventariados de app, config, migraciones, factories, resources, routes, tests, scripts, CSS publicado y logo conservan SHA-256. No se cambió el diseño.
- Los datos académicos completos conservan sus huellas: 4 estudiantes, 1 curso, 1 edición y 3 matrículas. No se borraron ni recrearon registros.
- React, NestJS y sus archivos versionados sin cambios. Sin instalaciones, commits ni pushes.

## Respaldo y recuperación

La ubicación privada del respaldo, los manifiestos y las instrucciones se entregó al titular. Está fuera del repositorio, en LocalAppData/HorusAcademic, con acceso restringido al usuario de Windows. No versionar ese contenido.

RECUPERACION.md y entorno.php permiten recuperar deliberadamente la configuración local anterior sin borrar datos ni revertir migraciones. La reversión exacta de .env se probó sobre una copia; el script se detiene si cambió el entorno después de la activación. No se ejecutó sobre el entorno habitual.

En caso de bloqueo: entrar en mantenimiento, confirmar el destino local, recuperar únicamente la configuración anterior mediante el procedimiento privado, salir de mantenimiento y comprobar /admin/login en 8001. Nunca usar este modo temporal fuera de local. No restaurar la SQLite habitual ni ejecutar rollback/fresh/wipe como solución rutinaria: una restauración podría perder cambios posteriores y necesita autorización específica.

Pendiente: el titular debe abrir /gestion y confirmar personalmente que puede entrar con su cuenta autorizada. Hasta recibir esa confirmación, la activación permanece pendiente.
