<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * Se lanza al intentar eliminar un registro que forma parte del historial
 * académico (por ejemplo, un estudiante con matrículas).
 *
 * El mensaje está pensado para mostrarse al personal tal cual.
 */
class RegistroProtegidoException extends RuntimeException {}
