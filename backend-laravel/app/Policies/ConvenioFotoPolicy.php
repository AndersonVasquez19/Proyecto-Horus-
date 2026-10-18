<?php

namespace App\Policies;

/** Fotos de un convenio: se gestionan desde la ficha del convenio. */
class ConvenioFotoPolicy extends PoliticaContenidoPublico
{
    protected const ELIMINABLE = true;
}
