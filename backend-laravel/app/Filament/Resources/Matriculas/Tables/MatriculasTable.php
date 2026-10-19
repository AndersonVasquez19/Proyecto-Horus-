<?php

namespace App\Filament\Resources\Matriculas\Tables;

use App\Enums\EstadoMatricula;
use App\Filament\Support\AccionesAcademicas;
use App\Models\Curso;
use App\Models\Matricula;
use Filament\Actions\EditAction;
use Filament\Actions\ViewAction;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;

class MatriculasTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->modifyQueryUsing(fn (Builder $query) => $query->with(['estudiante', 'edicion.curso']))
            ->searchable()
            ->searchUsing(fn (Builder $query, string $search) => $query->where(fn (Builder $q) => $q
                ->whereHas('estudiante', fn (Builder $e) => $e->buscar($search))
                ->orWhereHas('edicion', fn (Builder $e) => $e
                    ->where('nombre', 'like', '%'.$search.'%')
                    ->orWhereHas('curso', fn (Builder $c) => $c->where('nombre', 'like', '%'.$search.'%')))))
            ->searchPlaceholder('Buscar por estudiante, DNI, curso o edición')
            ->defaultSort('created_at', 'desc')
            ->columns([
                TextColumn::make('estudiante.apellidos')
                    ->label('Estudiante')
                    ->formatStateUsing(fn (Matricula $record): string => $record->estudiante->nombre_completo)
                    ->description(fn (Matricula $record): string => $record->estudiante->documento)
                    ->weight('medium'),
                TextColumn::make('edicion.curso.nombre')
                    ->label('Curso'),
                TextColumn::make('edicion.nombre')
                    ->label('Edición'),
                TextColumn::make('fecha_matricula')
                    ->label('Fecha de matrícula')
                    ->date('d/m/Y')
                    ->placeholder('Sin fecha')
                    ->sortable(),
                TextColumn::make('estado')
                    ->label('Estado')
                    ->badge(),
                TextColumn::make('created_at')
                    ->label('Registrada')
                    ->dateTime('d/m/Y H:i')
                    ->sortable()
                    ->toggleable(isToggledHiddenByDefault: true),
            ])
            ->filters([
                SelectFilter::make('estado')
                    ->label('Estado')
                    ->options(EstadoMatricula::class)
                    ->multiple(),
                SelectFilter::make('curso')
                    ->label('Curso')
                    ->options(fn (): array => Curso::query()->orderBy('nombre')->pluck('nombre', 'id')->all())
                    ->searchable()
                    ->query(fn (Builder $query, array $data): Builder => $query->when(
                        $data['value'] ?? null,
                        fn (Builder $q, $cursoId) => $q->whereHas('edicion', fn (Builder $e) => $e->where('curso_id', $cursoId)),
                    )),
                SelectFilter::make('edicion_id')
                    ->label('Edición')
                    ->relationship('edicion', 'nombre', fn (Builder $query) => $query->with('curso'))
                    ->getOptionLabelFromRecordUsing(fn ($record): string => $record->etiqueta)
                    ->searchable()
                    ->preload(),
            ])
            ->recordActions([
                ViewAction::make(),
                AccionesAcademicas::cambiarEstadoMatricula(),
                EditAction::make(),
            ])
            ->emptyStateHeading('Aún no hay matrículas')
            ->emptyStateDescription('Matricule a un estudiante desde aquí, desde su ficha o desde la edición.');
    }
}
