<?php

namespace App\Enums\Contenido;

use Filament\Support\Contracts\HasColor;
use Filament\Support\Contracts\HasLabel;

/** Estado editorial del contenido público (mismos valores que NestJS). */
enum EstadoPublicacion: string implements HasColor, HasLabel
{
    case Borrador = 'borrador';
    case Publicado = 'publicado';
    case Archivado = 'archivado';

    public function getLabel(): string
    {
        return match ($this) {
            self::Borrador => 'Borrador',
            self::Publicado => 'Publicado',
            self::Archivado => 'Archivado',
        };
    }

    public function getColor(): string
    {
        return match ($this) {
            self::Borrador => 'gray',
            self::Publicado => 'success',
            self::Archivado => 'warning',
        };
    }
}
