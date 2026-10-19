<?php

namespace App\Filament\Resources\Ediciones\Pages;

use App\Filament\Resources\Ediciones\EdicionResource;
use Filament\Actions\EditAction;
use Filament\Resources\Pages\ViewRecord;

class ViewEdicion extends ViewRecord
{
    protected static string $resource = EdicionResource::class;

    protected function getHeaderActions(): array
    {
        return [
            EditAction::make(),
        ];
    }
}
