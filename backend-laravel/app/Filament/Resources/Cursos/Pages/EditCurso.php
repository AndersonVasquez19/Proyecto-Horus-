<?php

namespace App\Filament\Resources\Cursos\Pages;

use App\Filament\Concerns\TraduceErroresDeDominio;
use App\Filament\Resources\Cursos\CursoResource;
use App\Filament\Support\AccionesAcademicas;
use App\Models\Curso;
use Filament\Actions\ViewAction;
use Filament\Resources\Pages\EditRecord;

class EditCurso extends EditRecord
{
    use TraduceErroresDeDominio;

    protected static string $resource = CursoResource::class;

    protected function getHeaderActions(): array
    {
        return [
            ViewAction::make(),
            AccionesAcademicas::eliminarProtegido(fn (Curso $record): bool => $record->ediciones()->exists()),
        ];
    }

    protected function campoErrorDeUnicidad(): string
    {
        return 'nombre';
    }

    protected function mensajeErrorDeUnicidad(): string
    {
        return 'Ya existe un curso con este nombre o código.';
    }
}
