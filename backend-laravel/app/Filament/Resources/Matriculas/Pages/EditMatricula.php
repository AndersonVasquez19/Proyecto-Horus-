<?php

namespace App\Filament\Resources\Matriculas\Pages;

use App\Filament\Concerns\TraduceErroresDeDominio;
use App\Filament\Resources\Matriculas\MatriculaResource;
use Filament\Actions\ViewAction;
use Filament\Resources\Pages\EditRecord;

/**
 * Edición de fecha, estado y observaciones. Las matrículas no se eliminan.
 */
class EditMatricula extends EditRecord
{
    use TraduceErroresDeDominio;

    protected static string $resource = MatriculaResource::class;

    protected function getHeaderActions(): array
    {
        return [
            ViewAction::make(),
        ];
    }

    protected function campoErrorDeUnicidad(): string
    {
        return 'edicion_id';
    }

    protected function getSavedNotificationTitle(): ?string
    {
        return 'Matrícula actualizada';
    }
}
