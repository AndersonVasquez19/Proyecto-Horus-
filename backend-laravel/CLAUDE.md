# CLAUDE.md — Trabajo en el backend Laravel de Horus

Estas instrucciones se aplican solo a `backend-laravel/`. Complementan [AGENTS.md](../AGENTS.md) y [CLAUDE.md](../CLAUDE.md) de la raíz y [AGENTS.md](AGENTS.md) local; no reemplazan las reglas generales del proyecto. Las instrucciones explícitas del usuario y del entorno tienen prioridad.

- Comunícate en español y distingue comprobaciones ejecutadas, simuladas y estáticas. Antes de editar, revisa Git y conserva todo trabajo previo o concurrente.
- Laravel usa Eloquent ORM como ORM principal. Conserva modelos, relaciones, políticas, historial y reglas académicas salvo autorización para cambiarlos. No traslades instrucciones de Prisma/NestJS o React a Laravel.
- Limita el trabajo al alcance autorizado. No modifiques los proyectos vecinos `backend/` y `frontend/`, Docker, chatbot o correo por iniciativa propia.
- Usa los requisitos y comandos del [README.md](README.md), desde esta carpeta y con `composer.lock`. No instales automáticamente Laravel Boost, herramientas, paquetes PHP/npm ni requisitos del sistema. Si falta algo indispensable, informa y pide autorización; no ejecutes `composer setup`, que migra e instala npm.
- No ejecutes migraciones ni cambios de datos sin autorización explícita y comprobación del destino. Esto incluye seeders, importaciones, creación de usuarios y cambios de roles; instalar o revisar no autoriza esas operaciones. No uses comandos destructivos (`migrate:fresh`, `migrate:refresh`, `migrate:reset`, `db:wipe`, rollback) sobre bases existentes como solución rutinaria.
- Las pruebas autorizadas usan `phpunit.xml`, SQLite `:memory:` y datos ficticios, con la salvaguarda de `tests/TestCase.php` intacta. Las migraciones internas de esas pruebas se limitan al entorno aislado. No uses bases habituales ni servicios reales.
- Conserva `/gestion`, los roles, la seguridad y Horus Academic salvo solicitud expresa. No reinicies servidores ni cambies configuración local por una revisión documental.
- No expongas secretos ni datos personales; excluye entornos privados, SQLite, vendor, sesiones, logs y respaldos. Usa rutas relativas y ejemplos ficticios en documentación.
- El CSS del panel es estático y se publica con Filament; npm y su lockfile pueden posponerse mientras el flujo no use Vite. No instales npm por rutina.
- No prepares el índice ni ejecutes commits, pushes o despliegues automáticamente: requieren autorización explícita para la acción correspondiente. Entrega los cambios y las comprobaciones para revisión antes de avanzar.
