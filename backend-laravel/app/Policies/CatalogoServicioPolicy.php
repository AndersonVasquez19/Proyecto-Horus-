<?php

namespace App\Policies;

/** Los servicios pueden eliminarse definitivamente (decisión del proyecto). */
class CatalogoServicioPolicy extends PoliticaContenidoPublico
{
    protected const ELIMINABLE = true;
}
