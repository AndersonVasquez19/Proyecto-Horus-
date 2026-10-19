<?php

namespace App\Filament\Resources\Contenido\CatalogoServicios\Pages;

use App\Filament\Concerns\PaginaDeContenido;
use App\Filament\Resources\Contenido\CatalogoServicios\CatalogoServicioResource;
use Filament\Resources\Pages\CreateRecord;

class CreateCatalogoServicio extends CreateRecord
{
    use PaginaDeContenido;

    protected static string $resource = CatalogoServicioResource::class;

    protected function getRedirectUrl(): string
    {
        return CatalogoServicioResource::getUrl('edit', ['record' => $this->getRecord()]);
    }
}
