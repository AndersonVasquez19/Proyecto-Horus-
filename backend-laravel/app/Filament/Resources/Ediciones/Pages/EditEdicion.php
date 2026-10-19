<?php

namespace App\Filament\Resources\Ediciones\Pages;

use App\Filament\Concerns\TraduceErroresDeDominio;
use App\Filament\Resources\Ediciones\EdicionResource;
use App\Filament\Support\AccionesAcademicas;
use App\Models\Edicion;
use Filament\Actions\ViewAction;
use Filament\Resources\Pages\EditRecord;

class EditEdicion extends EditRecord
{
    use TraduceErroresDeDominio;

    protected static string $resource = EdicionResource::class;

    protected function getHeaderActions(): array
    {
        return [
            ViewAction::make(),
            AccionesAcademicas::eliminarProtegido(fn (Edicion $record): bool => $record->matriculas()->exists()),
        ];
    }

    protected function campoErrorDeUnicidad(): string
    {
        return 'nombre';
    }

    protected function mensajeErrorDeUnicidad(): string
    {
        return 'Este curso ya tiene una edición con ese nombre.';
    }
}
