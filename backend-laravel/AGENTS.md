# AGENTS.md — Backend Laravel de Horus

## Alcance y jerarquía

Esta guía se aplica exclusivamente a `backend-laravel/` y complementa las instrucciones generales de [AGENTS.md](../AGENTS.md) y [CLAUDE.md](../CLAUDE.md) de la raíz; no las sustituye. Lee también [CLAUDE.md](CLAUDE.md) de esta carpeta. Las instrucciones explícitas del usuario y del entorno tienen prioridad.

## Tecnología y trabajo local

- Laravel 13 y Filament 5; Eloquent ORM es el ORM principal. Conserva los modelos, relaciones, políticas y reglas académicas salvo solicitud expresa. Las instrucciones de NestJS/Prisma y React pertenecen a los paquetes vecinos.
- Revisa `git status --short` y las instrucciones aplicables antes de editar. Conserva cambios ajenos y limita los cambios al alcance autorizado; no modifiques `backend/`, `frontend/` ni proyectos vecinos por iniciativa propia.
- Usa PHP y Composer desde `backend-laravel/`, respetando `composer.lock`. Consulta [README.md](README.md) para requisitos, reconstrucción, pruebas y arranque; inspecciona los scripts antes de ejecutarlos.
- No instales Laravel Boost, paquetes, herramientas ni requisitos automáticamente. Si falta una dependencia necesaria, informa del bloqueo y solicita autorización para instalarla. No ejecutes `composer setup`: incluye migraciones e instalación npm.
- El tema Horus Academic usa CSS estático publicado por Filament. No instales dependencias npm ni generes `package-lock.json` por rutina; Vite solo se incorpora al trabajo si la tarea lo requiere y está autorizada.

## Datos, seguridad y comprobaciones

- No ejecutes migraciones, seeders, importaciones, creación de cuentas, asignación de roles ni otros cambios de datos sin autorización explícita y destino comprobado. Una revisión o instalación de dependencias no los autoriza. Nunca uses `migrate:fresh`, `migrate:refresh`, `migrate:reset`, `db:wipe` ni rollback como mantenimiento rutinario de bases existentes.
- Las pruebas se ejecutan con `phpunit.xml` y `tests/TestCase.php`: SQLite `:memory:`, servicios simulados y datos ficticios. Mantén la salvaguarda que aborta ante otra conexión; no apuntes pruebas a la SQLite local ni a MySQL compartido. Las migraciones internas de las pruebas solo corresponden a ese entorno aislado y a una ejecución de pruebas autorizada.
- Conserva `/gestion`, la lógica de acceso, roles y middleware persistente salvo solicitud expresa. No actives ni desactives seguridad para sortear fallos. No alteres el diseño Horus Academic fuera de una tarea visual autorizada.
- No publiques `.env`, APP_KEY, claves, bases SQLite, sesiones, logs, respaldos ni datos personales. Documenta con rutas relativas y cuentas ficticias.
- Para documentación y exclusiones de Git, verifica coherencia, archivos candidatos, reglas de exclusión y diff; no requiere arrancar servidores ni ejecutar suites que escriban datos.
- No prepares el índice, hagas commits, pushes o despliegues automáticamente. Cada acción requiere estar cubierta por autorización explícita; una simulación de `git add` no autoriza un `git add` real.
