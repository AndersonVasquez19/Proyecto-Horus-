<?php

namespace App\Filament\Resources\Cursos\RelationManagers;

use App\Enums\EstadoEdicion;
use App\Filament\Resources\Ediciones\EdicionResource;
use App\Models\Edicion;
use Filament\Actions\Action;
use Filament\Resources\RelationManagers\RelationManager;
use Filament\Support\Icons\Heroicon;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

/**
 * Ediciones del curso. Se crean y editan en el módulo «Ediciones».
 */
class EdicionesRelationManager extends RelationManager
{
    protected static string $relationship = 'ediciones';

    protected static ?string $title = 'Ediciones del curso';

    protected static ?string $modelLabel = 'edición';

    protected static ?string $pluralModelLabel = 'ediciones';

    public function isReadOnly(): bool
    {
        return false;
    }

    public function table(Table $table): Table
    {
        return $table
            ->defaultSort('fecha_inicio', 'desc')
            ->columns([
                TextColumn::make('nombre')
                    ->label('Edición')
                    ->weight('medium'),
                TextColumn::make('fecha_inicio')
                    ->label('Inicio')
                    ->date('d/m/Y')
                    ->placeholder('Sin fecha'),
                TextColumn::make('fecha_fin')
                    ->label('Fin')
                    ->date('d/m/Y')
                    ->placeholder('Sin fecha'),
                TextColumn::make('matriculas_count')
                    ->label('Matrículas')
                    ->counts('matriculas')
                    ->alignCenter(),
                TextColumn::make('estado')
                    ->label('Estado')
                    ->badge(),
            ])
            ->filters([
                SelectFilter::make('estado')
                    ->label('Estado')
                    ->options(EstadoEdicion::class),
            ])
            ->headerActions([
                Action::make('nuevaEdicion')
                    ->authorize(fn (): bool => EdicionResource::canCreate())
                    ->label('Nueva edición')
                    ->icon(Heroicon::OutlinedPlus)
                    ->url(fn (): string => EdicionResource::getUrl('create', ['curso_id' => $this->getOwnerRecord()->getKey()])),
            ])
            ->recordActions([
                Action::make('abrir')
                    ->authorize('view')
                    ->label('Abrir')
                    ->icon(Heroicon::OutlinedEye)
                    ->color('gray')
                    ->url(fn (Edicion $record): string => EdicionResource::getUrl('view', ['record' => $record])),
            ])
            ->emptyStateHeading('Este curso aún no tiene ediciones');
    }
}
