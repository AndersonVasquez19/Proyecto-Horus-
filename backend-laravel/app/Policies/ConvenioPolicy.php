<?php

namespace App\Policies;

/** Eliminar un convenio elimina sus fotos (registros), no los archivos. */
class ConvenioPolicy extends PoliticaContenidoPublico
{
    protected const ELIMINABLE = true;
}
