<?php

namespace App\Filament\Resources\Contenido\PreguntasFrecuentes\Pages;

use App\Filament\Resources\Contenido\PreguntasFrecuentes\PreguntaFrecuenteResource;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ListRecords;

class ListPreguntasFrecuentes extends ListRecords
{
    protected static string $resource = PreguntaFrecuenteResource::class;

    protected function getHeaderActions(): array
    {
        return [
            CreateAction::make()->label('Nueva pregunta'),
        ];
    }
}
