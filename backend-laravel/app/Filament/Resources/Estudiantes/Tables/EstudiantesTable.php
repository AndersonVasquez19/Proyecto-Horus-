<?php

namespace App\Filament\Resources\Estudiantes\Tables;

use App\Enums\TipoDocumento;
use App\Models\Estudiante;
use Filament\Actions\EditAction;
use Filament\Actions\ViewAction;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\Filter;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;

class EstudiantesTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->searchable()
            ->searchUsing(fn (Builder $query, string $search) => $query->buscar($search))
            ->searchPlaceholder('Buscar por DNI o nombre')
            ->defaultSort('apellidos')
            ->columns([
                TextColumn::make('apellidos')
                    ->label('Apellidos')
                    ->sortable()
                    ->weight('medium'),
                TextColumn::make('nombres')
                    ->label('Nombres')
                    ->sortable(),
                TextColumn::make('numero_documento')
                    ->label('Documento')
                    ->placeholder('Sin documento')
                    ->description(fn (Estudiante $record): ?string => $record->tipo_documento->requiereNumero() ? $record->tipo_documento->getLabel() : null)
                    ->copyable(),
                TextColumn::make('telefono')
                    ->label('Teléfono')
                    ->placeholder('—')
                    ->toggleable(),
                TextColumn::make('email')
                    ->label('Correo')
                    ->placeholder('—')
                    ->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('matriculas_count')
                    ->label('Matrículas')
                    ->counts('matriculas')
                    ->sortable()
                    ->alignCenter(),
                TextColumn::make('created_at')
                    ->label('Registrado')
                    ->dateTime('d/m/Y H:i')
                    ->sortable()
                    ->toggleable(isToggledHiddenByDefault: true),
            ])
            ->filters([
                SelectFilter::make('tipo_documento')
                    ->label('Tipo de documento')
                    ->options(TipoDocumento::class),
                Filter::make('posibles_duplicados')
                    ->label('Posibles duplicados por nombre')
                    ->toggle()
                    ->query(fn (Builder $query): Builder => $query->conPosiblesCoincidencias()),
            ])
            ->recordActions([
                ViewAction::make(),
                EditAction::make(),
            ])
            ->emptyStateHeading('Aún no hay estudiantes registrados')
            ->emptyStateDescription('Registre el primer estudiante con el botón «Nuevo estudiante».');
    }
}
