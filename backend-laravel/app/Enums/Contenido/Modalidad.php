<?php

namespace App\Enums\Contenido;

use Filament\Support\Contracts\HasLabel;

enum Modalidad: string implements HasLabel
{
    case Presencial = 'presencial';
    case Virtual = 'virtual';
    case Hibrida = 'hibrida';

    public function getLabel(): string
    {
        // Mismas etiquetas que muestra la web React.
        return match ($this) {
            self::Presencial => 'Presencial',
            self::Virtual => 'Virtual',
            self::Hibrida => 'Semipresencial',
        };
    }
}
