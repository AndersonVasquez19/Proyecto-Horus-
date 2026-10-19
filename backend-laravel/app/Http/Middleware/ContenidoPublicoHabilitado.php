<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * La API pública de contenido solo responde si se activó expresamente
 * (HORUS_CONTENIDO_API=true). Desactivada, se comporta como una ruta inexistente.
 */
class ContenidoPublicoHabilitado
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless(config('contenido-publico.api_habilitada') === true, 404);

        return $next($request);
    }
}
