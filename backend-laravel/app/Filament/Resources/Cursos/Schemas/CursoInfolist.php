<?php

namespace App\Filament\Resources\Cursos\Schemas;

use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Grid;
use Filament\Schemas\Components\Group;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Enums\FontWeight;
use Filament\Support\Enums\TextSize;
use Filament\Support\Icons\Heroicon;

class CursoInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                // Escritorio: datos a la izquierda (2/3) y registro a la derecha (1/3). Móvil: una columna.
                Grid::make(['default' => 1, 'lg' => 3])
                    ->columnSpanFull()
                    ->schema([
                        Group::make([
                            Section::make('Datos del curso')
                                ->icon(Heroicon::OutlinedBookOpen)
                                ->extraAttributes(['class' => 'horus-tono-azul'])
                                ->columns(['default' => 1, 'sm' => 2])
                                ->schema([
                                    TextEntry::make('nombre')
                                        ->label('Nombre')
                                        ->size(TextSize::Large)
                                        ->weight(FontWeight::Bold)
                                        ->columnSpanFull(),
                                    TextEntry::make('codigo')
                                        ->label('Código')
                                        ->badge()
                                        ->color('gray')
                                        ->extraAttributes(['class' => 'horus-insignia-simple'])
                                        ->placeholder('Sin código'),
                                    TextEntry::make('activo')
                                        ->label('Estado')
                                        ->badge()
                                        ->formatStateUsing(fn (bool $state): string => $state ? 'Activo' : 'Inactivo')
                                        ->color(fn (bool $state): string => $state ? 'success' : 'gray')
                                        ->helperText(fn (bool $state): ?string => $state ? null : 'Se conserva con su historial, pero no aparece al crear ediciones nuevas.'),
                                ]),
                            Section::make('Descripción')
                                ->icon(Heroicon::OutlinedDocumentText)
                                ->extraAttributes(['class' => 'horus-tono-gris'])
                                ->schema([
                                    TextEntry::make('descripcion')
                                        ->hiddenLabel()
                                        ->placeholder('Sin descripción registrada.'),
                                ]),
                        ])->columnSpan(['default' => 1, 'lg' => 2]),
                        Group::make([
                            Section::make('Registro')
                                ->icon(Heroicon::OutlinedClock)
                                ->extraAttributes(['class' => 'horus-tono-gris horus-seccion-secundaria'])
                                ->schema([
                                    TextEntry::make('created_at')
                                        ->label('Registrado')
                                        ->dateTime('d/m/Y H:i'),
                                    TextEntry::make('updated_at')
                                        ->label('Última modificación')
                                        ->dateTime('d/m/Y H:i'),
                                ]),
                        ])->columnSpan(['default' => 1, 'lg' => 1]),
                    ]),
            ]);
    }
}
