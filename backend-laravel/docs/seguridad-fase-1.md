> Actualización del 17/10/2026: la transición técnica local ya se aplicó y está pendiente de la comprobación personal del titular. Ver [registro de activación](activacion-seguridad-local-2026-10-17.md). El contenido siguiente documenta la preparación anterior.

# Seguridad y roles — fase 1 preparada, sin activar el entorno cotidiano

Fecha: 17/10/2026. Laravel 13.37.0, Filament 5.10.2, Livewire 4.4.7, PHP 8.4.26. No se instalaron paquetes.

## Comportamiento implementado

| Cuenta | Acceder a /gestion | Consultar, crear y editar recursos académicos | Borrar registros sin dependencias | Borrar matrículas |
| --- | --- | --- | --- | --- |
| administrador_general activo | Sí | Sí | Estudiantes, cursos y ediciones | Nunca |
| coordinador_institucional activo | Sí | Sí | Estudiantes, cursos y ediciones | Nunca |
| secretaria | No | No | No | Nunca |
| rol null (cuenta básica) | No | No | No | Nunca |
| cualquier cuenta desactivada | No | No | No | Nunca |

Los recursos autorizados en esta fase son Estudiantes, Cursos, Ediciones y Matrículas. No se añadió administración de usuarios ni facultades sobre otros sistemas. El administrador no tiene un Gate::before global. Las políticas vuelven a consultar rol/activo persistidos: conservar una sesión o un objeto User anterior no conserva permisos. Una cuenta eliminada tampoco los conserva.

Las políticas deniegan borrado masivo, forceDelete, restauración, replicación y reordenación. No se añadieron acciones masivas. Los modelos siguen impidiendo borrar estudiantes con matrículas, cursos con ediciones y ediciones con matrículas. Matricula conserva su prohibición de delete; tampoco se ofrece desde Filament. Estas protecciones de aplicación no conceden acceso para ejecutar SQL arbitrario contra la base.

Los cambios de estado tienen autorización de política y otra comprobación justo antes de escribir. Las altas desde RelationManagers también comprueban create al ejecutar. Los enlaces personalizados y accesos rápidos respetan permisos. Dashboard y widgets revalidan acceso, incluso al montar directamente o actualizar componentes Livewire. Authenticate se registra como middleware persistente. Filament utiliza autorización estricta cuando la seguridad está activa.

User solo admite asignación masiva de name/email/password: rol y activo no se aceptan desde datos públicos. La migración añade rol nullable y activo=true, con restricciones de valores; todas las cuentas existentes quedan básicas. No se promueve ninguna. El registro público Laravel/React aún no está implementado; las futuras altas deben conservar este contrato.

## Preparación y activación pendiente

`config/seguridad.php` contiene `activar_en_local`, leído de `HORUS_SEGURIDAD_ACTIVA`. Únicamente con APP_ENV=local y sin ese indicador verdadero se conserva temporalmente el acceso anterior y la ruta /admin. Esto es compatibilidad de preparación: **el servidor local cotidiano todavía no aplica la nueva seguridad por roles**. Fuera de local, la seguridad es obligatoria aunque ese indicador sea falso; la ruta es /gestion. El ID interno del panel sigue siendo admin.

La ruta y la autorización se activan juntas. No dependen de que existan columnas, ni de parámetros HTTP, ni de que coincida un correo. Aplicar la migración por sí sola no activa el modo seguro local. Antes de usar esta entrega fuera de local deben existir las columnas y una cuenta administrativa verificada; de lo contrario el acceso falla cerrado. No se modificaron .env, proxies, rutas React ni sesiones NestJS.

### Procedimiento que requiere nueva autorización

