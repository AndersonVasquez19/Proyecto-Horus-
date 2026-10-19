<?php

namespace App\Models;

use App\Models\Concerns\ValidaContenidoPublico;
use App\Rules\ImagenPublica;
use App\Support\Contenido\OpcionesContenido;
use Database\Factories\GaleriaItemFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/** Fotografía de la galería pública. Solo se muestra cuando está activa. */
#[Fillable(['titulo', 'descripcion', 'categoria', 'imagen_url', 'orden', 'activo'])]
class GaleriaItem extends Model
{
    /** @use HasFactory<GaleriaItemFactory> */
    use HasFactory, ValidaContenidoPublico;

    protected $table = 'galeria_items';

    protected $attributes = [
        'categoria' => 'general',
        'orden' => 0,
        'activo' => false,
    ];

    protected function casts(): array
    {
        return [
            'activo' => 'boolean',
            'orden' => 'integer',
        ];
    }

    public function reglas(): array
    {
        return [
            'titulo' => ['required', 'string', 'max:150'],
            'descripcion' => ['nullable', 'string', 'max:20000'],
            'categoria' => ['required', 'string', 'max:50'],
            'imagen_url' => ['required', 'string', 'max:500', new ImagenPublica],
            'orden' => ['required', 'integer', 'min:0', 'max:'.OpcionesContenido::ORDEN_MAXIMO],
            'activo' => ['required', 'boolean'],
        ];
    }

    protected function camposDeTexto(): array
    {
        return ['obligatorios' => ['titulo', 'categoria', 'imagen_url'], 'opcionales' => ['descripcion']];
    }

    protected function etiquetasDeCampos(): array
    {
        return ['imagen_url' => 'imagen'];
    }

    /**
     * @param  Builder<GaleriaItem>  $query
     * @return Builder<GaleriaItem>
     */
    public function scopePublicados(Builder $query): Builder
    {
        return $query->where('activo', true);
    }
}
