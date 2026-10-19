<?php

namespace App\Enums;

use Filament\Support\Contracts\HasColor;
use Filament\Support\Contracts\HasLabel;

/**
 * Tipo de movimiento registrado en el historial de una matrícula.
 */
enum TipoMovimientoMatricula: string implements HasColor, HasLabel
{
    /** Alta de la matrícula (siempre en «Matriculado»). */
    case Creacion = 'CREACION';

    /** Otros cambios de estado: confirmar la culminación o corregirla. */
    case CambioEstado = 'CAMBIO_ESTADO';

    /** Paso a «Retirado». */
    case Retiro = 'RETIRO';

    /** Paso a «Anulado». */
    case Anulacion = 'ANULACION';

    /** Vuelta a «Matriculado» desde un estado que no ocupaba cupo (retirado o anulado). */
    case Reactivacion = 'REACTIVACION';

    public static function paraCambio(EstadoMatricula $anterior, EstadoMatricula $nuevo): self
    {
        return match (true) {
            $nuevo === EstadoMatricula::Retirado => self::Retiro,
            $nuevo === EstadoMatricula::Anulado => self::Anulacion,
            $nuevo->ocupaCupo() && ! $anterior->ocupaCupo() => self::Reactivacion,
            default => self::CambioEstado,
        };
    }

    public function getLabel(): string
    {
        return match ($this) {
            self::Creacion => 'Matrícula registrada',
            self::CambioEstado => 'Cambio de estado',
            self::Retiro => 'Retiro',
            self::Anulacion => 'Anulación',
            self::Reactivacion => 'Reactivación',
        };
    }

    public function getColor(): string
    {
        return match ($this) {
            self::Creacion => 'info',
            self::CambioEstado => 'gray',
            self::Retiro => 'warning',
            self::Anulacion => 'danger',
            self::Reactivacion => 'success',
        };
    }

    /**
     * @return list<string>
     */
    public static function valores(): array
    {
        return array_column(self::cases(), 'value');
    }
}
