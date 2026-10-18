<?php

namespace App\Filament\Resources\Contenido\CatalogoServicios\Tables;

use App\Enums\Contenido\CategoriaServicio;
use App\Enums\Contenido\EstadoPublicacion;
use App\Filament\Support\AccionesContenido;
use Filament\Actions\ActionGroup;
use Filament\Actions\EditAction;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;

class CatalogoServiciosTable
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
                TextColumn::make('categoria')->label('Categoría')->badge()->color('gray'),
                TextColumn::make('estado')->label('Estado')->badge()->sortable(),
                TextColumn::make('orden')->label('Orden')->sortable()->alignCenter(),
                TextColumn::make('updated_at')->label('Actualizado')->since()->sortable()->toggleable(),
            ])
            ->filters([
                SelectFilter::make('estado')->label('Estado')->options(EstadoPublicacion::class),
                SelectFilter::make('categoria')->label('Categoría')->options(CategoriaServicio::class),
            ])
            ->recordActions([
                EditAction::make(),
                ActionGroup::make([
                    AccionesContenido::publicar(),
                    AccionesContenido::despublicar(),
                    AccionesContenido::archivar(),
                    AccionesContenido::eliminar(),
                ]),
            ])
            ->emptyStateHeading('Aún no hay servicios')
            ->emptyStateDescription('Cree un servicio. Se guarda como borrador hasta publicarlo.');
    }
}
