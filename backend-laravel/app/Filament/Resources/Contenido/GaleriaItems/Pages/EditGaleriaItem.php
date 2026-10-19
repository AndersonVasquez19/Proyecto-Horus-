<?php

namespace App\Filament\Resources\Contenido\GaleriaItems\Pages;

use App\Filament\Concerns\PaginaDeContenido;
use App\Filament\Resources\Contenido\GaleriaItems\GaleriaItemResource;
use App\Filament\Support\AccionesContenido;
use Filament\Resources\Pages\EditRecord;

class EditGaleriaItem extends EditRecord
{
    use PaginaDeContenido;

    protected static string $resource = GaleriaItemResource::class;

    protected function getHeaderActions(): array
    {
        return [
            AccionesContenido::alternarVisibilidad('activo'),
            AccionesContenido::eliminar()->successRedirectUrl(static::getResource()::getUrl('index')),
        ];
    }
}
