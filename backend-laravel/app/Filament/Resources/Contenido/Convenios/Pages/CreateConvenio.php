<?php

namespace App\Filament\Resources\Contenido\Convenios\Pages;

use App\Filament\Concerns\PaginaDeContenido;
use App\Filament\Resources\Contenido\Convenios\ConvenioResource;
use Filament\Resources\Pages\CreateRecord;

class CreateConvenio extends CreateRecord
{
    use PaginaDeContenido;

    protected static string $resource = ConvenioResource::class;

    protected function getRedirectUrl(): string
    {
        return ConvenioResource::getUrl('edit', ['record' => $this->getRecord()]);
    }
}
