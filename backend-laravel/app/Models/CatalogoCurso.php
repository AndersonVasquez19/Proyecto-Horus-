<?php

namespace App\Models;

use App\Enums\Contenido\EstadoPublicacion;
use App\Enums\Contenido\Modalidad;
use App\Enums\Contenido\TipoPrograma;
use App\Exceptions\RegistroProtegidoException;
use App\Models\Concerns\ValidaContenidoPublico;
use App\Rules\ImagenPublica;
use App\Support\Contenido\OpcionesContenido;
use Database\Factories\CatalogoCursoFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Validation\Rule;

/**
 * Ficha pública de un curso o capacitación (catálogo de Educación de la web).
 *
 * No es el curso académico: este se gestiona en Curso/Edicion/Matricula. La ficha
 * puede enlazarlo con curso_id para no duplicar su información interna.
 * Se conserva siempre (como en NestJS): para retirarla se archiva.
 */
#[Fillable([
    'curso_id', 'titulo', 'slug', 'descripcion', 'tipo', 'modalidad', 'duracion', 'area', 'certificacion',
    'icono', 'color', 'orden', 'temario', 'imagen_url', 'fecha_inicio', 'estado',
])]
class CatalogoCurso extends Model
{
    /** @use HasFactory<CatalogoCursoFactory> */
    use HasFactory, ValidaContenidoPublico;

    protected $table = 'catalogo_cursos';

    protected $attributes = [
        'estado' => 'borrador',
        'color' => 'indigo',
        'orden' => 0,
    ];

    protected function casts(): array
    {
        return [
            'tipo' => TipoPrograma::class,
            'modalidad' => Modalidad::class,
            'estado' => EstadoPublicacion::class,
            'fecha_inicio' => 'date',
            'orden' => 'integer',
        ];
    }

    protected static function booted(): void
    {
        static::deleting(function (): void {
            throw new RegistroProtegidoException('Los cursos y capacitaciones publicados se conservan. Para retirarlos de la web, archívelos.');
        });
    }

    public function reglas(): array
    {
        return [
            'curso_id' => ['nullable', 'integer', Rule::exists('cursos', 'id')],
            'titulo' => ['required', 'string', 'max:160'],
            'slug' => ['required', 'string', 'max:180', 'regex:'.OpcionesContenido::PATRON_SLUG],
            'descripcion' => ['required', 'string', 'max:20000'],
            'tipo' => ['required', Rule::enum(TipoPrograma::class)],
            'modalidad' => ['nullable', Rule::enum(Modalidad::class), 'required_if:tipo,curso'],
            'duracion' => ['nullable', 'string', 'max:120', 'required_if:tipo,curso'],
            'area' => ['nullable', 'string', 'max:80'],
            'certificacion' => ['nullable', 'string', 'max:150'],
            'icono' => ['nullable', Rule::in(OpcionesContenido::ICONOS)],
            'color' => ['required', Rule::in(OpcionesContenido::COLORES)],
            'orden' => ['required', 'integer', 'min:0', 'max:'.OpcionesContenido::ORDEN_MAXIMO],
            'temario' => ['nullable', 'string', 'max:20000'],
            'imagen_url' => ['nullable', 'string', 'max:2048', new ImagenPublica],
            'fecha_inicio' => ['nullable', 'date'],
            'estado' => ['required', Rule::enum(EstadoPublicacion::class)],
        ];
    }

    protected function camposDeTexto(): array
    {
        return [
            'obligatorios' => ['titulo', 'slug', 'descripcion'],
            'opcionales' => ['duracion', 'area', 'certificacion', 'temario', 'imagen_url', 'icono', 'modalidad'],
        ];
    }

    protected function mensajesDeUnicidad(): array
    {
        return [
            'slug' => 'Ya existe otra ficha con este identificador (slug).',
            'curso_id' => 'Ese curso académico ya tiene una ficha pública.',
        ];
    }

    protected function etiquetasDeCampos(): array
    {
        return ['duracion' => 'duración', 'tipo' => 'tipo', 'imagen_url' => 'imagen', 'curso_id' => 'curso académico'];
    }

    /**
     * @return BelongsTo<Curso, $this>
     */
    public function curso(): BelongsTo
    {
        return $this->belongsTo(Curso::class);
    }

    /**
     * @param  Builder<CatalogoCurso>  $query
     * @return Builder<CatalogoCurso>
     */
    public function scopePublicados(Builder $query): Builder
    {
        return $query->where('estado', EstadoPublicacion::Publicado->value);
    }
}
