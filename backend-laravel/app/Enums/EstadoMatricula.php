<?php

namespace App\Enums;

use Filament\Support\Contracts\HasColor;
use Filament\Support\Contracts\HasDescription;
use Filament\Support\Contracts\HasLabel;

/**
 * Estado administrativo de una matrícula.
 *
 * Ningún estado implica pago, asistencia ni nota: esos hechos no se registran
 * en esta etapa y no deben deducirse del estado.
 */
enum EstadoMatricula: string implements HasColor, HasDescription, HasLabel
{
    /** El estudiante está inscrito en la edición (p. ej. aparece en la hoja del curso). */
    case Matriculado = 'MATRICULADO';

    /** El personal confirmó que el estudiante cumplió el curso. Nunca se asigna automáticamente. */
    case Culminado = 'CULMINADO';

    /** El estudiante dejó el curso después de matricularse. */
    case Retirado = 'RETIRADO';

    /** La matrícula se registró por error o se dejó sin efecto. Se conserva para el historial. */
    case Anulado = 'ANULADO';

    public function getLabel(): string
    {
        return match ($this) {
            self::Matriculado => 'Matriculado',
            self::Culminado => 'Culminado',
            self::Retirado => 'Retirado',
            self::Anulado => 'Anulado',
        };
    }

    public function getDescription(): string
    {
        return match ($this) {
            self::Matriculado => 'Inscrito en la edición. No implica pago, asistencia ni aprobación.',
            self::Culminado => 'El personal confirmó que cumplió el curso.',
            self::Retirado => 'Dejó el curso después de matricularse.',
            self::Anulado => 'Registro sin efecto (error o anulación administrativa).',
        };
    }

    public function getColor(): string
    {
        return match ($this) {
            self::Matriculado => 'info',
            self::Culminado => 'success',
            self::Retirado => 'warning',
            self::Anulado => 'gray',
        };
    }

    /**
     * Estados a los que se puede pasar desde el estado actual.
     *
     * @return list<self>
     */
    public function transicionesPermitidas(): array
    {
        return match ($this) {
            self::Matriculado => [self::Culminado, self::Retirado, self::Anulado],
            // Corrección de una confirmación hecha por error.
            self::Culminado => [self::Matriculado],
            // Reincorporación o anulación del registro.
            self::Retirado => [self::Matriculado, self::Anulado],
            // Reactivación de una anulación hecha por error.
            self::Anulado => [self::Matriculado],
        };
    }

    public function puedeCambiarA(self $destino): bool
    {
        return $destino === $this || in_array($destino, $this->transicionesPermitidas(), true);
    }

    /**
     * Estados que ocupan una plaza del cupo de la edición.
     *
     * @return list<self>
     */
    public static function ocupanCupo(): array
    {
        return [self::Matriculado, self::Culminado];
    }

    public function ocupaCupo(): bool
    {
        return in_array($this, self::ocupanCupo(), true);
    }

    /**
     * @return list<string>
     */
    public static function valores(): array
    {
        return array_column(self::cases(), 'value');
    }
}
