<?php

namespace App\Filament\Resources\Cursos\Tables;

use Filament\Actions\EditAction;
use Filament\Actions\ViewAction;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\TernaryFilter;
use Filament\Tables\Table;

class CursosTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->defaultSort('nombre')
            ->searchPlaceholder('Buscar por nombre o código')
            ->columns([
                TextColumn::make('nombre')
                    ->label('Curso')
                    ->searchable()
                    ->sortable()
                    ->weight('medium'),
                TextColumn::make('codigo')
                    ->label('Código')
                    ->searchable()
                    ->placeholder('—'),
                IconColumn::make('activo')
                    ->label('Activo')
                    ->boolean()
                    ->alignCenter(),
                TextColumn::make('ediciones_count')
                    ->label('Ediciones')
                    ->counts('ediciones')
                    ->sortable()
                    ->alignCenter(),
                TextColumn::make('matriculas_count')
                    ->label('Matrículas')
                    ->counts('matriculas')
                    ->sortable()
                    ->alignCenter(),
            ])
            ->filters([
                TernaryFilter::make('activo')
                    ->label('Activo')
                    ->trueLabel('Solo activos')
                    ->falseLabel('Solo inactivos'),
            ])
            ->recordActions([
                ViewAction::make(),
                EditAction::make(),
            ])
            ->emptyStateHeading('Aún no hay cursos')
            ->emptyStateDescription('Cree un curso y luego registre sus ediciones.');
    }
}