1. Confirmar el entorno exacto: este árbol, APP_ENV=local, servidor habitual http://127.0.0.1:8001 y archivo `backend-laravel/database/database.sqlite`, resuelto a su ruta absoluta local sin publicarla. Verificar otra vez que ese es el destino usado por Laravel, sin imprimir .env completo.
2. Identificar la cuenta candidata mediante su ID numérico y datos mínimos: nombre, correo y fecha de creación. Pedir al titular que confirme que es la cuenta con la que entra actualmente a Filament. Contrastar el ID con la sesión autenticada por un medio local supervisado; una coincidencia de correo por sí sola no sirve. Si no puede verificarse la titularidad o hay ambigüedad, detenerse.
3. Con la cuenta identificada, solicitar confirmación explícita del ID, entorno, base y cambio propuesto: asignar administrador_general y activo=true a esa cuenta existente, sin cambiar contraseña ni crear otra. La confirmación de la cuenta candidata no autoriza todavía migraciones o respaldos: incluir expresamente esas operaciones en la autorización de transición.
4. Solo tras esa autorización, detener escrituras del entorno elegido y preparar un respaldo privado consistente de SQLite con un procedimiento aprobado; verificar restauración en una copia aislada. No versionar respaldos ni datos de cuentas.
5. Revisar migraciones pendientes en ese destino. La inspección inicial, realizada con PDO `mode=ro`, encontró siete aplicadas; `2026_10_17_160000_add_telefono_valido_to_estudiantes_table` ya estaba pendiente antes de esta fase. Revisar teléfonos antes de cualquier migrate: esa migración se detiene si hay inválidos y no deben corregirse automáticamente.
6. Ensayar primero las migraciones y la transición sobre una copia autorizada, sin usar sesiones, correo ni colas reales. Verificar que la aditiva `2026_10_17_180000_add_rol_y_activo_to_users_table` conserva usuarios y contraseñas, deja rol null y no inventa administradores.
7. En la ventana autorizada, migrar y asignar el rol exclusivamente al ID confirmado, con una operación controlada que no use asignación masiva pública. Registrar el cambio sin secretos. Activar después `HORUS_SEGURIDAD_ACTIVA=true` en el entorno local por el mecanismo aprobado, revisar cachés/reinicio sin modificar scripts/serve-local.ps1 y abrir /gestion/login. El script seguirá anunciando /admin porque se ha conservado intacto.
8. Comprobar el acceso de esa cuenta, los rechazos de básicas/secretaría/desactivadas, URLs directas y revocación de sesiones. Comprobar también que los enlaces de widgets usan /gestion. No cambiar React/Vite/Caddy en esta fase.
9. Conservar un plan de recuperación probado. Ante un bloqueo, no improvisar altas administrativas ni cambios de contraseña. La compatibilidad /admin solo puede recuperarse deliberadamente en local; nunca desactivar roles en producción. Cualquier restauración de base necesita autorización y destino revisados.

**No se ejecutó ninguno de los pasos que escribe datos, asigna roles, migra, respalda o activa el entorno habitual.** Para iniciar la identificación basta confirmar entorno y proporcionar el ID de la cuenta candidata; los demás datos se contrastarán mediante lectura supervisada. Nunca se necesitan contraseñas, hashes, tokens ni archivos de sesión en el chat.

## Verificación de esta entrega

- Antes de cambios: 120 pruebas, 429 aserciones, todas aprobadas.
- Suite ampliada: `php vendor/phpunit/phpunit/phpunit --no-progress`, desde backend-laravel: **165 pruebas y 775 aserciones aprobadas**, sin fallos, usando SQLite :memory: y credenciales/correo ficticios. Este resultado corresponde al estado anterior a las ediciones visuales concurrentes detectadas al cerrar (ver apartado siguiente).
- Revisión independiente estática: sin hallazgos concretos en políticas, acciones, RelationManagers, widgets, transición o restricciones de historial. No sustituye las pruebas ni la futura validación de la activación real.
- Pint pasa en los otros 23 archivos PHP modificados o añadidos. Detectó únicamente formato en cuatro archivos previos del tema (Dashboard y los tres widgets: espacios en tipos, una anotación e import). Se conservó ese formato para evitar cambios ajenos a seguridad. Se ordenaron los imports de las pruebas nuevas; no se afirma que el lint global del proyecto esté limpio.
- Las pruebas existentes de acceso/tema/formularios ahora declaran un administrador ficticio y usan /gestion. Se conservan los casos de DNI, celular, cupos, matrícula duplicada, transiciones e historial.
- Se añadieron pruebas del login Filament, matriz de roles/activo, URLs protegidas, Gate, asignación masiva, migración desde usuarios previos, restricciones SQL y revocación en formularios, acciones, RelationManagers y widgets.
- Las pruebas HTTP obtienen snapshots firmados del GET y envían POST al endpoint real de Livewire, con control positivo antes de revocar y 403 después. Al cerrar sesión se obtiene 401. El cliente de pruebas reutiliza la aplicación; se vacían los cachés internos entre peticiones para reproducir peticiones PHP independientes.
- Se comprobó por CLI que el entorno local continúa registrando /admin y no /gestion, sin leer ni escribir cuentas reales. /up en el servidor 8001 respondió 200 y status=up; esa ruta no usa middleware de sesión.
- El proceso habitual 23036 continúa con extensión OPcache y los parámetros originales, incluidos validate_timestamps=1 y revalidate_freq=0. Una comprobación CLI con esos mismos parámetros confirma extensión cargada y opcache_enabled=true; no se publicó un endpoint de diagnóstico ni se reinició el servidor.
- Comparación SHA-256 con inventario anterior: sin cambios en SQLite de desarrollo, .env, scripts/serve-local.ps1, vistas Blade y logo. Ambos CSS coincidían al terminar la suite completa, pero cambiaron después mediante ediciones concurrentes ajenas a esta implementación. No se editó ni restauró ese trabajo. Los esquemas, infolists y tablas visuales de Claude se conservaron. La suite comprueba renderizado y recursos del tema; no se inició sesión real ni se realizó una nueva comparación visual con navegador.
- Git conserva `?? backend-laravel/`. No hay commits, staging ni pushes. Se verificaron exclusiones de .env, SQLite, vendor, sesiones y cachés; .env.example y los .gitignore de storage sí son archivos públicos versionables. No se incluyeron respaldos.

