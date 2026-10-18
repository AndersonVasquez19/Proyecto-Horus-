<?php

namespace App\Filament\Resources\Contenido\GaleriaItems\Pages;

use App\Filament\Resources\Contenido\GaleriaItems\GaleriaItemResource;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ListRecords;

class ListGaleriaItems extends ListRecords
{
    protected static string $resource = GaleriaItemResource::class;

    protected function getHeaderActions(): array
    {
        return [
            CreateAction::make()->label('Nueva foto'),
        ];
    }
}
