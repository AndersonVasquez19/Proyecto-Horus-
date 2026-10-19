<?php

namespace App\Support;

use App\Models\Matricula;
use Closure;
use Illuminate\Database\ConcurrencyErrorDetector;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Validation\ValidationException;
use Throwable;

/** Serializa las escrituras Eloquent que comparten la disponibilidad de una edición. */
final class DisponibilidadAcademica
{
    public static function guardar(Model $modelo, mixed $edicionId, Closure $guardar): bool
    {
        $conexion = $modelo->getConnection();
        $nivelInicial = $conexion->transactionLevel();
        $atributos = $modelo->getAttributes();
        $originales = $modelo->getRawOriginal();
        $existia = $modelo->exists;
        $recienCreado = $modelo->wasRecentlyCreated;
        $campo = $modelo instanceof Matricula ? ($existia ? 'estado' : 'edicion_id')
            : ($modelo->isDirty('cupo') ? 'cupo' : 'estado');

        try {
            $conexion->beginTransaction();

            if (filled($edicionId)) {
                $edicion = $conexion->table('ediciones')->where('id', $edicionId);

                if ($conexion->getDriverName() === 'sqlite') {
                    // PRIMER acceso dentro de la transacción: reserva la escritura antes
                    // de leer estado/cupo. lockForUpdate() solo no bloquea en SQLite.
                    // No altera datos, timestamps ni dispara eventos de edición.
                    $edicion->update(['id' => $conexion->raw('id')]);
                } else {
                    $edicion->lockForUpdate()->first();
                }
            }

            if ($modelo->exists) {
                $cambios = $modelo->getDirty();
                $actual = $modelo->newModelQuery()->lockForUpdate()->findOrFail($modelo->getKey());
                // Conserva solo la intención de edición sobre el estado persistido
                // actual, para no validar transiciones desde un objeto obsoleto.
                $modelo->setRawAttributes($actual->getAttributes(), true);
                $modelo->setRawAttributes(array_replace($actual->getAttributes(), $cambios));
                $modelo->unsetRelations();
            }

            // parent::save(): conserva saving/creating/updating/saved y sus reglas.
            $guardado = $guardar();
            // API explícita de Laravel: si COMMIT falla (SQLite BUSY), el nivel
            // sigue abierto y el catch puede revertir realmente hasta el inicial.
            $conexion->commit();

            return $guardado;
        } catch (Throwable $e) {
            $conexion->rollBack($nivelInicial);
            // El rollback también deja reutilizable la instancia tras un rechazo.
            $modelo->setRawAttributes($originales, true);
            $modelo->setRawAttributes($atributos);
            $modelo->exists = $existia;
            $modelo->wasRecentlyCreated = $recienCreado;

            if ($modelo instanceof Matricula && $e instanceof UniqueConstraintViolationException
                && ($e->index === 'matriculas_estudiante_edicion_unique'
                    || $e->columns === ['estudiante_id', 'edicion_id'])) {
                throw ValidationException::withMessages([
                    'edicion_id' => 'El estudiante ya está matriculado en esta edición.',
                ]);
            }

            // Una transacción externa que ya leyó puede tener una instantánea SQLite
            // obsoleta (BUSY_SNAPSHOT). Se revierte este guardado; el llamador de
            // una transacción externa debe revertirla, nunca repetir solo el INSERT.
            if ($conexion->getDriverName() === 'sqlite' && (new ConcurrencyErrorDetector)->causedByConcurrencyError($e)) {
                throw ValidationException::withMessages([
                    $campo => 'La disponibilidad está siendo modificada por otra operación. Vuelva a intentarlo.',
                ]);
            }

            throw $e;
        }
    }
}
