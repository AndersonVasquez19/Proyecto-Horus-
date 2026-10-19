<?php

namespace App\Policies;

/** Se archivan, no se eliminan. */
class PreguntaFrecuentePolicy extends PoliticaContenidoPublico
{
    protected const ELIMINABLE = false;
}
