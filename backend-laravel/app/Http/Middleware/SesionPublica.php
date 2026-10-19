<?php

namespace App\Http\Middleware;

use App\Support\SeguridadPanel;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SesionPublica
{
    public function handle(Request $request, Closure $next): Response
    {
        $request->headers->set('Accept', 'application/json');

        // Nunca permitir cuentas públicas en el panel local heredado sin roles.
        $sesionSegura = app()->environment('local', 'testing') || (
            $request->isSecure()
            && config('session.secure') === true
            && config('session.http_only') === true
            && in_array(config('session.same_site'), ['lax', 'strict'], true)
            && in_array(config('session.driver'), ['database', 'file', 'redis', 'memcached', 'dynamodb'], true)
        );

        if (! config('public-auth.enabled') || ! SeguridadPanel::activa() || ! $sesionSegura) {
            return response()->json(['message' => 'Autenticación pública no disponible.'], 503)
                ->header('Cache-Control', 'no-store, private');
        }

        return $next($request)->header('Cache-Control', 'no-store, private');
    }
}
