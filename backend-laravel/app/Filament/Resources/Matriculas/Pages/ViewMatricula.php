<?php

namespace App\Filament\Resources\Matriculas\Pages;

use App\Filament\Resources\Matriculas\MatriculaResource;
use App\Filament\Support\AccionesAcademicas;
use Filament\Actions\EditAction;
use Filament\Resources\Pages\ViewRecord;

class ViewMatricula extends ViewRecord
{
    protected static string $resource = MatriculaResource::class;

    protected function getHeaderActions(): array
    {
        return [
            AccionesAcademicas::cambiarEstadoMatricula(),
            EditAction::make(),
        ];
    }
}
