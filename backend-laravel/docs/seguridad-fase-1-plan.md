# Seguridad de Filament — fase 1

## Objetivo y decisiones

Implementar el encargo aprobado del 17/10/2026 dentro de backend-laravel, sin activar seguridad en la SQLite ni en el servidor cotidiano. Se conserva Horus Academic. No se instalan paquetes, no se modifica .env, no se hacen commits ni se integra React/NestJS.

La autorización usa políticas Laravel descubiertas por convención y el contrato canAccessPanel de Filament. Administrador general y coordinador institucional gestionan los cuatro recursos académicos actuales. No se crea un módulo de usuarios ni se otorgan facultades administrativas adicionales. Secretaría y cuenta básica no acceden. Las reglas de historial siguen prevaleciendo para ambos roles autorizados.

## Transición

Una configuración explícita permite conservar temporalmente el modo anterior solo en APP_ENV=local. Fuera de local la seguridad es obligatoria. La misma decisión controla /admin (preparación local) o /gestion (seguridad activa), sin consultar automáticamente el esquema ni promover usuarios. PHPUnit siempre usa seguridad activa y SQLite :memory:. No se ejecuta la activación real.

## Tareas y comprobaciones

- [x] 1. Escribir pruebas de acceso, roles/activo y asignación masiva; observar el rechazo de una cuenta básica fallando antes de implementar. Añadir enum RolUsuario, configuración de transición, migración aditiva y User::canAccessPanel. Probar defaults seguros, valores inválidos, actualización desde usuarios existentes y protección de rol/activo.
- [x] 2. Añadir EstudiantePolicy, CursoPolicy, EdicionPolicy y MatriculaPolicy. Crear/consultar/editar requieren cuenta activa y rol autorizado. El borrado de registros con dependencias y todo borrado de matrículas se deniegan. Operaciones masivas destructivas, replicación, restauración y forceDelete se deniegan. Probar Gate y acciones Filament reales, manteniendo cupos, duplicados y validaciones.
- [x] 3. Preparar /gestion, middleware de autenticación persistente, autorización explícita de acciones personalizadas, RelationManagers y widgets. Probar peticiones HTTP/Livewire con sesiones abiertas y revocación; adaptar fixtures antiguas para declarar un rol autorizado, conservando las expectativas académicas y visuales.
- [x] 4. Ejecutar suite completa y revisión de código; comparar hashes iniciales de SQLite, .env, script OPcache y recursos visuales. Documentar resultados, archivos y procedimiento de verificación/activación pendiente.

## Riesgos que las pruebas deben cubrir

- Un modelo User cargado antes de revocar rol/activo no puede conservar permisos.
- Una llamada directa a un widget o RelationManager no debe filtrar datos.
- Ocultar una acción personalizada no sustituye su autorización al ejecutar.
- Un administrador no puede saltarse restricciones de historial ni eliminar matrículas.
- El modo local previo no puede usarse fuera de local ni activarse por una petición del navegador.

## Registro

- Revisión inicial: git solo muestra `?? backend-laravel/`. Archivos privados, SQLite, vendor y sesiones ignorados. 120 pruebas / 429 aserciones pasan antes de cambios.
- SQLite real inspeccionada con PDO mode=ro: siete migraciones aplicadas; la restricción de teléfono está pendiente. No se ejecutaron migraciones reales.
- Ejecución en este árbol expresamente solicitado (la carpeta aún no está versionada); no se mueve ni restaura trabajo de Claude. Se conserva inventario SHA-256 de 112 archivos para comparar los cambios.
- Resultado de la suite completa: 165 pruebas / 775 aserciones aprobadas. Revisión independiente estática sin hallazgos. Los archivos protegidos conservan sus hashes; tras la suite se detectaron ediciones concurrentes ajenas en el CSS fuente y AppServiceProvider, conservadas sin intervenir. No se extrapola el resultado visual previo a esas ediciones. El procedimiento de activación queda en seguridad-fase-1.md y no se ha ejecutado.
- Reverificación posterior al trabajo concurrente: Seguridad 45 pruebas / 346 aserciones; EscritorioTema 6 pruebas / 29 aserciones. Ambas aprobadas. El CSS publicado también fue actualizado por ese trabajo concurrente.
