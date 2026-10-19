<?php

namespace App\Models;

use App\Enums\EstadoEdicion;
use App\Enums\EstadoMatricula;
use App\Exceptions\RegistroProtegidoException;
use App\Support\DisponibilidadAcademica;
use Database\Factories\EdicionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Validation\ValidationException;

/**
 * Edición o convocatoria: una realización concreta de un curso.
 */
#[Fillable(['curso_id', 'nombre', 'fecha_inicio', 'fecha_fin', 'cupo', 'estado'])]
class Edicion extends Model
{
    /** @use HasFactory<EdicionFactory> */
    use HasFactory;

    protected $table = 'ediciones';

    protected $attributes = [
        'estado' => 'PLANIFICADA',
    ];

    protected function casts(): array
    {
        return [
            'fecha_inicio' => 'date',
            'fecha_fin' => 'date',
            'cupo' => 'integer',
            'estado' => EstadoEdicion::class,
        ];
    }

    public function save(array $options = [])
    {
        return DisponibilidadAcademica::guardar(
            $this,
            $this->exists ? $this->getKey() : null,
            fn (): bool => parent::save($options),
        );
    }

    protected static function booted(): void
    {
        static::saving(function (Edicion $edicion): void {
            $edicion->nombre = trim(preg_replace('/\s+/u', ' ', (string) $edicion->nombre) ?? '');
            $edicion->validarReglas();
        });

        static::deleting(function (Edicion $edicion): void {
            if ($edicion->matriculas()->exists()) {
                throw new RegistroProtegidoException(
                    'No se puede eliminar la edición porque tiene matrículas registradas. Puede marcarla como cancelada o finalizada.'
                );
            }
        });
    }

    /**
     * @return BelongsTo<Curso, $this>
     */
    public function curso(): BelongsTo
    {
        return $this->belongsTo(Curso::class);
    }

    /**
     * @return HasMany<Matricula, $this>
     */
    public function matriculas(): HasMany
    {
        return $this->hasMany(Matricula::class);
    }

    /**
     * @return BelongsToMany<Estudiante, $this>
     */
    public function estudiantes(): BelongsToMany
    {
        return $this->belongsToMany(Estudiante::class, 'matriculas')
            ->withPivot(['id', 'estado', 'fecha_matricula'])
            ->withTimestamps();
    }

    /**
     * «Curso — Edición», para identificarla sin ambigüedad en listas y selectores.
     */
    protected function etiqueta(): Attribute
    {
        return Attribute::get(fn (): string => ($this->curso?->nombre ?? 'Curso').' — '.$this->nombre);
    }

    public function matriculasQueOcupanCupo(?int $excluirMatriculaId = null, bool $bloquear = false): int
    {
        $consulta = $this->matriculas()
            ->whereIn('estado', array_map(fn (EstadoMatricula $e) => $e->value, EstadoMatricula::ocupanCupo()))
            ->when($excluirMatriculaId, fn ($q) => $q->whereKeyNot($excluirMatriculaId));

        // Lectura actual de InnoDB, incluso dentro de una transacción externa
        // REPEATABLE READ. COUNT(*) con FOR UPDATE no sustituye esta lectura.
        return $bloquear && $this->getConnection()->transactionLevel() > 0
            ? $consulta->lockForUpdate()->pluck('matriculas.id')->count()
            : $consulta->count();
    }

    public function cuposDisponibles(): ?int
    {
        return $this->cupo === null ? null : max(0, $this->cupo - $this->matriculasQueOcupanCupo());
    }

    /**
     * @throws ValidationException
     */
    private function validarReglas(): void
    {
        $errores = [];

        if ($this->nombre === '') {
            $errores['nombre'] = 'Ingrese el nombre o identificador de la edición.';
        }

        if ($this->fecha_inicio && $this->fecha_fin && $this->fecha_fin->lt($this->fecha_inicio)) {
            $errores['fecha_fin'] = 'La fecha de fin no puede ser anterior a la fecha de inicio.';
        }

        if ($this->cupo !== null && $this->cupo < 1) {
            $errores['cupo'] = 'El cupo debe ser al menos 1, o déjelo vacío si no hay límite.';
        }

        if ($this->exists) {
            if ($this->isDirty('curso_id') && $this->matriculas()->lockForUpdate()->first(['matriculas.id']) !== null) {
                $errores['curso_id'] = 'No se puede cambiar el curso de una edición que ya tiene matrículas.';
            }

            $vigentes = null;

            if ($this->cupo !== null && $this->isDirty('cupo')) {
                $vigentes = $this->matriculasQueOcupanCupo(bloquear: true);

                if ($this->cupo < $vigentes) {
                    $errores['cupo'] = "El cupo no puede ser menor que las {$vigentes} matrículas vigentes de esta edición.";
                }
            }

            if ($this->isDirty('estado') && $this->estado === EstadoEdicion::Cancelada) {
                $vigentes ??= $this->matriculasQueOcupanCupo(bloquear: true);

                if ($vigentes > 0) {
                    $errores['estado'] = "No se puede cancelar la edición mientras tenga {$vigentes} matrícula(s) vigente(s). Cambie antes su estado (por ejemplo, a «Anulado»).";
                }
            }
        }

        if ($errores !== []) {
            throw ValidationException::withMessages($errores);
        }
    }
}
