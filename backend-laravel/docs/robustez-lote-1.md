# Robustez académica — lote 1

Alcance: solicitud del 17/10/2026, integridad de matrículas, cupos y cancelaciones. Solo `backend-laravel/`; sin cambios de diseño, permisos, usuarios reales, entorno, OPcache, servidores ni bases habituales. Sin instalaciones, commits ni despliegues.

## Plan de implementación

- [x] Reproducir la reactivación en edición cancelada y las carreras con SQLite temporal.
- [x] Envolver `save()` de Matrícula y Edición conservando eventos Eloquent. Bloquear la misma edición antes de validar y escribir; releer el registro persistido para conservar las transiciones ante objetos obsoletos.
- [x] Traducir exclusivamente la restricción de unicidad estudiante/edición y mostrar el error en los dos modales de alta.
- [x] Verificar rollback, última plaza, reactivación, cancelación y reducción de cupo con procesos y conexiones independientes.
- [x] Ejecutar regresión completa y formato de los PHP modificados; documentar resultados y límites.

Revisión especial: transacciones externas con lecturas previas; estados obsoletos; cupo ilimitado; cambios de identificadores protegidos; errores SQL ajenos a la unicidad de matrícula.

La salvaguarda existente de `Tests\TestCase` seguirá exigiendo SQLite en memoria al arrancar. Las pruebas concurrentes crearán después una conexión explícita a un archivo temporal propio; los procesos secundarios comprobarán ese destino antes de migrar o escribir.

## Protección aplicada

`DisponibilidadAcademica::guardar()` abre una transacción Laravel alrededor de la validación y del `parent::save()`. Todos los guardados de Matrícula y Edición pasan por ella, incluidas las relaciones Eloquent usadas por Filament. Se conservan los eventos, las relaciones y las políticas.

En SQLite, el primer acceso a la base dentro del guardado es `UPDATE ediciones SET id = id WHERE id = ?`. Esa sentencia reserva la escritura sin alterar valores, timestamps ni eventos de la edición. El bloqueo de escritura se conserva hasta confirmar o revertir. No se confía en `lockForUpdate()`, que SQLite no implementa como bloqueo por fila. El tiempo de espera configurado es 5000 ms por conexión.

Antes de guardar un registro existente se relee bajo el bloqueo. Sobre ese registro se aplican únicamente los atributos modificados de la instancia: las transiciones se validan contra el estado persistido y una instancia antigua no sobrescribe cupo o estado que no estaba editando.

| Operación | Comprobación dentro del bloqueo y la transacción |
| --- | --- |
| Crear matrícula | Estudiante válido, edición existente que admite matrículas, ausencia de duplicado, ocupación inferior al cupo |
| Reactivar matrícula | Transición permitida desde el estado persistido, edición que admite matrículas y plaza disponible |
| Reducir cupo | El nuevo valor no puede quedar por debajo de las matrículas que ocupan plaza |
| Cancelar edición | No puede tener matrículas que ocupen plaza |

«Culminado» sigue ocupando plaza. «Retirado» y «Anulado» la liberan. Se conserva la regla actual de que una edición finalizada admite matrículas; este lote no cambia el enum de estados ni introduce otra política académica.

La restricción SQL existente `matriculas_estudiante_edicion_unique` sigue siendo la última defensa. Solo su colisión se convierte en el mensaje «El estudiante ya está matriculado en esta edición». Los errores de otras restricciones no se disfrazan de duplicados de matrícula. Los dos modales de alta sitúan el rechazo junto al campo que se puede elegir y conservan el formulario; la página de alta conserva su traducción existente.

Se usa la API explícita `beginTransaction()` / `commit()` / `rollBack(nivelInicial)`. La revisión reprodujo que `transaction()` con un único intento puede dejar PDO en transacción después de un `COMMIT` fallido con `SQLITE_BUSY`; la regresión añadida comprueba rollback real, ausencia de filas parciales y reutilización del mismo modelo y conexión.

## Evidencia y reproducción

Sin instalaciones. PHP CLI 8.4.26 y dependencias existentes de Composer.

Desde `backend-laravel/`:

```powershell
php vendor/phpunit/phpunit/phpunit --no-progress
php vendor/phpunit/phpunit/phpunit tests/Feature/Academico/BloqueoSqliteTest.php tests/Feature/Academico/ConcurrenciaDisponibilidadTest.php --no-progress
```

- Base previa: 178 pruebas / 897 aserciones, todas aprobadas.
- Se observaron pruebas rojas de reactivación cancelada, transición desde objeto obsoleto, falta de exclusión durante la última plaza y rollback incompleto después de COMMIT bloqueado; posteriormente pasaron.
- Concurrencia y bloqueo: 23 pruebas / 305 aserciones aprobadas. Incluyen 20 carreras con dos procesos PHP y conexiones independientes, diez escenarios en cada modo `DELETE` y `WAL`; además, lector que bloquea COMMIT, escritura que agota la espera y snapshot WAL obsoleto.
- Las carreras cargan ambos objetos antes de empezar. El primer proceso se detiene después de validar y antes del SQL definitivo; el segundo intenta guardar mientras el primero mantiene el bloqueo. Se verifica que no llegue a validar durante ese intervalo y después se comprueban resultado, mensaje, cupo, estado y filas conservadas. Las barreras tienen límites de tiempo; no se aceptan errores SQL inesperados como resultados correctos.
- Livewire prueba los dos modales y la página de alta con una colisión SQL real provocada después de la validación previa. Comprueba mensaje de validación, modal abierto, datos del formulario y matrícula anterior conservados. Es una prueba de componentes Livewire; no se ejecutaron dos solicitudes HTTP contra el servidor habitual.
- La suite completa incluye DNI, teléfono, permisos, roles, estados y protección del historial. Resultado final: **212 pruebas / 1263 aserciones aprobadas**, sin fallos (71,08 s en la ejecución de cierre).
- Pint `--test`, limitado a los doce archivos PHP del lote: aprobado.

