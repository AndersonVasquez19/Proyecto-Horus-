<?php

namespace App\Enums;

use Filament\Support\Contracts\HasLabel;

/**
 * Tipo de documento de identidad del estudiante.
 *
 * SIN_DOCUMENTO se usa para registros (sobre todo históricos) en los que no
 * consta el documento: obliga a dejar el número vacío y nunca se inventa uno.
 */
enum TipoDocumento: string implements HasLabel
{
    case Dni = 'DNI';
    case CarneExtranjeria = 'CE';
    case Pasaporte = 'PASAPORTE';
    case SinDocumento = 'SIN_DOCUMENTO';

    public function getLabel(): string
    {
        return match ($this) {
            self::Dni => 'DNI',
            self::CarneExtranjeria => 'Carné de extranjería',
            self::Pasaporte => 'Pasaporte',
            self::SinDocumento => 'Sin documento registrado',
        };
    }

    public function requiereNumero(): bool
    {
        return $this !== self::SinDocumento;
    }

    /**
     * Expresión regular que debe cumplir el número ya normalizado.
     */
    public function patron(): ?string
    {
        return match ($this) {
            self::Dni => '/^\d{8}$/',
            self::CarneExtranjeria, self::Pasaporte => '/^[A-Z0-9]{4,20}$/',
            self::SinDocumento => null,
        };
    }

    public function mensajeFormato(): string
    {
        return match ($this) {
            self::Dni => 'El DNI debe tener exactamente 8 dígitos.',
            self::CarneExtranjeria, self::Pasaporte => 'El número de documento debe tener entre 4 y 20 letras o dígitos, sin espacios ni símbolos.',
            self::SinDocumento => 'Si no hay documento registrado, deje el número vacío.',
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
