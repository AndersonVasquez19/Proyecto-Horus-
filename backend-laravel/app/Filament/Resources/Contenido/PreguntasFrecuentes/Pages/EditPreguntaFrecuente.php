<?php

namespace App\Filament\Resources\Contenido\PreguntasFrecuentes\Pages;

use App\Filament\Concerns\PaginaDeContenido;
use App\Filament\Resources\Contenido\PreguntasFrecuentes\PreguntaFrecuenteResource;
use App\Filament\Support\AccionesContenido;
use Filament\Resources\Pages\EditRecord;

class EditPreguntaFrecuente extends EditRecord
{
    use PaginaDeContenido;

    protected static string $resource = PreguntaFrecuenteResource::class;

    protected function getHeaderActions(): array
    {
        return [
            AccionesContenido::publicar(),
            AccionesContenido::despublicar(),
            AccionesContenido::archivar(),
        ];
    }
}
