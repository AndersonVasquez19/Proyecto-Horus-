<?php

namespace App\Filament\Resources\Matriculas\Schemas;

use App\Enums\EstadoMatricula;
use App\Filament\Resources\Ediciones\EdicionResource;
use App\Filament\Resources\Estudiantes\EstudianteResource;
use App\Models\Matricula;
use Filament\Infolists\Components\TextEntry;
use Filament\Schemas\Components\Grid;
use Filament\Schemas\Components\Group;
use Filament\Schemas\Components\Section;
use Filament\Schemas\Schema;
use Filament\Support\Enums\FontWeight;
use Filament\Support\Enums\TextSize;
use Filament\Support\Icons\Heroicon;

class MatriculaInfolist
{
    public static function configure(Schema $schema): Schema
    {
        return $schema
            ->components([
                // Escritorio: datos a la izquierda (2/3); estado y registro a la derecha (1/3). Móvil: una columna.
                Grid::make(['default' => 1, 'lg' => 3])
                    ->columnSpanFull()
                    ->schema([
                        Group::make([
                            Section::make('Estudiante')
                                ->icon(Heroicon::OutlinedUser)
                                ->extraAttributes(['class' => 'horus-tono-azul'])
                                ->columns(['default' => 1, 'sm' => 2])
                                ->schema([
                                    TextEntry::make('estudiante.nombre_completo')
                                        ->label('Apellidos y nombres')
                                        ->size(TextSize::Large)
                                        ->weight(FontWeight::Bold)
                                        ->url(fn (Matricula $record): string => EstudianteResource::getUrl('view', ['record' => $record->estudiante_id]))
                                        ->columnSpanFull(),
                                    TextEntry::make('estudiante.documento')
                                        ->label('Documento')
                                        ->weight(FontWeight::SemiBold),
                                ]),
                            Section::make('Curso y edición')
                                ->icon(Heroicon::OutlinedAcademicCap)
                                ->extraAttributes(['class' => 'horus-tono-turquesa'])
                                ->columns(['default' => 1, 'sm' => 2])
                                ->schema([
                                    TextEntry::make('edicion.curso.nombre')
                                        ->label('Curso')
                                        ->weight(FontWeight::SemiBold),
                                    TextEntry::make('edicion.nombre')
                                        ->label('Edición')
                                        ->weight(FontWeight::SemiBold)
                                        ->url(fn (Matricula $record): string => EdicionResource::getUrl('view', ['record' => $record->edicion_id])),
                                    TextEntry::make('fecha_matricula')
                                        ->label('Fecha de matrícula')
                                        ->date('d/m/Y')
                                        ->placeholder('Sin fecha registrada'),
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
                            Section::make('Estado de la matrícula')
                                ->icon(Heroicon::OutlinedFlag)
                                ->extraAttributes(['class' => 'horus-tono-coral horus-estado-destacado'])
                                ->schema([
                                    TextEntry::make('estado')
                                        ->label('Estado')
                                        ->hiddenLabel()
                                        ->badge()
                                        ->helperText(fn (Matricula $record): string => $record->estado instanceof EstadoMatricula ? $record->estado->getDescription() : ''),
                                ]),
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
