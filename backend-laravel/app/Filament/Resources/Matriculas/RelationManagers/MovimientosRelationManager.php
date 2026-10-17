<?php

namespace App\Filament\Resources\Matriculas\RelationManagers;

use Filament\Resources\RelationManagers\RelationManager;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;

/**
 * Historial de la matrícula: solo lectura, sin acciones de alta, edición ni borrado.
 * El acceso lo decide MatriculaMovimientoPolicy::viewAny().
 */
class MovimientosRelationManager extends RelationManager
{
    protected static string $relationship = 'movimientos';

    protected static ?string $title = 'Historial de movimientos';

    protected static ?string $modelLabel = 'movimiento';

    protected static ?string $pluralModelLabel = 'movimientos';

    public function isReadOnly(): bool
    {
        return true;
    }

    public function table(Table $table): Table
    {
        return $table
            // Del responsable solo se carga el nombre.
            ->modifyQueryUsing(fn (Builder $query) => $query->with('usuario:id,name'))
            ->defaultSort('id', 'desc')
            ->columns([
                TextColumn::make('created_at')
                    ->label('Fecha y hora')
                    ->dateTime('d/m/Y H:i:s'),
                TextColumn::make('tipo')
                    ->label('Acción')
                    ->badge(),
                TextColumn::make('estado_anterior')
                    ->label('Estado anterior')
                    ->badge()
                    ->placeholder('—'),
                TextColumn::make('estado_nuevo')
                    ->label('Estado nuevo')
                    ->badge(),
                TextColumn::make('usuario.name')
                    ->label('Responsable')
                    ->placeholder('Sin usuario registrado'),
                TextColumn::make('motivo')
                    ->label('Motivo')
                    ->wrap()
                    ->placeholder('—'),
            ])
            ->headerActions([])
            ->recordActions([])
            ->toolbarActions([])
            ->emptyStateHeading('Sin movimientos registrados')
            ->emptyStateDescription('El historial se registra desde que se activó esta función; los cambios anteriores no se reconstruyen.');
    }
}
