<?php

namespace App\Filament\Support;

use App\Enums\Contenido\EstadoPublicacion;
use App\Rules\ImagenPublica;
use App\Support\Contenido\OpcionesContenido;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\TextInput;
use Filament\Schemas\Components\Utilities\Set;
use Illuminate\Support\Str;

/**
 * Campos de formulario compartidos por los recursos de contenido público.
 * Las reglas repiten las del modelo para avisar en el campo; el modelo vuelve
 * a validarlas al guardar.
 */
final class CamposContenido
{
    /** Título que propone el slug al crear (no lo cambia al editar: rompería enlaces). */
    public static function tituloConSlug(string $campo = 'titulo', int $longitud = 160): TextInput
    {
        return TextInput::make($campo)
            ->label('Título')
            ->required()
            ->maxLength($longitud)
            ->live(onBlur: true)
            ->afterStateUpdated(function (Set $set, ?string $state, string $operation): void {
                if ($operation === 'create') {
                    $set('slug', Str::slug((string) $state));
                }
            });
    }

    public static function slug(): TextInput
    {
        return TextInput::make('slug')
            ->label('Identificador en la dirección (slug)')
            ->helperText('Minúsculas, números y guiones. Cambiarlo rompe los enlaces ya compartidos.')
            ->required()
            ->maxLength(180)
            ->regex(OpcionesContenido::PATRON_SLUG)
            ->unique(ignoreRecord: true)
            ->validationMessages([
                'regex' => 'Use solo minúsculas, números y guiones (por ejemplo «excel-avanzado»).',
                'unique' => 'Ya existe otro registro con este identificador.',
            ]);
    }

    public static function imagen(string $campo = 'imagen_url', string $etiqueta = 'Imagen', int $longitud = 2048, bool $obligatoria = false): TextInput
    {
        return TextInput::make($campo)
            ->label($etiqueta)
            ->helperText('URL http(s) o ruta del sitio, p. ej. /api/uploads/… (las imágenes se suben hoy desde el panel anterior).')
            ->required($obligatoria)
            ->maxLength($longitud)
            ->rule(new ImagenPublica);
    }

    public static function orden(): TextInput
    {
        return TextInput::make('orden')
            ->label('Orden')
            ->helperText('Los números menores aparecen primero.')
            ->integer()
            ->minValue(0)
            ->maxValue(OpcionesContenido::ORDEN_MAXIMO)
            ->default(0)
            ->required();
    }

    public static function color(): Select
    {
        return Select::make('color')
            ->label('Color de la tarjeta')
            ->options(OpcionesContenido::etiquetas(OpcionesContenido::COLORES))
            ->default('indigo')
            ->selectablePlaceholder(false)
            ->required();
    }

    public static function icono(): Select
    {
        return Select::make('icono')
            ->label('Icono')
            ->options(OpcionesContenido::etiquetas(OpcionesContenido::ICONOS))
            ->placeholder('Sin icono');
    }

    public static function estado(): Select
    {
        return Select::make('estado')
            ->label('Estado')
            ->options(EstadoPublicacion::class)
            ->default(EstadoPublicacion::Borrador->value)
            ->helperText('Solo el contenido «Publicado» aparece en la web.')
            ->selectablePlaceholder(false)
            ->required();
    }
}
