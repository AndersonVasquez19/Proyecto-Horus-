<?php

namespace App\Models;

use App\Enums\EstadoMatricula;
use App\Exceptions\RegistroProtegidoException;
use App\Support\DisponibilidadAcademica;
use App\Support\HistorialMatriculas;
use Database\Factories\MatriculaFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Validation\ValidationException;

/**
 * Matrícula de un estudiante en una edición concreta.
 *
 * Forma parte del historial académico: no se elimina; se cambia su estado
 * (p. ej. a «Anulado»). El alta y cada cambio de estado quedan registrados en
 * MatriculaMovimiento dentro de la misma transacción.
 */
#[Fillable(['estudiante_id', 'edicion_id', 'fecha_matricula', 'estado', 'observaciones'])]
class Matricula extends Model
{
    /** @use HasFactory<MatriculaFactory> */
    use HasFactory;

    protected $attributes = [
        'estado' => 'MATRICULADO',
    ];

    protected function casts(): array
    {
        return [
            'fecha_matricula' => 'date',
            'estado' => EstadoMatricula::class,
        ];
    }

    /**
     * Motivo del próximo movimiento (alta o cambio de estado) para el historial.
     * No es un atributo de la matrícula: se descarta al terminar cada guardado.
     */
    private ?string $motivoDelMovimiento = null;

    /**
     * Indica el motivo que se guardará en el historial con el próximo guardado.
     */
    public function conMotivo(?string $motivo): static
    {
        $this->motivoDelMovimiento = HistorialMatriculas::normalizarMotivo($motivo);

        return $this;
    }

    public function save(array $options = [])
    {
        try {
            return DisponibilidadAcademica::guardar(
                $this,
                $this->exists ? $this->getRawOriginal('edicion_id') : $this->edicion_id,
                fn (): bool => parent::save($options),
            );
        } finally {
            // Un motivo nunca se reutiliza en otro guardado, aunque este falle.
            $this->motivoDelMovimiento = null;
        }
    }

    protected static function booted(): void
    {
        static::saving(function (Matricula $matricula): void {
            $matricula->observaciones = $matricula->observaciones === null ? null : (trim($matricula->observaciones) ?: null);
            $matricula->validarReglas();
        });

        // created/updated se ejecutan dentro de la transacción de DisponibilidadAcademica,
        // después del INSERT/UPDATE: el historial se confirma o se revierte con la matrícula.
        static::created(function (Matricula $matricula): void {
            HistorialMatriculas::registrarCreacion($matricula, $matricula->motivoDelMovimiento);
        });

        static::updated(function (Matricula $matricula): void {
            if ($matricula->wasChanged('estado')) {
                HistorialMatriculas::registrarCambioDeEstado(
                    $matricula,
                    EstadoMatricula::from($matricula->getRawOriginal('estado')),
                    $matricula->motivoDelMovimiento,
                );
            }
        });

        static::deleting(function (): void {
            throw new RegistroProtegidoException(
                'Las matrículas no se eliminan porque forman parte del historial académico. Cambie su estado a «Anulado».'
            );
        });
    }

    /**
     * @return BelongsTo<Estudiante, $this>
     */
    public function estudiante(): BelongsTo
    {
        return $this->belongsTo(Estudiante::class);
    }

    /**
     * @return BelongsTo<Edicion, $this>
     */
    public function edicion(): BelongsTo
    {
        return $this->belongsTo(Edicion::class);
    }

    /**
     * Historial de movimientos (alta y cambios de estado), de solo lectura.
     *
     * @return HasMany<MatriculaMovimiento, $this>
     */
    public function movimientos(): HasMany
    {
        return $this->hasMany(MatriculaMovimiento::class);
    }

    /**
     * Estados que se pueden elegir desde el estado actual (incluido el actual).
     *
     * @return list<EstadoMatricula>
     */
    public function estadosDisponibles(): array
    {
        if (! $this->exists) {
            return [EstadoMatricula::Matriculado];
        }

        $actual = $this->getOriginal('estado');
        $actual = $actual instanceof EstadoMatricula ? $actual : EstadoMatricula::from($actual);

        return [$actual, ...$actual->transicionesPermitidas()];
    }

