<?php

namespace App\Filament\Resources\Matriculas\Pages;

use App\Filament\Concerns\TraduceErroresDeDominio;
use App\Filament\Resources\Matriculas\MatriculaResource;
use App\Models\Matricula;
use Filament\Actions\ViewAction;
use Filament\Resources\Pages\EditRecord;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Arr;

/**
 * Edición de fecha, estado y observaciones. Las matrículas no se eliminan.
 */
class EditMatricula extends EditRecord
{
    use TraduceErroresDeDominio {
        handleRecordUpdate as protected actualizarConErroresEnFormulario;
    }

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

    /**
     * «motivo» no es un atributo de la matrícula: se entrega al modelo para
     * el historial del cambio de estado.
     */
    protected function handleRecordUpdate(Model $record, array $data): Model
    {
        /** @var Matricula $record */
        $record->conMotivo(Arr::pull($data, 'motivo'));

        return $this->actualizarConErroresEnFormulario($record, $data);
    }

    protected function getSavedNotificationTitle(): ?string
    {
        return 'Matrícula actualizada';
    }
}
