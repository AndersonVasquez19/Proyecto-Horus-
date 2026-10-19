<?php

namespace App\Filament\Resources\Contenido\Convenios\Pages;

use App\Filament\Concerns\PaginaDeContenido;
use App\Filament\Resources\Contenido\Convenios\ConvenioResource;
use App\Filament\Support\AccionesContenido;
use Filament\Resources\Pages\EditRecord;

class EditConvenio extends EditRecord
{
    use PaginaDeContenido;

    protected static string $resource = ConvenioResource::class;

    protected function getHeaderActions(): array
    {
        return [
            AccionesContenido::alternarVisibilidad('visible'),
            AccionesContenido::eliminar()->successRedirectUrl(static::getResource()::getUrl('index')),
        ];
    }
}
