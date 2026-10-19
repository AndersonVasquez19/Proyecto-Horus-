<?php

namespace App\Models;

use App\Enums\Contenido\CategoriaServicio;
use App\Enums\Contenido\EstadoPublicacion;
use App\Models\Concerns\ValidaContenidoPublico;
use App\Rules\ImagenPublica;
use App\Support\Contenido\OpcionesContenido;
use Database\Factories\CatalogoServicioFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Validation\Rule;

/**
 * Servicio tecnológico publicado en la web. Por decisión del proyecto, los
 * servicios sí pueden eliminarse definitivamente (además de archivarse).
 */
#[Fillable([
    'titulo', 'slug', 'descripcion', 'categoria', 'presentacion', 'nombre_corto', 'destacado', 'dato_principal',
    'dato_secundario', 'etiquetas', 'icono', 'color', 'orden', 'alcance', 'imagen_url', 'estado',
])]
class CatalogoServicio extends Model
{
    /** @use HasFactory<CatalogoServicioFactory> */
    use HasFactory, ValidaContenidoPublico;

    protected $table = 'catalogo_servicios';

    protected $attributes = [
        'estado' => 'borrador',
        'presentacion' => 'normal',
        'color' => 'indigo',
        'orden' => 0,
    ];

    protected function casts(): array
    {
        return [
            'categoria' => CategoriaServicio::class,
            'estado' => EstadoPublicacion::class,
            'orden' => 'integer',
        ];
    }

    public function reglas(): array
    {
        return [
            'titulo' => ['required', 'string', 'max:160'],
            'slug' => ['required', 'string', 'max:180', 'regex:'.OpcionesContenido::PATRON_SLUG],
            'descripcion' => ['required', 'string', 'max:20000'],
            'categoria' => ['required', Rule::enum(CategoriaServicio::class)],
            'presentacion' => ['required', Rule::in(OpcionesContenido::PRESENTACIONES)],
            'nombre_corto' => ['nullable', 'string', 'max:80'],
            'destacado' => ['nullable', 'string', 'max:100'],
            'dato_principal' => ['nullable', 'string', 'max:40'],
            'dato_secundario' => ['nullable', 'string', 'max:100'],
            'etiquetas' => ['nullable', 'string', 'max:2000'],
            'icono' => ['nullable', Rule::in(OpcionesContenido::ICONOS)],
            'color' => ['required', Rule::in(OpcionesContenido::COLORES)],
            'orden' => ['required', 'integer', 'min:0', 'max:'.OpcionesContenido::ORDEN_MAXIMO],
            'alcance' => ['nullable', 'string', 'max:20000'],
            'imagen_url' => ['nullable', 'string', 'max:2048', new ImagenPublica],
            'estado' => ['required', Rule::enum(EstadoPublicacion::class)],
        ];
    }

    protected function camposDeTexto(): array
    {
        return [
            'obligatorios' => ['titulo', 'slug', 'descripcion'],
            'opcionales' => ['nombre_corto', 'destacado', 'dato_principal', 'dato_secundario', 'etiquetas', 'alcance', 'imagen_url', 'icono'],
        ];
    }

    protected function mensajesDeUnicidad(): array
    {
        return ['slug' => 'Ya existe otro servicio con este identificador (slug).'];
    }

    protected function etiquetasDeCampos(): array
    {
        return ['imagen_url' => 'imagen'];
    }

    /**
     * @param  Builder<CatalogoServicio>  $query
     * @return Builder<CatalogoServicio>
     */
    public function scopePublicados(Builder $query): Builder
    {
        return $query->where('estado', EstadoPublicacion::Publicado->value);
    }
}
