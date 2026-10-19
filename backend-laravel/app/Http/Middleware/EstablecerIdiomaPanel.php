<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * El panel administrativo de Horus Group se usa siempre en español,
 * independientemente de APP_LOCALE (que en .env de desarrollo puede ser «en»).
 *
 * Se registra como middleware persistente para que también se aplique a las
 * peticiones de Livewire (validaciones, acciones y modales).
 */
class EstablecerIdiomaPanel
{
    public const IDIOMA = 'es';

    public function handle(Request $request, Closure $next): Response
    {
        app()->setLocale(self::IDIOMA);

        return $next($request);
    }
}
