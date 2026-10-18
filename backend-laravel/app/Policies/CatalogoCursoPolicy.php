<?php

namespace App\Policies;

/** Fichas que se conservan: se archivan. */
class CatalogoCursoPolicy extends PoliticaContenidoPublico
{
    protected const ELIMINABLE = false;
}
