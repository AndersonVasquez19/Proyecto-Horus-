<?php

namespace App\Filament\Resources\Contenido\CatalogoCursos\Pages;

use App\Filament\Concerns\PaginaDeContenido;
use App\Filament\Resources\Contenido\CatalogoCursos\CatalogoCursoResource;
use Filament\Resources\Pages\CreateRecord;

class CreateCatalogoCurso extends CreateRecord
{
    use PaginaDeContenido;

    protected static string $resource = CatalogoCursoResource::class;

    protected function getRedirectUrl(): string
    {
        return CatalogoCursoResource::getUrl('edit', ['record' => $this->getRecord()]);
    }
}
