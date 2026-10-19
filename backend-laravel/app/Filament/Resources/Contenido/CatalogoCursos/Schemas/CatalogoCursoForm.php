<?php

namespace App\Filament\Resources\Contenido\CatalogoCursos\Schemas;

use App\Enums\Contenido\Modalidad;
use App\Enums\Contenido\TipoPrograma;
use App\Filament\Support\CamposContenido;
use Filament\Forms\Components\DatePicker;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Components\Utilities\Get;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;

class CatalogoCursoForm
{
    public static function configure(Schema $schema): Schema
    {
        $esCurso = fn (Get $get): bool => self::valor($get('tipo')) === TipoPrograma::Curso->value;

        return $schema
            ->components([
                Section::make('Ficha pública')
                    ->icon(Heroicon::OutlinedAcademicCap)
                    ->extraAttributes(['class' => 'horus-tono-azul'])
                    ->description('Lo que verá el público en Educación. Las ediciones y matrículas se gestionan en «Gestión académica».')
                    ->columns(2)
                    ->columnSpanFull()
                    ->schema([
                        CamposContenido::tituloConSlug(),
                        CamposContenido::slug(),
                        Select::make('tipo')
                            ->label('Tipo')
                            ->options(TipoPrograma::class)
                            ->default(TipoPrograma::Curso->value)
                            ->selectablePlaceholder(false)
                            ->required()
                            ->live(),
                        Select::make('modalidad')
                            ->label('Modalidad')
                            ->options(Modalidad::class)
                            ->placeholder('Por confirmar')
                            ->required($esCurso)
                            ->helperText(fn (Get $get): ?string => $esCurso($get) ? null : 'Opcional en capacitaciones.'),
                        TextInput::make('duracion')
                            ->label('Duración')
                            ->placeholder('Ej.: 40 horas')
                            ->maxLength(120)
                            ->required($esCurso),
                        TextInput::make('certificacion')
                            ->label('Certificación')
                            ->maxLength(150),
                        Textarea::make('descripcion')
                            ->label('Descripción')
                            ->required()
                            ->maxLength(20000)
                            ->rows(4)
                            ->columnSpanFull(),
                        Textarea::make('temario')
                            ->label('Temario')
                            ->maxLength(20000)
                            ->rows(4)
                            ->columnSpanFull(),
                    ]),
                Section::make('Presentación')
                    ->icon(Heroicon::OutlinedSwatch)
                    ->extraAttributes(['class' => 'horus-tono-turquesa'])
                    ->columns(['default' => 1, 'md' => 3])
                    ->columnSpanFull()
                    ->schema([
                        TextInput::make('area')->label('Área')->maxLength(80),
                        CamposContenido::icono(),
                        CamposContenido::color(),
                        DatePicker::make('fecha_inicio')->label('Fecha de inicio publicada'),
                        CamposContenido::orden(),
                        CamposContenido::imagen()->columnSpan(['md' => 3]),
                    ]),
                Section::make('Publicación')
                    ->icon(Heroicon::OutlinedGlobeAlt)
                    ->columns(2)
                    ->columnSpanFull()
                    ->schema([
                        CamposContenido::estado(),
                        Select::make('curso_id')
                            ->label('Curso académico relacionado')
                            ->helperText('Opcional. Enlaza la ficha con el curso interno sin copiar sus datos.')
                            ->relationship('curso', 'nombre')
                            ->searchable()
                            ->preload()
                            ->unique(ignoreRecord: true)
                            ->validationMessages(['unique' => 'Ese curso académico ya tiene una ficha pública.']),
                    ]),
            ]);
    }

    private static function valor(mixed $estado): ?string
    {
        return $estado instanceof TipoPrograma ? $estado->value : (is_string($estado) ? $estado : null);
    }
}
