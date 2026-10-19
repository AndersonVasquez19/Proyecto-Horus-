<?php

namespace App\Filament\Resources\Ediciones\Pages;

use App\Filament\Concerns\TraduceErroresDeDominio;
use App\Filament\Resources\Ediciones\EdicionResource;
use Filament\Resources\Pages\CreateRecord;

class CreateEdicion extends CreateRecord
{
    use TraduceErroresDeDominio;

    protected static string $resource = EdicionResource::class;

    protected function campoErrorDeUnicidad(): string
    {
        return 'nombre';
    }

    protected function mensajeErrorDeUnicidad(): string
    {
        return 'Este curso ya tiene una edición con ese nombre.';
    }

    protected function getRedirectUrl(): string
    {
        return EdicionResource::getUrl('view', ['record' => $this->getRecord()]);
    }
}
