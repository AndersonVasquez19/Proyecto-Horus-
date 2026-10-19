<?php

namespace App\Filament\Resources\Ediciones\Schemas;

use App\Models\Edicion;
use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Grid;
use Filament\Schemas\Components\Group;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Enums\FontWeight;
use Filament\Support\Enums\TextSize;
use Filament\Support\Icons\Heroicon;

class EdicionInfolist
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
                            Section::make('Datos de la edición')
                                ->icon(Heroicon::OutlinedRectangleStack)
                                ->extraAttributes(['class' => 'horus-tono-azul'])
                                ->columns(['default' => 1, 'sm' => 2])
                                ->schema([
                                    TextEntry::make('curso.nombre')
                                        ->label('Curso')
                                        ->size(TextSize::Large)
                                        ->weight(FontWeight::Bold)
                                        ->columnSpanFull(),
                                    TextEntry::make('nombre')
                                        ->label('Edición')
                                        ->weight(FontWeight::SemiBold),
                                    TextEntry::make('estado')
                                        ->label('Estado')
                                        ->badge(),
                                ]),
                            Section::make('Fechas y cupo')
                                ->icon(Heroicon::OutlinedCalendarDays)
                                ->extraAttributes(['class' => 'horus-tono-turquesa'])
                                ->columns(['default' => 1, 'sm' => 2])
                                ->schema([
                                    TextEntry::make('fecha_inicio')
                                        ->label('Fecha de inicio')
                                        ->date('d/m/Y')
                                        ->placeholder('Sin fecha registrada'),
                                    TextEntry::make('fecha_fin')
                                        ->label('Fecha de fin')
                                        ->date('d/m/Y')
                                        ->placeholder('Sin fecha registrada'),
                                    TextEntry::make('cupo')
                                        ->label('Cupo')
                                        ->state(fn (Edicion $record): string => $record->cupo === null
                                            ? 'Sin límite'
                                            : ($record->cupo === 1 ? '1 plaza' : "{$record->cupo} plazas"))
                                        ->weight(FontWeight::SemiBold),
                                    TextEntry::make('plazas_disponibles')
                                        ->label('Plazas disponibles')
                                        ->state(fn (Edicion $record): ?int => $record->cuposDisponibles())
                                        ->formatStateUsing(fn (int $state): string => $state === 1 ? '1 disponible' : "{$state} disponibles")
                                        ->badge()
                                        ->color(fn (int $state): string => $state > 0 ? 'success' : 'danger')
                                        ->visible(fn (Edicion $record): bool => $record->cupo !== null),
                                ]),
                        ])->columnSpan(['default' => 1, 'lg' => 2]),
                        Group::make([
                            Section::make('Registro')
                                ->icon(Heroicon::OutlinedClock)
                                ->extraAttributes(['class' => 'horus-tono-gris horus-seccion-secundaria'])
                                ->schema([
                                    TextEntry::make('created_at')
                                        ->label('Registrada')
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
