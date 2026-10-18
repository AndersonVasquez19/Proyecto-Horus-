<?php

namespace App\Support\ImportacionAcademica;

/**
 * Resultado del análisis: qué se haría con cada fila, sin haber escrito nada.
 *
 * Estados de fila: «valida» (se importará), «invalida» (se rechaza con sus
 * errores) y «omitida» (no hay nada que hacer: ya matriculado, repetida,
 * título o sección de ponentes). La huella resume datos, operaciones y estado
 * académico observado: si cambia entre la vista previa y la confirmación, la
 * importación se detiene para que el usuario revise de nuevo.
 */
final class PlanImportacion
{
    public const VALIDA = 'valida';

    public const INVALIDA = 'invalida';

    public const OMITIDA = 'omitida';

    public const CREAR_Y_MATRICULAR = 'CREAR_ESTUDIANTE_Y_MATRICULAR';

    public const MATRICULAR_EXISTENTE = 'MATRICULAR_ESTUDIANTE_EXISTENTE';

    public const NINGUNA = 'NINGUNA';

    /**
     * @param  list<string>  $hojas
     * @param  list<array<string, mixed>>  $columnas
     * @param  list<string>  $erroresEstructura
     * @param  list<string>  $avisos
     * @param  array<int, array<string, mixed>>  $filas  número de fila => datos y resultado propuesto
     * @param  array<int, array{etiqueta: string, matriculas: int, plazas_libres: int|null}>  $destinos
     */
    public function __construct(
        public readonly array $hojas,
        public readonly ?string $hoja,
        public readonly ?int $filaEncabezado,
        public readonly array $columnas,
        public readonly array $erroresEstructura,
        public readonly array $avisos,
        public readonly array $filas,
        public readonly array $destinos,
        public readonly ?int $edicionDestinoId,
        public readonly ?string $etiquetaDestino,
        public readonly int $filasVacias,
        public readonly string $huella,
    ) {}

    public function puedeConfirmarse(): bool
    {
        return $this->erroresEstructura === [] && $this->operaciones() > 0;
    }

    public function operaciones(): int
    {
        return $this->contar(fn (array $f): bool => $f['estado'] === self::VALIDA);
    }

    /**
     * @return array<string, int>
     */
    public function resumen(): array
    {
        return [
            'total' => count($this->filas),
            'validas' => $this->operaciones(),
            'invalidas' => $this->contar(fn (array $f): bool => $f['estado'] === self::INVALIDA),
            'omitidas' => $this->contar(fn (array $f): bool => $f['estado'] === self::OMITIDA),
            'posibles_duplicados' => $this->contar(fn (array $f): bool => $f['posible_duplicado']),
            'incompletas' => $this->contar(fn (array $f): bool => $f['incompleta']),
            'estudiantes_nuevos' => $this->contar(fn (array $f): bool => $f['operacion'] === self::CREAR_Y_MATRICULAR),
            'estudiantes_existentes' => $this->contar(fn (array $f): bool => $f['operacion'] === self::MATRICULAR_EXISTENTE),
            'matriculas_nuevas' => $this->operaciones(),
            'filas_vacias' => $this->filasVacias,
        ];
    }

    /**
     * Ediciones afectadas por las operaciones válidas, en orden de id (orden de bloqueo).
     *
     * @return list<int>
     */
    public function edicionesAfectadas(): array
    {
        $ids = array_keys($this->destinos);
        sort($ids);

        return $ids;
    }

    private function contar(callable $condicion): int
    {
        return count(array_filter($this->filas, $condicion));
    }
}
