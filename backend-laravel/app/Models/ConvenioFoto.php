<?php

namespace App\Models;

use App\Models\Concerns\ValidaContenidoPublico;
use App\Rules\ImagenPublica;
use App\Support\Contenido\OpcionesContenido;
use Database\Factories\ConvenioFotoFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Validation\Rule;

/** Fotografía de un convenio, independiente de la galería. */
#[Fillable(['convenio_id', 'imagen_url', 'orden'])]
class ConvenioFoto extends Model
{
    /** @use HasFactory<ConvenioFotoFactory> */
    use HasFactory, ValidaContenidoPublico;

    protected $table = 'convenio_fotos';

    protected $attributes = [
        'orden' => 0,
    ];

    protected function casts(): array
    {
        return ['orden' => 'integer'];
    }

    public function reglas(): array
    {
        return [
            'convenio_id' => ['required', 'integer', Rule::exists('convenios', 'id')],
            'imagen_url' => ['required', 'string', 'max:2048', new ImagenPublica],
            'orden' => ['required', 'integer', 'min:0', 'max:'.OpcionesContenido::ORDEN_MAXIMO],
        ];
    }

    protected function camposDeTexto(): array
    {
        return ['obligatorios' => ['imagen_url'], 'opcionales' => []];
    }

    protected function etiquetasDeCampos(): array
    {
        return ['imagen_url' => 'imagen'];
    }

    /**
     * @return BelongsTo<Convenio, $this>
     */
    public function convenio(): BelongsTo
    {
        return $this->belongsTo(Convenio::class);
    }
}