### Ediciones concurrentes ajenas a esta entrega

Durante el cierre cambiaron `resources/css/horus-academic.css` y `app/Providers/AppServiceProvider.php` con referencias a una fase visual 2A (CSS de tablas y un icono de CreateAction). No forman parte de los cambios de seguridad enumerados abajo. Se conservaron íntegros, sin editar ni publicar assets por nuestra parte. Al detectar la edición, el CSS fuente y el publicado diferían; el trabajo concurrente actualizó después `public/css/app/horus-academic.css`.

La reverificación `php vendor/phpunit/phpunit/phpunit --filter EscritorioTemaTest --no-progress` pasó **6 pruebas y 29 aserciones** con la publicación concurrente presente. Esto comprueba renderizado y paridad de assets; no constituye una aprobación visual nueva de la fase 2A.

La reverificación `php vendor/phpunit/phpunit/phpunit --filter Seguridad --no-progress` pasó **45 pruebas y 346 aserciones** con esas ediciones concurrentes presentes. No se repite ni se atribuye como propia la implementación visual externa.

## Inventario de archivos

Modificados (14):

- app/Models/User.php
- app/Providers/Filament/AdminPanelProvider.php
- app/Filament/Pages/Dashboard.php
- app/Filament/Support/AccionesAcademicas.php
- app/Filament/Widgets/AccesosRapidos.php
- app/Filament/Widgets/MatriculasPorEstado.php
- app/Filament/Widgets/ResumenAcademico.php
- app/Filament/Resources/Cursos/RelationManagers/EdicionesRelationManager.php
- app/Filament/Resources/Ediciones/RelationManagers/MatriculasRelationManager.php
- app/Filament/Resources/Estudiantes/RelationManagers/MatriculasRelationManager.php
- database/factories/UserFactory.php
- tests/Feature/Panel/AccesoPanelTest.php
- tests/Feature/Panel/EscritorioTemaTest.php
- tests/Feature/Panel/GestionAcademicaPanelTest.php

Añadidos (15):

- app/Enums/RolUsuario.php
- app/Support/SeguridadPanel.php
- app/Policies/PoliticaAcademica.php
- app/Policies/EstudiantePolicy.php
- app/Policies/CursoPolicy.php
- app/Policies/EdicionPolicy.php
- app/Policies/MatriculaPolicy.php
- config/seguridad.php
- database/migrations/2026_10_17_180000_add_rol_y_activo_to_users_table.php
- tests/Feature/Panel/SeguridadRolesTest.php
- tests/Feature/Panel/SeguridadPersistenciaTest.php
- tests/Feature/Panel/SeguridadAccionesTest.php
- tests/Feature/Panel/SeguridadHttpLivewireTest.php
- docs/seguridad-fase-1-plan.md
- docs/seguridad-fase-1.md

Referencias contrastadas con la implementación instalada: [acceso a Filament](https://filamentphp.com/docs/5.x/users/overview), [políticas Laravel](https://laravel.com/framework/docs/13.x/authorization) y [seguridad Livewire](https://livewire.laravel.com/docs/4.x/security).
