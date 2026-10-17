<?php

namespace App\Filament\Resources\Ediciones\Pages;

use App\Filament\Resources\Ediciones\EdicionResource;
use Filament\Actions\CreateAction;
use Filament\Resources\Pages\ListRecords;

class ListEdiciones extends ListRecords
{
    protected static string $resource = EdicionResource::class;

    protected function getHeaderActions(): array
    {
        return [
            CreateAction::make()->label('Nueva edición'),
        ];
    }
}
