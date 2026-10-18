<?php

namespace App\Filament\Resources\Contenido\CatalogoCursos\Tables;

use App\Enums\Contenido\EstadoPublicacion;
use App\Enums\Contenido\Modalidad;
use App\Enums\Contenido\TipoPrograma;
use App\Filament\Support\AccionesContenido;
use Filament\Actions\ActionGroup;
use Filament\Actions\EditAction;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class CatalogoCursosTable
{
    public static function configure(Table $table): Table
    {
        return $table
            ->defaultSort('orden')
            ->searchPlaceholder('Buscar por título o identificador')
            ->columns([
                TextColumn::make('titulo')->label('Título')->searchable()->sortable()->weight('medium')
                    ->description(fn ($record): string => '/'.$record->slug),
                TextColumn::make('slug')->searchable()->toggleable(isToggledHiddenByDefault: true),
                TextColumn::make('tipo')->label('Tipo')->badge()->color('gray'),
                TextColumn::make('modalidad')->label('Modalidad')->placeholder('Por confirmar'),
                TextColumn::make('estado')->label('Estado')->badge()->sortable(),
                TextColumn::make('orden')->label('Orden')->sortable()->alignCenter(),
                TextColumn::make('fecha_inicio')->label('Inicio')->date('d/m/Y')->sortable()->placeholder('—'),
                TextColumn::make('updated_at')->label('Actualizado')->since()->sortable()->toggleable(),
            ])
            ->filters([
                SelectFilter::make('estado')->label('Estado')->options(EstadoPublicacion::class),
                SelectFilter::make('tipo')->label('Tipo')->options(TipoPrograma::class),
                SelectFilter::make('modalidad')->label('Modalidad')->options(Modalidad::class),
            ])
            ->recordActions([
                EditAction::make(),
                ActionGroup::make([
                    AccionesContenido::publicar(),
                    AccionesContenido::despublicar(),
                    AccionesContenido::archivar(),
                ]),
            ])
            ->emptyStateHeading('Aún no hay fichas en el catálogo')
            ->emptyStateDescription('Cree la ficha pública de un curso o capacitación. Se guarda como borrador hasta publicarla.');
    }
}
