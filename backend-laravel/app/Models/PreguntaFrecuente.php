<?php

namespace App\Models;

use App\Enums\Contenido\EstadoPublicacion;
use App\Exceptions\RegistroProtegidoException;
use App\Models\Concerns\ValidaContenidoPublico;
use App\Support\Contenido\OpcionesContenido;
use Database\Factories\PreguntaFrecuenteFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Validation\Rule;

/** Pregunta frecuente pública. Como en NestJS, se archiva y no se elimina. */
#[Fillable(['pregunta', 'respuesta', 'categoria', 'orden', 'estado'])]
class PreguntaFrecuente extends Model
{
    /** @use HasFactory<PreguntaFrecuenteFactory> */
    use HasFactory, ValidaContenidoPublico;

    protected $table = 'preguntas_frecuentes';

    protected $attributes = [
        'estado' => 'borrador',
        'orden' => 0,
    ];

    protected function casts(): array
    {
        return [
            'estado' => EstadoPublicacion::class,
            'orden' => 'integer',
        ];
    }

    protected static function booted(): void
    {
        static::deleting(function (): void {
            throw new RegistroProtegidoException('Las preguntas frecuentes se conservan. Para retirarlas de la web, archívelas.');
        });
    }

    public function reglas(): array
    {
        return [
            'pregunta' => ['required', 'string', 'max:300'],
            'respuesta' => ['required', 'string', 'max:12000'],
            'categoria' => ['required', 'string', 'max:100'],
            'orden' => ['required', 'integer', 'min:0', 'max:'.OpcionesContenido::ORDEN_MAXIMO],
            'estado' => ['required', Rule::enum(EstadoPublicacion::class)],
        ];
    }

    protected function camposDeTexto(): array
    {
        return ['obligatorios' => ['pregunta', 'respuesta', 'categoria'], 'opcionales' => []];
    }

    /**
     * @param  Builder<PreguntaFrecuente>  $query
     * @return Builder<PreguntaFrecuente>
     */
    public function scopePublicados(Builder $query): Builder
    {
        return $query->where('estado', EstadoPublicacion::Publicado->value);
    }
}
