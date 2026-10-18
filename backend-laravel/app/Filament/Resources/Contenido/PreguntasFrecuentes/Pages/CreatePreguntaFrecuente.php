<?php

namespace App\Filament\Resources\Contenido\PreguntasFrecuentes\Pages;

use App\Filament\Concerns\PaginaDeContenido;
use App\Filament\Resources\Contenido\PreguntasFrecuentes\PreguntaFrecuenteResource;
use Filament\Resources\Pages\CreateRecord;

class CreatePreguntaFrecuente extends CreateRecord
{
    use PaginaDeContenido;

    protected static string $resource = PreguntaFrecuenteResource::class;

    protected function getRedirectUrl(): string
    {
        return PreguntaFrecuenteResource::getUrl('edit', ['record' => $this->getRecord()]);
    }
}
