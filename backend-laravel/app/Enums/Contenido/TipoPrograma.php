<?php

namespace App\Enums\Contenido;

use Filament\Support\Contracts\HasLabel;

/** Tipo de programa publicado en el catálogo de Educación. */
enum TipoPrograma: string implements HasLabel
{
    case Curso = 'curso';
    case Capacitacion = 'capacitacion';

    public function getLabel(): string
    {
        return match ($this) {
            self::Curso => 'Curso',
            self::Capacitacion => 'Capacitación',
        };
    }
}