Las migraciones de prueba solo crean el esquema en `:memory:` o en un archivo nuevo bajo `storage/framework/testing/robustez-<aleatorio>/`. El worker valida el directorio y la conexión antes de operar. No se flexibilizó la salvaguarda general de `Tests\TestCase`. Los archivos temporales se eliminan al terminar.

## Límites de SQLite y consideración futura de MySQL

- SQLite admite un solo escritor por archivo: se serializan también operaciones de ediciones diferentes. No se cambia `journal_mode` en la aplicación habitual. Referencia: [transacciones SQLite](https://www.sqlite.org/lang_transaction.html).
- Un lector prolongado en modo DELETE puede bloquear COMMIT. Si se agota la espera, el guardado se revierte y se devuelve validación para reintentar; no se promete que toda operación termine con éxito bajo contención prolongada.
- Una transacción externa que ya leyó una instantánea WAL antigua puede recibir `BUSY_SNAPSHOT`. Se revierte el savepoint del guardado, se informa de la contención y el propietario debe revertir su transacción externa y empezar de nuevo. Nunca se repite únicamente el INSERT ni se reejecutan eventos automáticamente.
- En MySQL se bloquea primero la fila de la edición con `SELECT ... FOR UPDATE`. El registro, el estado de la edición, las matrículas que ocupan plaza y la protección de cambio de curso usan lecturas actuales con bloqueo, para evitar instantáneas antiguas de REPEATABLE READ. Debe utilizarse InnoDB, conservar claves foráneas e índice UNIQUE y validar tiempos de espera, deadlocks y ambos órdenes de las carreras en una base desechable antes de migrar. Referencia: [bloqueo pesimista de Laravel](https://laravel.com/framework/docs/13.x/queries#pessimistic-locking).
- **MySQL no fue conectado ni verificado.** La compatibilidad está contemplada en el código; no constituye evidencia de integración en ese motor.
- La coordinación cubre las escrituras Eloquent normales de estos modelos. SQL manual, operaciones masivas del query builder y APIs que omiten los eventos del modelo no deben emplearse para cambiar disponibilidad; no ejecutan este flujo de validación. No se añadió una migración ni se cambiaron los CHECK existentes.

## Archivos del lote

Modificados:

- `app/Models/Matricula.php`
- `app/Models/Edicion.php`
- `app/Filament/Support/AccionesAcademicas.php`
- `app/Filament/Resources/Ediciones/RelationManagers/MatriculasRelationManager.php`
- `app/Filament/Resources/Estudiantes/RelationManagers/MatriculasRelationManager.php`
- `config/database.php`

Nuevos:

- `app/Support/DisponibilidadAcademica.php`
- `tests/Feature/Academico/RobustezMatriculaTest.php`
- `tests/Feature/Academico/ConcurrenciaDisponibilidadTest.php`
- `tests/Feature/Academico/BloqueoSqliteTest.php`
- `tests/Feature/Panel/RobustezMatriculasPanelTest.php`
- `tests/Support/disponibilidad-worker.php`
- `docs/robustez-lote-1.md`

El inventario se contrastó por SHA-256 con los archivos iniciales de aplicación, configuración, pruebas, migraciones, rutas, bootstrap, recursos y documentación. El proyecto Laravel ya estaba entero sin seguimiento en Git antes de esta tarea; no se atribuye su creación a este lote.

Al cerrar se detectó además una modificación concurrente en `tests/Feature/Panel/SeguridadHttpLivewireTest.php`, ajena a los 13 archivos de este lote. Se conservó sin editar ni atribuirla a este trabajo. Se ejecutó ese archivo otra vez sobre su contenido actual: 11 pruebas / 59 aserciones aprobadas.

No se modificaron frontend React, backend NestJS, diseño, `/gestion`, políticas, roles ni usuarios reales. No se conectó la SQLite habitual, no se ejecutaron migraciones en ella ni se borraron datos académicos reales. No se cambiaron `.env`, dependencias, chatbot, Resend, MySQL, Docker ni OPcache. El proceso de servidor del puerto 8001 conservó su PID y fecha de arranque. Sin reinicios, commits, pushes ni despliegues.

## Revisión final

La revisión independiente detectó COMMIT bloqueado sin rollback real (reproducido y corregido con prueba roja/verde) y una lectura de historial potencialmente antigua en MySQL al cambiar `curso_id` (análisis estático; corregida con lectura con bloqueo). No se amplió el alcance a otro lote.
