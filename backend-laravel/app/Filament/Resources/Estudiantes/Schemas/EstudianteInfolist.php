<?php

namespace App\Filament\Resources\Estudiantes\Schemas;

use App\Models\Estudiante;
use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Grid;
use Filament\Schemas\Components\Group;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Enums\FontWeight;
use Filament\Support\Enums\TextSize;
use Filament\Support\Icons\Heroicon;

class EstudianteInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                Section::make('Posibles coincidencias por nombre')
                    ->icon(Heroicon::OutlinedExclamationTriangle)
                    ->extraAttributes(['class' => 'horus-seccion-aviso'])
                    ->visible(fn (Estudiante $record): bool => self::coincidencias($record) !== null)
                    ->columnSpanFull()
                    ->schema([
                        TextEntry::make('posibles_coincidencias')
                            ->hiddenLabel()
                            ->state(fn (Estudiante $record): ?string => self::coincidencias($record))
                            ->color('warning'),
                    ]),
                // Escritorio: datos a la izquierda (2/3) y registro a la derecha (1/3). Móvil: una columna.
                Grid::make(['default' => 1, 'lg' => 3])
                    ->columnSpanFull()
                    ->schema([
                        Group::make([
                            Section::make('Identificación')
                                ->icon(Heroicon::OutlinedIdentification)
                                ->extraAttributes(['class' => 'horus-tono-azul'])
                                ->columns(['default' => 1, 'sm' => 2])
                                ->schema([
                                    TextEntry::make('nombre_completo')
                                        ->label('Apellidos y nombres')
                                        ->size(TextSize::Large)
                                        ->weight(FontWeight::Bold)
                                        ->columnSpanFull(),
                                    TextEntry::make('documento')
                                        ->label('Documento')
                                        ->weight(FontWeight::SemiBold),
                                ]),
                            Section::make('Contacto')
                                ->icon(Heroicon::OutlinedPhone)
                                ->extraAttributes(['class' => 'horus-tono-turquesa'])
                                ->columns(['default' => 1, 'sm' => 2])
                                ->schema([
                                    TextEntry::make('telefono')
                                        ->label('Teléfono')
                                        ->icon(Heroicon::OutlinedPhone)
                                        ->placeholder('Sin teléfono registrado'),
                                    TextEntry::make('email')
                                        ->label('Correo electrónico')
                                        ->icon(Heroicon::OutlinedEnvelope)
                                        ->placeholder('Sin correo registrado'),
                                ]),
                            Section::make('Observaciones')
                                ->icon(Heroicon::OutlinedChatBubbleBottomCenterText)
                                ->extraAttributes(['class' => 'horus-tono-gris'])
                                ->schema([
                                    TextEntry::make('observaciones')
                                        ->hiddenLabel()
                                        ->placeholder('Sin observaciones.'),
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

    private static function coincidencias(Estudiante $record): ?string
    {
        $otros = $record->posiblesCoincidencias()->limit(5)->get();

        if ($otros->isEmpty()) {
            return null;
        }

        return 'Revise si es la misma persona: '
            .$otros->map(fn (Estudiante $e): string => $e->nombre_completo.' ('.$e->documento.')')->implode('; ')
            .'. No se fusionan registros automáticamente.';
    }
}
