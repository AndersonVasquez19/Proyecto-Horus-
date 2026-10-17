<?php

namespace App\Filament\Resources\Matriculas\Pages;

use App\Filament\Concerns\TraduceErroresDeDominio;
use App\Filament\Resources\Matriculas\MatriculaResource;
use Filament\Resources\Pages\CreateRecord;

class CreateMatricula extends CreateRecord
{
    use TraduceErroresDeDominio;

    protected static string $resource = MatriculaResource::class;

    protected function campoErrorDeUnicidad(): string
    {
        return 'edicion_id';
    }

    protected function mensajeErrorDeUnicidad(): string
    {
        return 'El estudiante ya está matriculado en esta edición.';
    }

    protected function getCreatedNotificationTitle(): ?string
    {
        return 'Estudiante matriculado';
    }

    protected function getRedirectUrl(): string
    {
        return MatriculaResource::getUrl('view', ['record' => $this->getRecord()]);
    }
}
