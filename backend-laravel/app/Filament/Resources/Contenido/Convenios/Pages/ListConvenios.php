<?php

namespace App\Filament\Resources\Contenido\Convenios\Pages;

use App\Filament\Resources\Contenido\Convenios\ConvenioResource;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ListRecords;

class ListConvenios extends ListRecords
{
    protected static string $resource = ConvenioResource::class;

    protected function getHeaderActions(): array
    {
        return [
            CreateAction::make()->label('Nuevo convenio'),
        ];
    }
}
