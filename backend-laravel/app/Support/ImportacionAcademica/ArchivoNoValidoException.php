<?php

namespace App\Support\ImportacionAcademica;

use RuntimeException;

/**
 * El archivo no se puede importar (formato, tamaño, estructura, contenido
 * activo o daño). El mensaje es apto para mostrarse al usuario: nunca incluye
 * rutas, datos de las celdas ni detalles internos.
 */
final class ArchivoNoValidoException extends RuntimeException {}
