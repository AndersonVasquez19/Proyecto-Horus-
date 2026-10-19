<?php

namespace App\Enums;

use Filament\Support\Contracts\HasColor;
use Filament\Support\Contracts\HasLabel;

/**
 * Estado de una edición (convocatoria) de un curso.
 */
enum EstadoEdicion: string implements HasColor, HasLabel
{
    /** Programada o con inscripciones abiertas; aún no ha empezado. */
    case Planificada = 'PLANIFICADA';

    /** Las clases ya comenzaron. */
    case EnCurso = 'EN_CURSO';

    /** La edición terminó. */
    case Finalizada = 'FINALIZADA';

    /** No se realizó. No admite matrículas nuevas. */
    case Cancelada = 'CANCELADA';

    public function getLabel(): string
    {
        return match ($this) {
            self::Planificada => 'Planificada',
            self::EnCurso => 'En curso',
            self::Finalizada => 'Finalizada',
            self::Cancelada => 'Cancelada',
        };
    }

    public function getColor(): string
    {
        return match ($this) {
            self::Planificada => 'info',
            self::EnCurso => 'success',
            self::Finalizada => 'gray',
            self::Cancelada => 'danger',
        };
    }

    public function admiteMatriculas(): bool
    {
        return $this !== self::Cancelada;
    }

    /**
     * @return list<string>
     */
    public static function valores(): array
    {
        return array_column(self::cases(), 'value');
    }
}
