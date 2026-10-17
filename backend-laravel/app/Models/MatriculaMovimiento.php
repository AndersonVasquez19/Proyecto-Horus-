<?php

namespace App\Models;

use App\Enums\EstadoMatricula;
use App\Enums\TipoMovimientoMatricula;
use App\Exceptions\RegistroProtegidoException;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Entrada del historial de una matrícula: qué cambió, quién y cuándo.
 *
 * Solo la escribe App\Support\HistorialMatriculas dentro de la misma
 * transacción que la operación académica. Es de solo lectura: no se edita ni
 * se elimina. Sin atributos asignables en bloque (se crea con forceFill).
 */
class MatriculaMovimiento extends Model
{
    /** Registro inmutable: solo fecha de creación. */
    public const UPDATED_AT = null;

    protected $table = 'matricula_movimientos';

    protected function casts(): array
    {
        return [
            'tipo' => TipoMovimientoMatricula::class,
            'estado_anterior' => EstadoMatricula::class,
            'estado_nuevo' => EstadoMatricula::class,
            'created_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function (): void {
            throw new RegistroProtegidoException('El historial de matrículas no se modifica.');
        });

        static::deleting(function (): void {
            throw new RegistroProtegidoException('El historial de matrículas no se elimina.');
        });
    }

    /**
     * @return BelongsTo<Matricula, $this>
     */
    public function matricula(): BelongsTo
    {
        return $this->belongsTo(Matricula::class);
    }

    /**
     * Usuario responsable; null si la operación no se hizo con una sesión (consola, procesos internos).
     *
     * @return BelongsTo<User, $this>
     */
    public function usuario(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
