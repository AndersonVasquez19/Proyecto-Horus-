<?php

namespace App\Filament\Resources\Estudiantes\Pages;

use App\Filament\Concerns\TraduceErroresDeDominio;
use App\Filament\Resources\Estudiantes\EstudianteResource;
use App\Filament\Resources\Estudiantes\Schemas\EstudianteForm;
use App\Filament\Support\AccionesAcademicas;
use App\Models\Estudiante;
use Filament\Actions\ViewAction;
use Filament\Resources\Pages\EditRecord;

class EditEstudiante extends EditRecord
{
    use TraduceErroresDeDominio;

    protected static string $resource = EstudianteResource::class;

    protected function getHeaderActions(): array
    {
        return [
            ViewAction::make(),
            AccionesAcademicas::eliminarProtegido(fn (Estudiante $record): bool => $record->matriculas()->exists()),
        ];
    }

    protected function mutateFormDataBeforeSave(array $data): array
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

    protected function getSavedNotificationTitle(): ?string
    {
        return 'Datos del estudiante actualizados';
    }
}
