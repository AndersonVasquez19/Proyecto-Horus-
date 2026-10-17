<?php

namespace App\Filament\Resources\Cursos\Pages;

use App\Filament\Concerns\TraduceErroresDeDominio;
use App\Filament\Resources\Cursos\CursoResource;
use Filament\Resources\Pages\CreateRecord;

class CreateCurso extends CreateRecord
{
    use TraduceErroresDeDominio;

    protected static string $resource = CursoResource::class;

    protected function campoErrorDeUnicidad(): string
    {
        return 'nombre';
    }

    protected function mensajeErrorDeUnicidad(): string
    {
        return 'Ya existe un curso con este nombre o código.';
    }

    protected function getRedirectUrl(): string
    {
        return CursoResource::getUrl('view', ['record' => $this->getRecord()]);
    }
}
