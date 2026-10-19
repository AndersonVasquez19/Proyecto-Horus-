<?php

namespace App\Filament\Resources\Ediciones\Tables;

use App\Enums\EstadoEdicion;
use App\Enums\EstadoMatricula;
use App\Models\Edicion;
use Filament\Actions\EditAction;
use Filament\Actions\ViewAction;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;

class EdicionesTable
{
    public static function configure(Table $table): Table
    {
        $ocupanCupo = array_map(fn (EstadoMatricula $e): string => $e->value, EstadoMatricula::ocupanCupo());

        return $table
            ->modifyQueryUsing(fn (Builder $query) => $query
                ->with('curso')
                ->withCount(['matriculas as vigentes_count' => fn (Builder $q) => $q->whereIn('estado', $ocupanCupo)]))
            ->defaultSort('created_at', 'desc')
            ->searchPlaceholder('Buscar por curso o edición')
            ->columns([
                TextColumn::make('curso.nombre')
                    ->label('Curso')
                    ->searchable()
                    ->sortable()
                    ->weight('medium'),
                TextColumn::make('nombre')
                    ->label('Edición')
                    ->searchable()
                    ->sortable(),
                TextColumn::make('fecha_inicio')
                    ->label('Inicio')
                    ->date('d/m/Y')
                    ->placeholder('Sin fecha')
                    ->sortable(),
                TextColumn::make('fecha_fin')
                    ->label('Fin')
                    ->date('d/m/Y')
                    ->placeholder('Sin fecha')
                    ->toggleable(),
                TextColumn::make('vigentes_count')
                    ->label('Matrículas vigentes')
                    ->formatStateUsing(fn (Edicion $record, $state): string => $record->cupo === null ? (string) $state : "{$state} / {$record->cupo}")
                    ->tooltip('Matriculados y culminados, frente al cupo (si lo hay)')
                    ->alignCenter(),
                TextColumn::make('estado')
                    ->label('Estado')
                    ->badge(),
            ])
            ->filters([
                SelectFilter::make('curso_id')
                    ->label('Curso')
                    ->relationship('curso', 'nombre')
                    ->searchable()
                    ->preload(),
                SelectFilter::make('estado')
                    ->label('Estado')
                    ->options(EstadoEdicion::class),
            ])
            ->recordActions([
                ViewAction::make(),
                EditAction::make(),
            ])
            ->emptyStateHeading('Aún no hay ediciones')
            ->emptyStateDescription('Registre una edición para poder matricular estudiantes.');
    }
}
