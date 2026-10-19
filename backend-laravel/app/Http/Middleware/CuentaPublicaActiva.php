<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

class CuentaPublicaActiva
{
    public function handle(Request $request, Closure $next): Response
    {
        $usuario = User::query()->find(Auth::guard('web')->id());

        if (! $usuario?->activo) {
            Auth::guard('web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();

            return response()->json(['message' => 'Sesión no disponible.'], 401);
        }

        Auth::guard('web')->setUser($usuario);

        return $next($request);
    }
}
