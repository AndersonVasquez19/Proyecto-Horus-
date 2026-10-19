<?php

namespace App\Support\ImportacionAcademica;

/**
 * Valor de una celda leída del archivo. Una fórmula o un error de Excel nunca
 * se evalúa ni se usa: solo se marca para rechazar la fila si afecta a un
 * campo importado.
 */
final class Celda
{
    public const VALOR = 'valor';

    public const FORMULA = 'formula';

    public const ERROR = 'error';

    public function __construct(
        public readonly mixed $valor,
        public readonly string $tipo = self::VALOR,
    ) {}

    public function esFormula(): bool
    {
        return $this->tipo === self::FORMULA;
    }

    public function esError(): bool
    {
        return $this->tipo === self::ERROR;
    }

    public function vacia(): bool
    {
        if ($this->tipo !== self::VALOR) {
            return false;
        }

        return $this->valor === null || (is_string($this->valor) && trim($this->valor) === '');
    }

    /**
     * Texto de la celda para mostrar o validar (sin fórmulas ni errores).
     */
    public function texto(): ?string
    {
        if ($this->tipo !== self::VALOR || $this->valor === null) {
            return null;
        }

        if ($this->valor instanceof \DateTimeInterface) {
            return $this->valor->format('Y-m-d');
        }

        if (is_bool($this->valor)) {
            return $this->valor ? 'VERDADERO' : 'FALSO';
        }

        if (is_float($this->valor) && floor($this->valor) === $this->valor && abs($this->valor) < 1e15) {
            return (string) (int) $this->valor;
        }

        $texto = trim(preg_replace('/\s+/u', ' ', (string) $this->valor) ?? '');

        return $texto === '' ? null : $texto;
    }
}
