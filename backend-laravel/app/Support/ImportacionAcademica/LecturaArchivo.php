<?php

namespace App\Support\ImportacionAcademica;

/**
 * Contenido leído de un archivo: una o varias hojas, cada una con sus filas
 * no vacías indexadas por el número de fila del archivo (1 = primera fila).
 */
final class LecturaArchivo
{
    /**
     * @param  array<string, array<int, array<int, Celda>>>  $hojas  nombre => (fila => (columna => celda))
     */
    public function __construct(
        public readonly string $formato,
        public readonly array $hojas,
    ) {}

    /**
     * @return list<string>
     */
    public function nombresDeHojas(): array
    {
        return array_map('strval', array_keys($this->hojas));
    }

    /**
     * @return array<int, array<int, Celda>>
     */
    public function filas(string $hoja): array
    {
        return $this->hojas[$hoja] ?? [];
    }
}