    /**
     * @throws ValidationException
     */
    private function validarReglas(): void
    {
        $estado = $this->estado ?? EstadoMatricula::Matriculado;
        $this->estado = $estado;

        if ($this->exists && ($this->isDirty('estudiante_id') || $this->isDirty('edicion_id'))) {
            throw ValidationException::withMessages([
                'edicion_id' => 'No se puede cambiar el estudiante ni la edición de una matrícula existente. Anúlela y registre una nueva.',
            ]);
        }

        if (! $this->exists) {
            if ($estado !== EstadoMatricula::Matriculado) {
                throw ValidationException::withMessages([
                    'estado' => 'Una matrícula nueva se registra como «Matriculado». Los demás estados se asignan después.',
                ]);
            }

            if (! Estudiante::query()->whereKey($this->estudiante_id)->exists()) {
                throw ValidationException::withMessages(['estudiante_id' => 'Seleccione un estudiante válido.']);
            }

            $motivo = self::motivoParaNoMatricular($this->estudiante_id, $this->edicion_id, bloquear: true);

            if ($motivo !== null) {
                throw ValidationException::withMessages(['edicion_id' => $motivo]);
            }

            HistorialMatriculas::validarMotivo($this->motivoDelMovimiento);
            HistorialMatriculas::exigirDisponible($this, 'edicion_id');

            return;
        }

        if ($this->isDirty('estado')) {
            $anterior = $this->getOriginal('estado');
            $anterior = $anterior instanceof EstadoMatricula ? $anterior : EstadoMatricula::from($anterior);

            if (! $anterior->puedeCambiarA($estado)) {
                throw ValidationException::withMessages([
                    'estado' => "No se puede pasar de «{$anterior->getLabel()}» a «{$estado->getLabel()}».",
                ]);
            }

            if ($estado->ocupaCupo() && ! $anterior->ocupaCupo()) {
                $edicion = $this->edicion()->lockForUpdate()->firstOrFail();

                if (! $edicion->estado->admiteMatriculas()) {
                    throw ValidationException::withMessages([
                        'estado' => 'La edición está cancelada y no admite matrículas.',
                    ]);
                }

                $this->validarCupo($edicion);
            }

            HistorialMatriculas::validarMotivo($this->motivoDelMovimiento);
            HistorialMatriculas::exigirDisponible($this, 'estado');
        }
    }

    /**
     * Motivo por el que no se puede registrar una matrícula nueva, o null si se puede.
     * Lo usan tanto el modelo (antes de guardar) como los formularios del panel.
     */
    public static function motivoParaNoMatricular(mixed $estudianteId, mixed $edicionId, bool $bloquear = false): ?string
    {
        $edicion = filled($edicionId) ? Edicion::query()
            ->when($bloquear, fn ($query) => $query->lockForUpdate())
            ->find($edicionId) : null;

        if (! $edicion) {
            return 'Seleccione una edición válida.';
        }

        if (! $edicion->estado->admiteMatriculas()) {
            return 'La edición está cancelada y no admite matrículas.';
        }

        if (filled($estudianteId) && static::query()
            ->where('estudiante_id', $estudianteId)
            ->where('edicion_id', $edicion->getKey())
            ->exists()) {
            return 'El estudiante ya está matriculado en esta edición.';
        }

        return self::motivoSinCupo($edicion);
    }

    private static function motivoSinCupo(Edicion $edicion, ?int $excluirMatriculaId = null): ?string
    {
        if ($edicion->cupo === null) {
            return null;
        }

        if ($edicion->matriculasQueOcupanCupo($excluirMatriculaId, bloquear: true) >= $edicion->cupo) {
            return "La edición alcanzó su cupo de {$edicion->cupo} estudiantes.";
        }

        return null;
    }

    /**
     * @throws ValidationException
     */
    private function validarCupo(Edicion $edicion): void
    {
        $motivo = self::motivoSinCupo($edicion, $this->getKey());

        if ($motivo !== null) {
            throw ValidationException::withMessages(['estado' => $motivo]);
        }
    }
}
