<?php

namespace App\Support\ImportacionAcademica;

use RuntimeException;

/**
 * La importación no se realizó y no se escribió nada. El mensaje es apto para
 * el usuario (sin datos personales ni detalles internos). Si el estado
 * académico cambió desde la vista previa, incluye el plan actualizado para
 * que el usuario lo revise antes de volver a confirmar.
 */
final class ImportacionRechazadaException extends RuntimeException
{
    public function __construct(string $mensaje, public readonly ?PlanImportacion $planActualizado = null)
    {
        parent::__construct($mensaje);
    }
}
