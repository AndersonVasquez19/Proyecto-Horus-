<?php

namespace App\Filament\Resources\Contenido\CatalogoCursos\Pages;

use App\Filament\Resources\Contenido\CatalogoCursos\CatalogoCursoResource;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ListRecords;

class ListCatalogoCursos extends ListRecords
{
    protected static string $resource = CatalogoCursoResource::class;

    protected function getHeaderActions(): array
    {
        return [
            CreateAction::make()->label('Nueva ficha'),
        ];
    }
}
