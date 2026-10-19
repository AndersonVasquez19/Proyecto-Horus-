<?php

namespace App\Filament\Resources\Contenido\GaleriaItems\Pages;

use App\Filament\Concerns\PaginaDeContenido;
use App\Filament\Resources\Contenido\GaleriaItems\GaleriaItemResource;
use Filament\Resources\Pages\CreateRecord;

class CreateGaleriaItem extends CreateRecord
{
    use PaginaDeContenido;

    protected static string $resource = GaleriaItemResource::class;

    protected function getRedirectUrl(): string
    {
        return GaleriaItemResource::getUrl('edit', ['record' => $this->getRecord()]);
    }
}
