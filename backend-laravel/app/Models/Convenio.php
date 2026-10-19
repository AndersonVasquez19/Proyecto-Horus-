<?php

namespace App\Models;

use App\Models\Concerns\ValidaContenidoPublico;
use App\Rules\ImagenPublica;
use App\Support\Contenido\OpcionesContenido;
use Database\Factories\ConvenioFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Convenio institucional. Se crea oculto y solo aparece en la web cuando es visible.
 * Eliminarlo elimina sus fotos (registros), nunca los archivos de imagen.
 */
#[Fillable(['nombre', 'sigla', 'logo_url', 'descripcion_corta', 'descripcion_completa', 'informacion_adicional', 'orden', 'visible'])]
class Convenio extends Model
{
    /** @use HasFactory<ConvenioFactory> */
    use HasFactory, ValidaContenidoPublico;

    protected $attributes = [
        'orden' => 0,
        'visible' => false,
    ];

    protected function casts(): array
    {
        return [
            'visible' => 'boolean',
            'orden' => 'integer',
        ];
    }

    public function reglas(): array
    {
        return [
            'nombre' => ['required', 'string', 'max:160'],
            'sigla' => ['nullable', 'string', 'max:50'],
            'logo_url' => ['nullable', 'string', 'max:2048', new ImagenPublica],
            'descripcion_corta' => ['required', 'string', 'max:2000'],
            'descripcion_completa' => ['nullable', 'string', 'max:20000'],
            'informacion_adicional' => ['nullable', 'string', 'max:20000'],
            'orden' => ['required', 'integer', 'min:0', 'max:'.OpcionesContenido::ORDEN_MAXIMO],
            'visible' => ['required', 'boolean'],
        ];
    }

    protected function camposDeTexto(): array
    {
        return [
            'obligatorios' => ['nombre', 'descripcion_corta'],
            'opcionales' => ['sigla', 'logo_url', 'descripcion_completa', 'informacion_adicional'],
        ];
    }

    protected function etiquetasDeCampos(): array
    {
        return ['logo_url' => 'logo', 'descripcion_corta' => 'descripción corta'];
    }

    /**
     * @return HasMany<ConvenioFoto, $this>
     */
    public function fotos(): HasMany
    {
        return $this->hasMany(ConvenioFoto::class)->orderBy('orden')->orderBy('id');
    }

    /**
     * @param  Builder<Convenio>  $query
     * @return Builder<Convenio>
     */
    public function scopePublicados(Builder $query): Builder
    {
        return $query->where('visible', true);
    }
}
