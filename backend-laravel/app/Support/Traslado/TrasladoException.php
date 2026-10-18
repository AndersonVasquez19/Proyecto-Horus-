<?php

namespace App\Support\Traslado;

use RuntimeException;

/**
 * Error controlado del traslado. Su mensaje nunca incluye valores de las filas:
 * solo tablas, columnas, identificadores y códigos de error.
 */
final class TrasladoException extends RuntimeException {}
