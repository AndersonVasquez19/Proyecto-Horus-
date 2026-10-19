<?php

namespace App\Filament\Resources\Cursos\Schemas;

use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Toggle;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Icons\Heroicon;

class CursoForm
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Datos del curso')
                    ->icon(Heroicon::OutlinedBookOpen)
                    ->extraAttributes(['class' => 'horus-tono-azul'])
                    ->description('El curso es el concepto general (p. ej. «Primeros Auxilios»). Cada vez que se dicta se registra como una edición.')
                    ->columns(2)
                    ->columnSpanFull()
                    ->schema([
                        TextInput::make('nombre')
                            ->label('Nombre')
                            ->required()
                            ->maxLength(150)
                            ->unique(ignoreRecord: true)
                            ->validationMessages(['unique' => 'Ya existe un curso con este nombre.']),
                        TextInput::make('codigo')
                            ->label('Código')
                            ->helperText('Opcional.')
                            ->maxLength(30)
                            ->unique(ignoreRecord: true)
                            ->validationMessages(['unique' => 'Ya existe un curso con este código.']),
                        Textarea::make('descripcion')
                            ->label('Descripción')
                            ->rows(3)
                            ->columnSpanFull(),
                        Toggle::make('activo')
                            ->label('Curso activo')
                            ->helperText('Los cursos inactivos se conservan con su historial, pero no aparecen al crear ediciones nuevas.')
                            ->default(true),
                    ]),
            ]);
    }
}
