<?php

namespace App\Filament\Resources\Estudiantes\Pages;

use App\Filament\Concerns\TraduceErroresDeDominio;
use App\Filament\Resources\Estudiantes\EstudianteResource;
use App\Filament\Resources\Estudiantes\Schemas\EstudianteForm;
use App\Models\Estudiante;
use Filament\Notifications\Notification;
use Filament\Resources\Pages\CreateRecord;

class CreateEstudiante extends CreateRecord
{
    use TraduceErroresDeDominio;

    protected static string $resource = EstudianteResource::class;

    protected function mutateFormDataBeforeCreate(array $data): array
    {
        return EstudianteForm::prepararDatos($data);
    }

    protected function campoErrorDeUnicidad(): string
    {
        return 'numero_documento';
    }

    protected function mensajeErrorDeUnicidad(): string
    {
        return 'Ya existe un estudiante registrado con este documento.';
    }

    protected function getCreatedNotificationTitle(): ?string
    {
        return 'Estudiante registrado';
    }

    protected function afterCreate(): void
    {
        /** @var Estudiante $estudiante */
        $estudiante = $this->getRecord();
        $coincidencias = $estudiante->posiblesCoincidencias()->count();

        if ($coincidencias > 0) {
            Notification::make()
                ->warning()
                ->title('Posible duplicado')
                ->body("Hay {$coincidencias} estudiante(s) con el mismo nombre. Revise la ficha antes de matricular; no se fusionan registros automáticamente.")
                ->persistent()
                ->send();
        }
    }

    protected function getRedirectUrl(): string
    {
        return EstudianteResource::getUrl('view', ['record' => $this->getRecord()]);
    }
}
