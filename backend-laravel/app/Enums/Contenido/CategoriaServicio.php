<?php

namespace App\Enums\Contenido;

use Filament\Support\Contracts\HasLabel;

/** Las cuatro categorías de servicios de la web (sin «otros», como en NestJS). */
enum CategoriaServicio: string implements HasLabel
{
    case Cableado = 'cableado';
    case Camaras = 'camaras';
    case Soporte = 'soporte';
    case Asesoramiento = 'asesoramiento';

    public function getLabel(): string
    {
        return match ($this) {
            self::Cableado => 'Cableado estructurado',
            self::Camaras => 'Cámaras y seguridad',
            self::Soporte => 'Soporte técnico',
            self::Asesoramiento => 'Asesoramiento',
        };
    }
}
