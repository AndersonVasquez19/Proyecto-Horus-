<?php

namespace App\Models;

use App\Exceptions\RegistroProtegidoException;
use Database\Factories\CursoFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasManyThrough;
use Illuminate\Support\Str;

/**
 * Curso como concepto general (p. ej. «Primeros Auxilios»).
 * Cada realización concreta es una {@see Edicion}.
 */
#[Fillable(['nombre', 'codigo', 'descripcion', 'activo'])]
class Curso extends Model
{
    /** @use HasFactory<CursoFactory> */
    use HasFactory;

    protected $attributes = [
        'activo' => true,
    ];

    protected function casts(): array
    {
        return [
            'activo' => 'boolean',
        ];
    }

    protected static function booted(): void
    {
        static::saving(function (Curso $curso): void {
            $curso->nombre = trim(preg_replace('/\s+/u', ' ', (string) $curso->nombre) ?? '');
            $codigo = $curso->codigo === null ? '' : Str::upper(trim($curso->codigo));
            $curso->codigo = $codigo === '' ? null : $codigo;
            $curso->descripcion = $curso->descripcion === null ? null : (trim($curso->descripcion) ?: null);
        });

        static::deleting(function (Curso $curso): void {
            if ($curso->ediciones()->exists()) {
                throw new RegistroProtegidoException(
                    'No se puede eliminar el curso porque tiene ediciones registradas. Puede marcarlo como inactivo.'
                );
            }
        });
    }

    /**
     * @return HasMany<Edicion, $this>
     */
    public function ediciones(): HasMany
    {
        return $this->hasMany(Edicion::class);
    }

    /**
     * @return HasManyThrough<Matricula, Edicion, $this>
     */
    public function matriculas(): HasManyThrough
    {
        return $this->hasManyThrough(Matricula::class, Edicion::class);
    }

    /**
     * @param  Builder<Curso>  $query
     * @return Builder<Curso>
     */
    public function scopeActivos(Builder $query): Builder
    {
        return $query->where('activo', true);
    }
}
