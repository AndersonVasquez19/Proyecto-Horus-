<?php

namespace App\Support\ImportacionAcademica;

/**
 * Archivo subido y copiado al almacén privado, identificado por una ficha
 * aleatoria. La ruta nunca se toma del navegador: se reconstruye desde la ficha.
 */
final class ArchivoPreparado
{
    public function __construct(
        public readonly string $token,
        public readonly string $formato,
        public readonly string $nombre,
        public readonly string $sha256,
    ) {}
}
