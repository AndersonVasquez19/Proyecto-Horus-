<?php

namespace App\Filament\Resources\Contenido\CatalogoServicios\Schemas;

use App\Enums\Contenido\CategoriaServicio;
use App\Filament\Support\CamposContenido;
use App\Support\Contenido\OpcionesContenido;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;

class CatalogoServicioForm
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Servicio')
                    ->icon(Heroicon::OutlinedWrenchScrewdriver)
                    ->extraAttributes(['class' => 'horus-tono-azul'])
                    ->columns(2)
                    ->columnSpanFull()
                    ->schema([
                        CamposContenido::tituloConSlug(),
                        CamposContenido::slug(),
                        Select::make('categoria')
                            ->label('Categoría')
                            ->options(CategoriaServicio::class)
                            ->required(),
                        TextInput::make('nombre_corto')->label('Nombre corto')->maxLength(80),
                        Textarea::make('descripcion')->label('Descripción')->required()->maxLength(20000)->rows(4)->columnSpanFull(),
                        Textarea::make('alcance')->label('Alcance')->maxLength(20000)->rows(3)->columnSpanFull(),
                    ]),
                Section::make('Presentación en la tarjeta')
                    ->icon(Heroicon::OutlinedSwatch)
                    ->extraAttributes(['class' => 'horus-tono-turquesa'])
                    ->columns(['default' => 1, 'md' => 3])
                    ->columnSpanFull()
                    ->schema([
                        Select::make('presentacion')
                            ->label('Presentación')
                            ->options(OpcionesContenido::etiquetas(OpcionesContenido::PRESENTACIONES))
                            ->default('normal')
                            ->selectablePlaceholder(false)
                            ->required(),
                        CamposContenido::icono(),
                        CamposContenido::color(),
                        TextInput::make('destacado')->label('Texto destacado')->maxLength(100),
                        TextInput::make('dato_principal')->label('Dato principal')->maxLength(40),
                        TextInput::make('dato_secundario')->label('Dato secundario')->maxLength(100),
                        Textarea::make('etiquetas')->label('Etiquetas')->helperText('Separadas por comas.')->maxLength(2000)->rows(2)->columnSpan(['md' => 2]),
                        CamposContenido::orden(),
                        CamposContenido::imagen()->columnSpan(['md' => 3]),
                    ]),
                Section::make('Publicación')
                    ->icon(Heroicon::OutlinedGlobeAlt)
                    ->columnSpanFull()
                    ->schema([CamposContenido::estado()]),
            ]);
    }
}
