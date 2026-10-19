<?php

namespace App\Filament\Resources\Contenido\CatalogoServicios\Pages;

use App\Filament\Resources\Contenido\CatalogoServicios\CatalogoServicioResource;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ListRecords;

class ListCatalogoServicios extends ListRecords
{
    protected static string $resource = CatalogoServicioResource::class;

    protected function getHeaderActions(): array
    {
        return [
            CreateAction::make()->label('Nuevo servicio'),
        ];
    }
}
