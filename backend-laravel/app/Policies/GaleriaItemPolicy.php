<?php

namespace App\Policies;

/** Una foto puede retirarse definitivamente (el archivo de imagen no se borra). */
class GaleriaItemPolicy extends PoliticaContenidoPublico
{
    protected const ELIMINABLE = true;
}
