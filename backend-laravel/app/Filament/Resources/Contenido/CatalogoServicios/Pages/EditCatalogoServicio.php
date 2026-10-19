<?php

namespace App\Filament\Resources\Contenido\CatalogoServicios\Pages;

use App\Filament\Concerns\PaginaDeContenido;
use App\Filament\Resources\Contenido\CatalogoServicios\CatalogoServicioResource;
use App\Filament\Support\AccionesContenido;
use Filament\Resources\Pages\EditRecord;

class EditCatalogoServicio extends EditRecord
{
    use PaginaDeContenido;

    protected static string $resource = CatalogoServicioResource::class;

    protected function getHeaderActions(): array
    {
        return [
            AccionesContenido::publicar(),
            AccionesContenido::despublicar(),
            AccionesContenido::archivar(),
            AccionesContenido::eliminar()->successRedirectUrl(static::getResource()::getUrl('index')),
        ];
    }
}
